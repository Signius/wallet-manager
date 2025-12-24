export type Allocation = {
  unit: string;
  currentPct: number;
  targetPct: number;
  diffPctPoints: number; // current - target
};

export type PriceMap = Record<string, { priceUsd?: number }>;

export type RebalanceSuggestion = {
  fromUnit: string;
  toUnit: string;
  /** Quantity in human units (not raw integer) */
  fromQtyHuman: number;
  /** Expected received (human units), after fees */
  toQtyHuman: number;
  /** Estimated trade value in USD (pre-fee) */
  tradeValueUsd: number;
};

export type RebalancePlan = {
  allocations: Allocation[];
  suggestions: RebalanceSuggestion[];
  notes: string[];
};

function round(n: number, dp = 6) {
  const p = Math.pow(10, dp);
  return Math.round(n * p) / p;
}

/**
 * Greedy rebalance:
 * - Compute token value deltas vs target, in ADA.
 * - Move value from "overweight" to "underweight" until balanced.
 *
 * This is a reasonable baseline strategy and easy to explain in Discord.
 * Later we can optimize for fewer swaps or include DEX routing.
 */
export function computeRebalancePlan(params: {
  totalValueUsd: number;
  currentValuesUsd: Record<string, number>; // unit -> value in USD
  targetsPctPoints: Record<string, number>; // unit -> target % points
  prices: PriceMap; // unit -> priceAda
  swapFeeBps: number;
}): RebalancePlan {
  const { totalValueUsd, currentValuesUsd, targetsPctPoints, prices, swapFeeBps } = params;
  const notes: string[] = [];

  if (!Number.isFinite(totalValueUsd) || totalValueUsd <= 0) {
    return { allocations: [], suggestions: [], notes: ["Portfolio total value is zero; cannot rebalance."] };
  }

  const allUnits = Array.from(
    new Set([...Object.keys(currentValuesUsd), ...Object.keys(targetsPctPoints)])
  );

  const allocations: Allocation[] = allUnits.map((unit) => {
    const currentUsd = currentValuesUsd[unit] ?? 0;
    const currentPct = (currentUsd / totalValueUsd) * 100;
    const targetPct = targetsPctPoints[unit] ?? 0;
    return {
      unit,
      currentPct,
      targetPct,
      diffPctPoints: currentPct - targetPct,
    };
  });

  // Compute desired vs current in USD
  const deltas = allUnits.map((unit) => {
    const currentUsd = currentValuesUsd[unit] ?? 0;
    const targetPct = targetsPctPoints[unit] ?? 0;
    const desiredUsd = (targetPct / 100) * totalValueUsd;
    return { unit, currentUsd, desiredUsd, deltaUsd: currentUsd - desiredUsd }; // + => overweight
  });

  const overweight = deltas
    .filter((d) => d.deltaUsd > 1e-12)
    .sort((a, b) => b.deltaUsd - a.deltaUsd);
  const underweight = deltas
    .filter((d) => d.deltaUsd < -1e-12)
    .sort((a, b) => a.deltaUsd - b.deltaUsd); // most negative first

  const fee = Math.max(0, swapFeeBps) / 10_000;
  const suggestions: RebalanceSuggestion[] = [];

  let i = 0;
  let j = 0;
  while (i < overweight.length && j < underweight.length) {
    const from = overweight[i];
    const to = underweight[j];

    const moveUsd = Math.min(from.deltaUsd, -to.deltaUsd);
    if (moveUsd <= 0) break;

    const fromPriceUsd = prices[from.unit]?.priceUsd;
    const toPriceUsd = prices[to.unit]?.priceUsd;

    if (!fromPriceUsd || !toPriceUsd) {
      notes.push(
        `Missing USD price for ${!fromPriceUsd ? from.unit : ""}${!fromPriceUsd && !toPriceUsd ? " and " : ""}${
          !toPriceUsd ? to.unit : ""
        }; cannot suggest swap for this leg.`
      );
      // Skip the one missing price to avoid infinite loop
      if (!fromPriceUsd) i++;
      if (!toPriceUsd) j++;
      continue;
    }

    const fromQty = moveUsd / fromPriceUsd;
    const receivedUsd = moveUsd * (1 - fee);
    const toQty = receivedUsd / toPriceUsd;

    suggestions.push({
      fromUnit: from.unit,
      toUnit: to.unit,
      fromQtyHuman: round(fromQty, 8),
      toQtyHuman: round(toQty, 8),
      tradeValueUsd: round(moveUsd, 6),
    });

    from.deltaUsd -= moveUsd;
    to.deltaUsd += moveUsd;

    if (from.deltaUsd <= 1e-12) i++;
    if (to.deltaUsd >= -1e-12) j++;
  }

  if (suggestions.length === 0) {
    notes.push("No actionable swap suggestions (already balanced or missing pricing).");
  }

  return { allocations, suggestions, notes };
}


