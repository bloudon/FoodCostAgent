/**
 * AES-256-GCM field-level encryption for Square OAuth tokens.
 *
 * Key source: POS_TOKEN_ENCRYPTION_KEY environment secret — a 64-character
 * hex string (32 bytes / 256 bits).  Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Wire format (version 1):
 *   "v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>"
 *
 * Tokens without this prefix are treated as legacy plain-text and returned
 * as-is with a warning so existing rows continue to work until the startup
 * migration re-encrypts them.
 */
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // 96-bit IV — recommended for GCM
const TAG_BYTES = 16;  // 128-bit auth tag — GCM default
const VERSION_PREFIX = "v1:";

function getKey(): Buffer | null {
  const hex = process.env.POS_TOKEN_ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error(
      "POS_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
      `Got length ${hex.length}.`,
    );
  }
  return Buffer.from(hex, "hex");
}

/** Returns true when the stored value is AES-GCM encrypted by this module. */
export function isEncryptedToken(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}

/**
 * Encrypt a plain-text token.
 * Returns the plain text unchanged (with a console warning) when
 * POS_TOKEN_ENCRYPTION_KEY is not configured — allows the app to run in
 * development without the key while making the gap visible in logs.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  if (!key) {
    // Key not configured — store plain and warn.  The startup migration
    // will re-encrypt once the key is provided.
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[tokenCrypto] POS_TOKEN_ENCRYPTION_KEY is not set — " +
        "Square tokens will be stored as plain text. " +
        "Set the secret and restart to encrypt.",
      );
    }
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv) as crypto.CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    VERSION_PREFIX +
    iv.toString("base64") + ":" +
    authTag.toString("base64") + ":" +
    encrypted.toString("base64")
  );
}

/**
 * Decrypt a token encrypted by `encryptToken`.
 * - If the value is already plain-text (no v1 prefix), returns it as-is
 *   and logs a warning (legacy row not yet migrated).
 * - Throws if the value is encrypted but the key is unavailable or wrong.
 */
export function decryptToken(value: string): string {
  if (!isEncryptedToken(value)) {
    // Legacy plain-text row — pass through but warn.
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[tokenCrypto] Encountered a plain-text POS token — " +
        "run startup migration or set POS_TOKEN_ENCRYPTION_KEY to encrypt.",
      );
    }
    return value;
  }

  const key = getKey();
  if (!key) {
    throw new Error(
      "Cannot decrypt POS token: POS_TOKEN_ENCRYPTION_KEY is not set. " +
      "Provide the secret and restart.",
    );
  }

  const parts = value.slice(VERSION_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token: expected 3 colon-separated parts after version prefix.");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = crypto.createDecipheriv(ALGO, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * Returns the current tokenKeyVersion to store alongside encrypted tokens.
 * 0 = plain text (key not configured), 1 = AES-256-GCM v1.
 */
export function currentTokenKeyVersion(): number {
  return getKey() ? 1 : 0;
}

/** Convenience: re-encrypt a plain-text token only if the key is available. */
export function reencryptIfNeeded(storedValue: string): { value: string; version: number } {
  if (isEncryptedToken(storedValue)) {
    // Already encrypted — nothing to do.
    return { value: storedValue, version: 1 };
  }
  const encrypted = encryptToken(storedValue);
  return { value: encrypted, version: currentTokenKeyVersion() };
}
