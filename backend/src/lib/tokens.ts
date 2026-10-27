import crypto from "crypto";

// Crockford Base32 alphabet: 32 characters, excludes I, L, O, U to prevent reading errors
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generates a cryptographically secure random token (default 128 bits / 16 bytes).
 * Returned as a base64url string.
 */
export function generateToken(byteLength = 16): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

/**
 * Computes SHA-256 hash of a token in hex format.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Generates an unambiguous Crockford Base32 short code for counter entry (e.g. "7K9X2MW4").
 */
export function generateShortCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    result += CROCKFORD_ALPHABET[byte % 32];
  }
  return result;
}

/**
 * Generates a server-issued single-use action nonce (e.g. "submit:a1b2c3d4").
 */
export function generateNonce(action = "action"): string {
  const randomPart = crypto.randomBytes(8).toString("hex");
  return `${action}:${randomPart}`;
}
