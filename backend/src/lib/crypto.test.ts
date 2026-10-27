import { describe, it, expect } from "vitest";
import {
  encryptPayout,
  decryptPayout,
  maskPayout,
  hashPassword,
  verifyPassword,
} from "./crypto.js";

describe("Crypto Library (AES-256-GCM and Argon2id)", () => {
  const secretKey = "0123456789abcdef0123456789abcdef";

  it("encrypts and decrypts sensitive payout strings with AES-256-GCM", () => {
    const original = "student@oksbi";
    const encrypted = encryptPayout(original, secretKey);

    expect(encrypted).not.toBe(original);
    expect(encrypted.split(":")).toHaveLength(3); // iv : tag : data

    const decrypted = decryptPayout(encrypted, secretKey);
    expect(decrypted).toBe(original);
  });

  it("fails to decrypt if payload has been tampered with", () => {
    const original = "987654321012";
    const encrypted = encryptPayout(original, secretKey);
    const parts = encrypted.split(":");

    // Alter ciphertext
    const tampered = `${parts[0]}:${parts[1]}:tamperedData`;
    expect(() => decryptPayout(tampered, secretKey)).toThrow();
  });

  it("fails to decrypt if wrong encryption key is supplied", () => {
    const original = "student@okhdfc";
    const encrypted = encryptPayout(original, secretKey);
    const wrongKey = "different_secret_key_1234567890";

    expect(() => decryptPayout(encrypted, wrongKey)).toThrow();
  });

  it("masks payout identifiers leaving only last 4 visible", () => {
    expect(maskPayout("student@okaxis")).toBe("****axis");
    expect(maskPayout("9876543210")).toBe("****3210");
    expect(maskPayout("123")).toBe("****");
    expect(maskPayout("")).toBe("****");
  });

  it("hashes and verifies passwords using argon2id", async () => {
    const password = "StrongPassword#2026";
    const hash = await hashPassword(password);

    expect(hash).toContain("$argon2id$");

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword("WrongPassword", hash);
    expect(isInvalid).toBe(false);
  });
});
