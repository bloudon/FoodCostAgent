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
  
  // Get from cache, or set if missing (cache-aside pattern)
  async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    const value = await fetcher();
    await this.set(key, value, ttl);
    return value;
  }
}

export const cache = new CacheService();

export const CacheKeys = {
  // Phase 1: Lookup tables (global or company-scoped)
  session: (sessionId: string) => `session:${sessionId}`,
  user: (userId: string) => `user:${userId}`,
  company: (companyId: string) => `company:${companyId}`,
  units: () => `units:all`, // Global - no companyId
  categories: (companyId: string) => `categories:${companyId}`,
  vendors: (companyId: string) => `vendors:${companyId}`,
  locations: (companyId: string) => `locations:${companyId}`, // Storage locations
  
  // Phase 2: Inventory Items (list + item caches)
  inventoryList: (companyId: string, storeId?: string, locationId?: string) => 
    `inventory:list:${companyId}:${storeId || '*'}:${locationId || '*'}`,
  inventoryItem: (companyId: string, itemId: string) => 
    `inventory:item:${companyId}:${itemId}`,
  inventoryListPattern: (companyId: string) => `inventory:list:${companyId}:*`,
  
  // Phase 2: Recipes (list + item caches)
  recipesList: (companyId: string) => `recipes:list:${companyId}`,
  recipeItem: (companyId: string, recipeId: string) => 
    `recipe:item:${companyId}:${recipeId}`,
  recipesPattern: (companyId: string) => `recipe*:${companyId}*`,
  
  // Phase 2: Menu Items (list + item caches)
  menuItemsList: (companyId: string) => `menu:list:${companyId}`,
  menuItem: (companyId: string, itemId: string) => 
    `menu:item:${companyId}:${itemId}`,
  menuItemsPattern: (companyId: string) => `menu*:${companyId}*`,
  
  // Legacy keys (keep for backward compatibility during transition)
  storeInventoryItems: (companyId: string, storeId?: string) => 
    storeId ? `inventory:store:${companyId}:${storeId}` : `inventory:store:${companyId}:all`,
} as const;

export const CacheTTL = {
  // Phase 1: Lookup tables (longer TTLs - infrequently mutated)
  SESSION: 3600,
  USER: 1800,
  COMPANY: 3600,
  UNITS: 3600,
  CATEGORIES: 3600,
  VENDORS: 3600,
  LOCATIONS: 3600,
  
  // Phase 2: Frequently-mutated resources (shorter TTLs)
  INVENTORY_ITEMS: 300,   // 5 minutes - frequently changed via receiving/counts/transfers
  RECIPES: 600,            // 10 minutes - moderately changed
  MENU_ITEMS: 300,         // 5 minutes - moderately changed
  STORE_INVENTORY: 180,    // 3 minutes - very frequently changed
} as const;

// Phase 2 Cache Invalidation Helpers
export class CacheInvalidator {
  constructor(private cache: CacheService) {}
  
  // Invalidate all inventory caches for a company
  async invalidateInventory(companyId: string, itemId?: string): Promise<void> {
    // Invalidate all list caches for the company (all filter combinations)
    await this.cache.invalidatePattern(CacheKeys.inventoryListPattern(companyId));
    
    // Invalidate item caches
    if (itemId) {
      // Specific item
      await this.cache.del(CacheKeys.inventoryItem(companyId, itemId));
    } else {
      // All items for company (e.g., category/unit/location changes affect enrichment)
      await this.cache.invalidatePattern(`inventory:item:${companyId}:*`);
    }
  }
  
  // Invalidate all recipe caches for a company
  async invalidateRecipes(companyId: string, recipeId?: string): Promise<void> {
    // Invalidate list cache
    await this.cache.del(CacheKeys.recipesList(companyId));
    
    // Invalidate recipe costs cache (used by GET /api/recipes for calculated costs)
    await this.cache.del(`recipes:costs:${companyId}`);
    
    // Invalidate item caches
    if (recipeId) {
      // Specific recipe
      await this.cache.del(CacheKeys.recipeItem(companyId, recipeId));
    } else {
      // All recipes for company
      await this.cache.invalidatePattern(CacheKeys.recipesPattern(companyId));
    }
  }
  
  // Invalidate all menu item caches for a company
  async invalidateMenuItems(companyId: string, itemId?: string): Promise<void> {
    // Invalidate list cache
    await this.cache.del(CacheKeys.menuItemsList(companyId));
    
    // Invalidate item caches
    if (itemId) {
      // Specific item
      await this.cache.del(CacheKeys.menuItem(companyId, itemId));
    } else {
      // All menu items for company
      await this.cache.invalidatePattern(CacheKeys.menuItemsPattern(companyId));
    }
  }
}

export const cacheInvalidator = new CacheInvalidator(cache);

// Cache debug logging helper (gated by env flag)
export function cacheLog(message: string, ...args: any[]): void {
  if (process.env.CACHE_DEBUG === 'true') {
    console.log(`[CACHE] ${message}`, ...args);
  }
}
