import { describe, it, expect } from "vitest";
import { generateToken, hashToken, generateShortCode, generateNonce } from "./tokens.js";

describe("Tokens Library", () => {
  it("generates 128-bit CSPRNG base64url tokens", () => {
    const token1 = generateToken();
    const token2 = generateToken();

    expect(token1).toBeDefined();
    expect(token1).not.toBe(token2);
    // 16 bytes base64url is 22 characters
    expect(token1.length).toBe(22);
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes tokens deterministically with SHA-256", () => {
    const token = "test-token-123";
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // 256 bits in hex
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates Crockford Base32 short codes without ambiguous characters", () => {
    const code = generateShortCode(8);
    expect(code).toHaveLength(8);
    // Must only contain Crockford Base32 characters (no I, L, O, U)
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(code).not.toMatch(/[ILOUilou]/);
  });

  it("generates collision-resistant short codes across iterations", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateShortCode(8));
    }
    expect(set.size).toBe(1000);
  });

  it("generates action nonces with prefix", () => {
    const nonce = generateNonce("submit");
    expect(nonce.startsWith("submit:")).toBe(true);
    expect(nonce.length).toBeGreaterThan(10);
  });
});
