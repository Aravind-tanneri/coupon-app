import crypto from "crypto";
import argon2 from "argon2";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard 96-bit IV for GCM

function deriveKey(rawKey?: string): Buffer {
  const secret = rawKey || env.PAYOUT_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("Payout encryption key is not configured");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts sensitive payout data using AES-256-GCM with authenticated tags.
 * Output format: base64(iv):base64(tag):base64(ciphertext)
 */
export function encryptPayout(plaintext: string, rawKey?: string): string {
  const key = deriveKey(rawKey);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts sensitive payout data with AES-256-GCM authentication verification.
 */
export function decryptPayout(payload: string, rawKey?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivBase64, tagBase64, dataBase64] = parts;
  if (!ivBase64 || !tagBase64 || !dataBase64) {
    throw new Error("Missing encrypted components");
  }

  const key = deriveKey(rawKey);
  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const encrypted = Buffer.from(dataBase64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Masks sensitive payout identifier (e.g. UPI ID or account number), keeping only last 4 characters visible.
 */
export function maskPayout(payout: string): string {
  const clean = payout.trim();
  if (clean.length <= 4) {
    return "****";
  }
  const visible = clean.slice(-4);
  return `****${visible}`;
}

/**
 * Hashes passwords using argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Verifies password against an argon2id hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
