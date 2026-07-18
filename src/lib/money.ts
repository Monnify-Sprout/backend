// Currency math in naira with 2dp. Kept tiny and shared so invoice creation and
// webhook settlement compute the split identically.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface Split {
  commission: number; // Sprout's platform commission
  settlement: number; // what the merchant receives
}

export function computeSplit(amount: number, commissionPercent: number): Split {
  const commission = round2((amount * commissionPercent) / 100);
  return { commission, settlement: round2(amount - commission) };
}
