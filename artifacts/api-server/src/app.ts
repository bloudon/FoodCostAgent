import 'dotenv/config';
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import { registerRoutes } from "./routes";
import { logger } from "./lib/logger";
import { setupSsoAuth } from "./ssoAuth";
import { seedDatabase } from "./seed";
import healthRouter from "./routes/health";

const app: Express = express();

app.disable('etag');

// Expo is served from its own development origin, unlike the web SPA that
// shares the proxy origin. Keep mobile Bearer-token requests usable in Expo
// web previews and native clients without broadening production cookie access.
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || /^https:\/\/.+\.(replit\.dev|replit\.app)$/.test(origin)),
  allowedHeaders: ["Authorization", "Content-Type"],
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
}));

// Enable gzip compression for responses >1KB
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Raw body parser for webhooks (must come before JSON parser)
app.use('/webhooks/edi', express.raw({
  type: '*/*',
  verify: (req: any, _res, buf, encoding) => {
    req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
  }
}));

// Raw body parser for Stripe webhook
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Cookie parser (for signed cookies like invitation tokens)
app.use(cookieParser(process.env.SESSION_SECRET));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      logger.info(logLine);
    }
  });

  next();
});

// Health check — must be mounted before auth so it's always reachable
app.use("/api", healthRouter);

// Setup SSO auth (passport)
setupSsoAuth(app);

export { app };
export default app;
