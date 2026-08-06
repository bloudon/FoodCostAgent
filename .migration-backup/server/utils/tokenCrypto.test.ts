/**
 * Unit tests for the AES-256-GCM token encryption utility.
 * Covers: round-trip, wrong key, tampered ciphertext, legacy plain-text passthrough,
 * format validation, key length validation, version detection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Reset the env key before each test to avoid cross-test interference.
const VALID_KEY = "a".repeat(64); // 32 bytes of 0xaa
const ANOTHER_KEY = "b".repeat(64); // different key

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.POS_TOKEN_ENCRYPTION_KEY;
});
afterEach(() => {
  if (savedKey === undefined) {
    delete process.env.POS_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.POS_TOKEN_ENCRYPTION_KEY = savedKey;
  }
});

async function importCrypto() {
  // Re-import after env change — vitest caches modules, so we use a dynamic
  // import trick with a cache-busting query to get fresh module state.
  // Since the module reads env vars at call time (not module load time), we
  // can just import once and the functions will pick up the current env value.
  return import("./tokenCrypto");
}

describe("isEncryptedToken", () => {
  it("returns true for v1-prefixed strings", async () => {
    const { isEncryptedToken } = await importCrypto();
    expect(isEncryptedToken("v1:someIV:someTag:someCt")).toBe(true);
  });

  it("returns false for plain-text strings", async () => {
    const { isEncryptedToken } = await importCrypto();
    expect(isEncryptedToken("EAAAlsomeLongSquareAccessToken")).toBe(false);
    expect(isEncryptedToken("")).toBe(false);
  });
});

describe("encryptToken + decryptToken — with key", () => {
  it("round-trips a Square access token", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken, decryptToken, isEncryptedToken } = await importCrypto();

    const plain = "EAAAlmySuperSecretSquareToken123456789";
    const enc = encryptToken(plain);

    expect(isEncryptedToken(enc)).toBe(true);
    expect(enc).not.toContain(plain);

    const dec = decryptToken(enc);
    expect(dec).toBe(plain);
  });

  it("produces different ciphertexts for the same input (random IV)", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken } = await importCrypto();
    const plain = "EAAAA_same_token";
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a).not.toBe(b); // different IVs
  });

  it("round-trips a null-ish refresh token (undefined passed as undefined)", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken, decryptToken } = await importCrypto();
    const token = "refresh_token_abcdef";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });
});

describe("encryptToken — without key", () => {
  it("returns the plain-text unchanged when key is not set", async () => {
    delete process.env.POS_TOKEN_ENCRYPTION_KEY;
    const { encryptToken, isEncryptedToken } = await importCrypto();
    const plain = "plain_token_no_key";
    const result = encryptToken(plain);
    expect(result).toBe(plain);
    expect(isEncryptedToken(result)).toBe(false);
  });
});

describe("decryptToken — plain-text passthrough (legacy rows)", () => {
  it("returns plain-text unchanged when no v1 prefix", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { decryptToken } = await importCrypto();
    const plain = "EAAAllegacyPlainToken";
    expect(decryptToken(plain)).toBe(plain);
  });
});

describe("decryptToken — error cases", () => {
  it("throws when trying to decrypt an encrypted value without the key", async () => {
    // Encrypt with key
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken } = await importCrypto();
    const enc = encryptToken("secret_token");

    // Remove key and try to decrypt
    delete process.env.POS_TOKEN_ENCRYPTION_KEY;
    const { decryptToken } = await importCrypto();
    expect(() => decryptToken(enc)).toThrow("POS_TOKEN_ENCRYPTION_KEY is not set");
  });

  it("throws on tampered ciphertext (GCM auth tag mismatch)", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken, decryptToken } = await importCrypto();
    const enc = encryptToken("tamper_me");

    // Corrupt the last character of the base64 ciphertext
    const parts = enc.split(":");
    parts[3] = parts[3].slice(0, -4) + "ZZZZ";
    const tampered = parts.join(":");

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on wrong decryption key (GCM auth tag mismatch)", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken } = await importCrypto();
    const enc = encryptToken("cross_key_token");

    process.env.POS_TOKEN_ENCRYPTION_KEY = ANOTHER_KEY;
    const { decryptToken } = await importCrypto();
    expect(() => decryptToken(enc)).toThrow();
  });

  it("throws on malformed v1 string (missing parts)", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { decryptToken } = await importCrypto();
    expect(() => decryptToken("v1:onlyOnePart")).toThrow("Malformed encrypted token");
  });
});

describe("getKey — validation", () => {
  it("throws when key is the wrong length", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = "tooshort";
    const { encryptToken } = await importCrypto();
    expect(() => encryptToken("anything")).toThrow("must be exactly 64 hex characters");
  });
});

describe("currentTokenKeyVersion", () => {
  it("returns 1 when the key is set", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { currentTokenKeyVersion } = await importCrypto();
    expect(currentTokenKeyVersion()).toBe(1);
  });

  it("returns 0 when the key is not set", async () => {
    delete process.env.POS_TOKEN_ENCRYPTION_KEY;
    const { currentTokenKeyVersion } = await importCrypto();
    expect(currentTokenKeyVersion()).toBe(0);
  });
});

describe("reencryptIfNeeded", () => {
  it("encrypts a plain-text value when key is available", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { reencryptIfNeeded, isEncryptedToken, decryptToken } = await importCrypto();
    const { value, version } = reencryptIfNeeded("plain_token_to_encrypt");
    expect(isEncryptedToken(value)).toBe(true);
    expect(decryptToken(value)).toBe("plain_token_to_encrypt");
    expect(version).toBe(1);
  });

  it("leaves an already-encrypted value unchanged", async () => {
    process.env.POS_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const { encryptToken, reencryptIfNeeded } = await importCrypto();
    const enc = encryptToken("already_encrypted");
    const { value, version } = reencryptIfNeeded(enc);
    expect(value).toBe(enc); // unchanged
    expect(version).toBe(1);
  });

  it("returns plain-text and version 0 when key is not set", async () => {
    delete process.env.POS_TOKEN_ENCRYPTION_KEY;
    const { reencryptIfNeeded, isEncryptedToken } = await importCrypto();
    const { value, version } = reencryptIfNeeded("plain_no_key");
    expect(value).toBe("plain_no_key");
    expect(isEncryptedToken(value)).toBe(false);
    expect(version).toBe(0);
  });
});
