import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';

// In-memory nonce cache (in production, use Redis)
const usedNonces = new Set<string>();
const NONCE_EXPIRY_MS = 900000; // 15 minutes

// Clean up expired nonces periodically
setInterval(() => {
  // In a real implementation, this would be handled by Redis TTL
  usedNonces.clear();
}, NONCE_EXPIRY_MS);

export interface HmacAuthRequest extends Request {
  companyId?: string;
  storeId?: string;
  apiCredentialId?: string;
}

/**
 * HMAC Authentication Middleware
 * Validates HMAC-SHA256 signatures for inbound data feeds
 * Expected headers:
 * - Authorization: HMAC-SHA256 <API_KEY_ID>:<SIGNATURE>
 * - X-Timestamp: <milliseconds since epoch>
 * - X-Nonce: <unique request identifier>
 * - X-Location-ID: <store ID for location-aware routing>
 */
export async function verifyHmacSignature(
  req: HmacAuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. Extract and validate Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('HMAC-SHA256 ')) {
      return res.status(401).json({ 
        error: 'Missing or invalid Authorization header',
        expected: 'Authorization: HMAC-SHA256 <API_KEY_ID>:<SIGNATURE>'
      });
    }

    const credentials = authHeader.slice(12); // Remove 'HMAC-SHA256 ' prefix
    const [apiKeyId, clientSignature] = credentials.split(':');
    
    if (!apiKeyId || !clientSignature) {
      return res.status(401).json({ 
        error: 'Invalid Authorization format',
        expected: 'HMAC-SHA256 <API_KEY_ID>:<SIGNATURE>'
      });
    }

    // 2. Extract required headers
    const timestamp = req.headers['x-timestamp'] as string;
    const nonce = req.headers['x-nonce'] as string;
    const locationId = req.headers['x-location-id'] as string;

    if (!timestamp || !nonce || !locationId) {
      return res.status(401).json({ 
        error: 'Missing required headers',
        required: ['X-Timestamp', 'X-Nonce', 'X-Location-ID']
      });
    }

    // 3. Validate timestamp (15 minute window to prevent replay attacks)
    const requestTime = parseInt(timestamp, 10);
    const now = Date.now();
    const timeDiff = Math.abs(now - requestTime);
    
    if (timeDiff > NONCE_EXPIRY_MS) {
      return res.status(401).json({ 
        error: 'Request expired',
        message: 'Timestamp must be within 15 minutes of server time',
        serverTime: now,
        requestTime: requestTime,
        diffMs: timeDiff
      });
    }

    // 4. Check nonce for replay protection
    if (usedNonces.has(nonce)) {
      return res.status(401).json({ 
        error: 'Duplicate nonce detected',
        message: 'This request has already been processed'
      });
    }
    usedNonces.add(nonce);
    // Clean up nonce after expiry window
    setTimeout(() => usedNonces.delete(nonce), NONCE_EXPIRY_MS);

    // 5. Retrieve API credential from database
    const credential = await storage.getApiCredentialByKeyId(apiKeyId);
    
    if (!credential || !credential.isActive) {
      return res.status(401).json({ 
        error: 'Invalid API key',
        message: 'API key not found or inactive'
      });
    }

    // 6. Verify the location is authorized for this credential
    const isLocationAuthorized = await storage.verifyApiCredentialLocation(
      credential.id,
      locationId
    );
    
    if (!isLocationAuthorized) {
      return res.status(403).json({ 
        error: 'Location not authorized',
        message: 'This API credential is not authorized to access the specified location'
      });
    }

    // 7. Optional: Check IP whitelist
    if (credential.allowedIps && credential.allowedIps.length > 0) {
      const clientIp = req.ip || req.connection.remoteAddress || '';
      const isIpAllowed = credential.allowedIps.some(allowedIp => {
        // Simple IP match (for CIDR support, use a library like 'ip-range-check')
        return clientIp.includes(allowedIp) || allowedIp === clientIp;
      });
      
      if (!isIpAllowed) {
        return res.status(403).json({ 
          error: 'IP not whitelisted',
          message: 'Request from unauthorized IP address'
        });
      }
    }

    // 8. Calculate content MD5
    const body = JSON.stringify(req.body || {});
    const contentMd5 = crypto.createHash('md5').update(body).digest('base64');

    // 9. Reconstruct string to sign (must match client's string)
    const stringToSign = [
      req.method,                         // HTTP method (POST, GET, etc.)
      contentMd5,                         // MD5 hash of request body
      req.headers['content-type'] || '',  // Content-Type header
      timestamp,                          // Request timestamp
      req.path,                           // Request path (e.g., /api/pos/sales)
      nonce                               // Unique nonce
    ].join('\n');

    // 10. Calculate server-side signature using the secret key
    const serverSignature = crypto
      .createHmac('sha256', credential.secretKey)
      .update(stringToSign)
      .digest('base64');

    // 11. Constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(clientSignature),
      Buffer.from(serverSignature)
    );

    if (!isValid) {
      return res.status(401).json({ 
        error: 'Invalid signature',
        message: 'HMAC signature verification failed'
      });
    }

    // 12. Update last used timestamp
    await storage.updateApiCredentialLastUsed(apiKeyId);

    // 13. Inject company and store context into request for downstream handlers
    req.companyId = credential.companyId;
    req.storeId = locationId;
    req.apiCredentialId = credential.id;

    next();
  } catch (error: any) {
    console.error('HMAC authentication error:', error);
    return res.status(500).json({ 
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * Optional middleware to require HMAC auth only for specific routes
 */
export function optionalHmacAuth(
  req: HmacAuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers['authorization'];
  
  // If HMAC header is present, validate it
  if (authHeader && authHeader.startsWith('HMAC-SHA256 ')) {
    return verifyHmacSignature(req, res, next);
  }
  
  // Otherwise, skip HMAC validation
  next();
}
