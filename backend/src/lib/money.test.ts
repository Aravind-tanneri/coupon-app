import { describe, it, expect } from "vitest";
import {
  toPaise,
  toRupees,
  formatRupees,
  addPaise,
  subtractPaise,
  validatePaise,
} from "./money.js";

describe("Money Library (Paise Precision)", () => {
  it("converts rupees to paise accurately without floating point drift", () => {
    expect(toPaise(131)).toBe(13100);
    expect(toPaise(50.5)).toBe(5050);
    expect(toPaise(0.99)).toBe(99);
    expect(toPaise(0)).toBe(0);
  });

  it("converts paise to rupees", () => {
    expect(toRupees(13100)).toBe(131);
    expect(toRupees(5050)).toBe(50.5);
    expect(toRupees(78600)).toBe(786);
  });

  it("validates paise is a non-negative integer", () => {
    expect(() => validatePaise(100)).not.toThrow();
    expect(() => validatePaise(0)).not.toThrow();
    expect(() => validatePaise(-1)).toThrowError(/non-negative integer/);
    expect(() => validatePaise(12.34)).toThrowError(/non-negative integer/);
    expect(() => validatePaise("100" as unknown as number)).toThrowError(/non-negative integer/);
    expect(() => validatePaise(null as unknown as number)).toThrowError(/non-negative integer/);
  });

  it("formats rupees for display", () => {
    expect(formatRupees(78600)).toBe("₹786");
    expect(formatRupees(5050)).toBe("₹50.50");
    expect(formatRupees(78600, { showPaise: true })).toBe("₹786.00");
  });

  it("adds multiple paise values accurately", () => {
    expect(addPaise(13100, 13100, 13100)).toBe(39300);
    expect(addPaise(5000, 2500)).toBe(7500);
  });

  it("subtracts paise and prevents negative balance", () => {
    expect(subtractPaise(10000, 4000)).toBe(6000);
    expect(subtractPaise(5000, 5000)).toBe(0);
    expect(() => subtractPaise(2000, 5000)).toThrowError(/negative balance/);
  });
});
