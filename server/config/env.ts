/**
 * Environment Variable Validation
 * Uses Zod to validate and type-check environment variables
 */

import { z } from 'zod';

const envSchema = z.object({
  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database (automatically set by Replit)
  DATABASE_URL: z.string().url().optional(),
  
  // Session
  SESSION_SECRET: z.string().optional(),
  
  // EDI Gateway Configuration
  EDI_GATEWAY_BASE_URL: z.string().url().optional(),
  EDI_GATEWAY_TOKEN: z.string().optional(),
  
  // AS2/EDI Webhook Security
  AS2_INBOUND_HMAC_SECRET: z.string().optional(),
  EDI_WEBHOOK_SECRET: z.string().optional(),
  
  // File Upload Configuration
  MAX_UPLOAD_SIZE_MB: z.string().transform(Number).pipe(z.number().positive()).default('20'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate and parse environment variables
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Invalid environment variables');
  }
  
  return result.data;
}

/**
 * Validated environment variables
 */
export const env = validateEnv();
