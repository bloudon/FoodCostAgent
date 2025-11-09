import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

export class CacheService {
  private redis: Redis | null = null;
  private enabled: boolean = false;

  constructor() {
    if (REDIS_URL) {
      try {
        this.redis = new Redis(REDIS_URL, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          lazyConnect: true,
        });

        this.redis.on('connect', () => {
          console.log('✅ Redis cache connected successfully');
          this.enabled = true;
        });

        this.redis.on('error', (err) => {
          console.warn('⚠️ Redis cache error (falling back to no cache):', err.message);
          this.enabled = false;
        });

        this.redis.connect().catch((err) => {
          console.warn('⚠️ Redis connection failed (cache disabled):', err.message);
          this.enabled = false;
        });
      } catch (error) {
        console.warn('⚠️ Failed to initialize Redis (cache disabled):', error);
        this.redis = null;
        this.enabled = false;
      }
    } else {
      console.log('ℹ️ Redis cache not configured (REDIS_URL not set)');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled || !this.redis) return null;

    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`Cache GET error for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.enabled || !this.redis) return;

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      console.warn(`Cache SET error for key ${key}:`, error);
    }
  }

  async del(key: string | string[]): Promise<void> {
    if (!this.enabled || !this.redis) return;

    try {
      const keys = Array.isArray(key) ? key : [key];
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.warn(`Cache DEL error for key(s) ${key}:`, error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.enabled || !this.redis) return;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.warn(`Cache invalidation error for pattern ${pattern}:`, error);
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || !this.redis) return;

    try {
      await this.redis.flushdb();
    } catch (error) {
      console.warn('Cache flush error:', error);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (error) {
        console.warn('Redis disconnect error:', error);
      }
    }
  }
}

export const cache = new CacheService();

export const CacheKeys = {
  session: (sessionId: string) => `session:${sessionId}`,
  user: (userId: string) => `user:${userId}`,
  company: (companyId: string) => `company:${companyId}`,
  units: () => `units:all`, // Global - no companyId
  categories: (companyId: string) => `categories:${companyId}`,
  vendors: (companyId: string) => `vendors:${companyId}`,
  inventoryItems: (companyId: string, storeId?: string) => 
    storeId ? `inventory:items:${companyId}:${storeId}` : `inventory:items:${companyId}:all`,
  storeInventoryItems: (companyId: string, storeId?: string) => 
    storeId ? `inventory:store:${companyId}:${storeId}` : `inventory:store:${companyId}:all`,
  recipes: (companyId: string) => `recipes:${companyId}`,
  recipe: (recipeId: string) => `recipe:${recipeId}`,
  menuItems: (companyId: string) => `menu:items:${companyId}`,
} as const;

export const CacheTTL = {
  SESSION: 3600,
  USER: 1800,
  COMPANY: 3600,
  INVENTORY_ITEMS: 300,
  STORE_INVENTORY: 180,
  RECIPES: 600,
  MENU_ITEMS: 300,
} as const;
