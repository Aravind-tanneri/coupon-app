/**
 * Money calculations and formatting in integer paise.
 * Money is NEVER stored or calculated as floating-point rupees.
 */

export function toPaise(rupees: number): number {
  if (typeof rupees !== "number" || isNaN(rupees)) {
    throw new TypeError("Invalid rupees amount: must be a valid number");
  }
  return Math.round(rupees * 100);
}

export function toRupees(paise: number): number {
  validatePaise(paise);
  return paise / 100;
}

export function validatePaise(paise: unknown): asserts paise is number {
  if (typeof paise !== "number" || !Number.isInteger(paise) || paise < 0) {
    throw new TypeError(`Invalid paise amount [${String(paise)}]: must be a non-negative integer`);
  }
}

export function formatRupees(paise: number, options?: { showPaise?: boolean }): string {
  validatePaise(paise);
  const rupees = paise / 100;
  if (options?.showPaise || paise % 100 !== 0) {
    return `₹${rupees.toFixed(2)}`;
  }
  return `₹${rupees}`;
}

export function addPaise(...amounts: number[]): number {
  let total = 0;
  for (const amt of amounts) {
    validatePaise(amt);
    total += amt;
  }
  return total;
}

export function subtractPaise(base: number, deduction: number): number {
  validatePaise(base);
  validatePaise(deduction);
  const diff = base - deduction;
  if (diff < 0) {
    throw new RangeError(
      `Subtraction resulted in negative balance: ${base} - ${deduction} = ${diff}`,
    );
  }
  return diff;
}
