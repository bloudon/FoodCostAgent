import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure connection pool for multi-tenant production use
// Limits prevent overwhelming Neon's serverless connection limit (~80)
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10, // Max connections per server instance (Autoscale will add more instances as needed)
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast if pool is exhausted
});

export const db = drizzle({ client: pool, schema });
