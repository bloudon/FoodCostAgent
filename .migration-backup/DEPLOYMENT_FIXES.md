# Deployment Fixes - November 30, 2024

## Problem
The deployment was failing with the following issues:
1. Application was starting the `purge-company.ts` script instead of the web server
2. Application exited immediately with "main done, exiting"
3. Health checks failed because no web server was listening on port 5000
4. The start command ran but the application exited instead of staying alive

## Root Cause
The `server/scripts/purge-company.ts` script had a module check that executed `main()` when the file was loaded:

```typescript
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(...);
}
```

When esbuild bundled `server/index.ts`, it included the purge-company script (imported in `server/routes.ts`), and the `isMainModule` check incorrectly evaluated to `true` in the bundled code, causing the script to run and exit immediately.

## Solutions Implemented

### 1. Fixed purge-company Script Bundle Detection
**File**: `server/scripts/purge-company.ts`

Added an additional check to prevent execution when bundled:

```typescript
// Only run main() if this file is executed directly, not when bundled
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
const isBundled = !import.meta.url.includes('/server/scripts/');

if (isMainModule && !isBundled) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}
```

This ensures:
- ✅ Script runs when executed directly: `tsx server/scripts/purge-company.ts`
- ✅ Script does NOT run when bundled in `dist/index.js`
- ✅ Prevents immediate exit in production

### 2. Added Health Check Endpoints
**Files**: `server/routes.ts`, `server/index.ts`

#### API Health Endpoint
Added `/api/health` endpoint in `server/routes.ts`:

```typescript
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

#### Root Path Health Check
Added intelligent health check handler in `server/index.ts` for production mode:

```typescript
if (app.get("env") === "development") {
  await setupVite(app, server);
} else {
  // Fast health check at root before serving static files
  app.get('/', (req, res, next) => {
    // Health check probes typically:
    // 1. Have no User-Agent, or simple User-Agent (not a browser)
    // 2. Don't request HTML specifically (or use Accept: */*)
    // 3. Have no Referer header
    const userAgent = req.get('user-agent') || '';
    const hasReferer = !!req.get('referer');
    const accept = req.get('accept') || '';
    
    // If this looks like a health check probe, return immediately
    const isHealthCheck = 
      !hasReferer && 
      (!userAgent || !userAgent.includes('Mozilla')) &&
      (!accept || accept === '*/*' || !accept.includes('text/html'));
    
    if (isHealthCheck) {
      return res.status(200).send('OK');
    }
    
    // Otherwise, proceed to serve the SPA
    next();
  });
  
  serveStatic(app);
}
```

This ensures:
- ✅ Root path (/) returns 200 quickly for deployment health checks
- ✅ Detects health check probes by analyzing User-Agent, Accept, and Referer headers
- ✅ Normal browser requests still get the SPA (Mozilla user agent + HTML accept)
- ✅ No dependency on file I/O for health checks
- ✅ Works with common health check tools (curl, wget, load balancers)

### 3. Verified Build Process
**File**: `package.json`

The existing build script is correct:
```json
"build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
"start": "NODE_ENV=production node dist/index.js"
```

Verified:
- ✅ Build completes successfully
- ✅ Creates `dist/index.js` (548.5kb)
- ✅ Creates `dist/public/` with frontend assets
- ✅ Server starts and listens on port 5000
- ✅ Server stays running (doesn't exit)

## Testing Results

### Production Build Test
```bash
$ npm run build
✓ vite build succeeded
✓ esbuild bundled server/index.ts → dist/index.js (548.5kb)
```

### Production Server Test
```bash
$ NODE_ENV=production node dist/index.js
✅ Server started successfully
✅ WebSocket POS streaming enabled
✅ Database seeding completed
✅ Server listening on port 5000
✅ No "main done, exiting" message
✅ Server stays alive
```

### Health Check Tests
```bash
$ curl http://localhost:5000/api/health
{"status":"ok","timestamp":"2025-11-30T23:39:52.319Z"}  ✅

$ curl -H "Accept: application/json" http://localhost:5000/
OK  ✅ (fast health check response)

$ curl -H "Accept: text/html" http://localhost:5000/
[HTML for SPA]  ✅ (serves frontend)
```

## Deployment Checklist
- ✅ Build process correctly bundles server code
- ✅ Entry point (dist/index.js) starts Express server
- ✅ Server listens on port 5000 from process.env.PORT
- ✅ Server stays running (doesn't exit after initialization)
- ✅ Health check at root path (/) returns 200 quickly for probes
- ✅ Health check logic detects probes vs browsers intelligently
- ✅ Additional health check at /api/health for monitoring
- ✅ Static assets served correctly
- ✅ No scripts auto-execute when bundled
- ✅ SPA continues to work normally for browser requests

## Files Modified
1. `server/scripts/purge-company.ts` - Fixed bundle detection
2. `server/routes.ts` - Added /api/health endpoint
3. `server/index.ts` - Added root path health check for production

## Notes
- The purge-company script remains fully functional when run directly
- All existing functionality preserved
- No breaking changes to API or frontend
- Build time: ~20 seconds
- Bundle size: 548.5kb (server) + 1.4MB (client)
