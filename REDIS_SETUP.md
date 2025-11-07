# Redis Caching Setup Guide
## Phase 2 Performance Optimization

This application includes a comprehensive caching layer to dramatically improve performance. When Redis is configured, the system caches sessions, users, and frequently accessed data to reduce database load.

## Performance Impact

**Expected improvements with Redis enabled:**
- **Session lookups:** ~10ms → <1ms (10x faster)
- **Auth middleware overhead:** 100-200ms → <5ms  
- **Overall latency reduction:** 40-60% on authenticated endpoints
- **Database load reduction:** 50-70% fewer queries

## Quick Setup Options

### Option 1: Upstash Redis (Recommended - Serverless)

1. **Create Upstash Account:**
   - Visit https://upstash.com
   - Sign up for free tier (10,000 requests/day free)

2. **Create Redis Database:**
   - Click "Create Database"
   - Choose region closest to your Neon database
   - Select "Regional" (faster) or "Global" (multi-region)

3. **Get Connection URL:**
   - Copy the "REST URL" from database details
   - Format: `https://[endpoint].upstash.io`

4. **Add to Replit Secrets:**
   ```bash
   REDIS_URL=redis://[endpoint].upstash.io:[port]
   # OR use REST URL:
   UPSTASH_REDIS_REST_URL=https://[endpoint].upstash.io
   ```

5. **Add Auth Token (if using REST):**
   ```bash
   UPSTASH_REDIS_REST_TOKEN=[your-token]
   ```

### Option 2: Redis Labs (Redis Cloud)

1. **Create Redis Labs Account:**
   - Visit https://redis.com/try-free/
   - Sign up for free 30MB database

2. **Create Database:**
   - Select cloud provider (AWS recommended if using Neon)
   - Choose region matching your application

3. **Get Connection Details:**
   - Copy "Public endpoint"
   - Copy password

4. **Add to Replit Secrets:**
   ```bash
   REDIS_URL=redis://default:[password]@[endpoint]:[port]
   ```

### Option 3: Local Redis (Development Only)

**Not recommended for Replit** - Replit doesn't support background services. Use Upstash or Redis Labs instead.

## Verify Redis Connection

1. **Restart your application** after adding secrets
2. **Check logs for:** `✅ Redis cache connected successfully`
3. **If connection fails:** App continues to work, falling back to database queries

## Cache Configuration

All cache settings are in `server/cache.ts`:

```typescript
export const CacheTTL = {
  SESSION: 3600,           // 1 hour
  USER: 1800,              // 30 minutes
  COMPANY: 3600,           // 1 hour
  INVENTORY_ITEMS: 300,    // 5 minutes
  STORE_INVENTORY: 180,    // 3 minutes
  RECIPES: 600,            // 10 minutes
  MENU_ITEMS: 300,         // 5 minutes
} as const;
```

**To adjust TTL values:** Edit `CacheTTL` constants in `server/cache.ts`

## Cached Data

### Automatically Cached (Phase 2):
- ✅ **User sessions** - Cached after first lookup
- ✅ **User profiles** - Cached after authentication
- ✅ **Company metadata** - Cached on access

### Cache Invalidation:
- **Sessions:** Auto-invalidated on logout, company switch, or revocation
- **Users:** Auto-invalidated on profile updates
- **Inventory/Recipes:** Manual invalidation on create/update/delete (Phase 3)

## Monitoring Cache Performance

### Check Cache Hit Rate:

Add this route handler to `server/routes.ts` for debugging:

```typescript
app.get("/api/debug/cache-status", requireAuth, requireGlobalAdmin, async (req, res) => {
  res.json({
    enabled: cache.isEnabled(),
    message: cache.isEnabled() 
      ? "Redis cache connected" 
      : "Cache disabled - using database fallback"
  });
});
```

### Monitor Redis Usage:

**Upstash Dashboard:**
- View real-time request count
- Monitor latency
- Track bandwidth usage

**Redis Labs Dashboard:**
- Memory usage
- Operations per second
- Connection count

## Cost Estimates

### Upstash (Serverless - Pay per request)
- **Free tier:** 10,000 requests/day
- **Pro tier:** $0.20 per 100K requests
- **Estimated for 50-200 users:** $10-20/month

### Redis Labs (Fixed capacity)
- **Free tier:** 30MB, 30 connections
- **Paid:** Starting at $5/month for 100MB
- **Estimated for 50-200 users:** $10-15/month

## Troubleshooting

### "Cache disabled - no REDIS_URL"
✅ **Expected behavior** - App works fine without Redis, just slower

**To enable:**
1. Add `REDIS_URL` secret in Replit
2. Restart application
3. Check logs for connection success

### "Redis connection failed"
Possible causes:
1. ❌ Invalid connection URL
2. ❌ Wrong password/token
3. ❌ Firewall blocking connection
4. ❌ Redis instance not running

**Solution:**
- Verify credentials in Redis dashboard
- Test connection URL format
- Check Redis instance status
- App will continue working using database fallback

### "Cache errors in logs"
⚠️ **Non-critical** - Cache failures don't crash the app

**Common errors:**
- `ECONNREFUSED` - Redis instance down (check provider dashboard)
- `ERR auth failed` - Wrong password (update `REDIS_URL`)
- `Timeout` - Network issue (try different Redis region)

## Phase 3: Advanced Caching (Future)

**Planned improvements:**
- Inventory item list caching with smart invalidation
- Recipe cost caching (invalidate on ingredient price changes)
- Menu item caching with dependency tracking
- Cache warming on application startup
- Distributed cache with Redis Cluster

## Performance Validation

After enabling Redis, run load tests to measure improvement:

```bash
CONNECTIONS=100 DURATION=30 tsx server/load-test.ts
```

**Expected results:**
- Auth endpoint: 580ms → <100ms avg
- Inventory queries: 590ms → <250ms avg
- Overall latency: 548ms → <200ms avg at 100 concurrent users

## Security Notes

1. **Secure credentials:** Never commit `REDIS_URL` to git
2. **Use TLS:** Upstash and Redis Labs use TLS by default
3. **Sensitive data:** Session tokens are hashed before caching
4. **TTL enforcement:** All cached data expires automatically

## Need Help?

- **Upstash Docs:** https://upstash.com/docs/redis
- **Redis Labs Docs:** https://docs.redis.com/latest/
- **ioredis Docs:** https://github.com/luin/ioredis

---

**Status:** ✅ Redis caching infrastructure ready  
**Action Required:** Add `REDIS_URL` secret to enable caching  
**Expected Benefit:** 40-60% latency reduction on authenticated endpoints
