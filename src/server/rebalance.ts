export type Allocation = {
  unit: string;
  currentPct: number;
  targetPct: number;
  diffPctPoints: number; // current - target
};

export type PriceMap = Record<string, { priceAda?: number }>;

export type RebalanceSuggestion = {
  fromUnit: string;
  toUnit: string;
  /** Quantity in human units (not raw integer) */
  fromQtyHuman: number;
  /** Expected received (human units), after fees */
  toQtyHuman: number;
  /** Estimated trade value in ADA (pre-fee) */
  tradeValueAda: number;
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
  totalValueAda: number;
  currentValuesAda: Record<string, number>; // unit -> value in ADA
  targetsPctPoints: Record<string, number>; // unit -> target % points
  prices: PriceMap; // unit -> priceAda
  swapFeeBps: number;
}): RebalancePlan {
  const { totalValueAda, currentValuesAda, targetsPctPoints, prices, swapFeeBps } = params;
  const notes: string[] = [];

  if (!Number.isFinite(totalValueAda) || totalValueAda <= 0) {
    return { allocations: [], suggestions: [], notes: ["Portfolio total value is zero; cannot rebalance."] };
  }

  const allUnits = Array.from(
    new Set([...Object.keys(currentValuesAda), ...Object.keys(targetsPctPoints)])
  );

  const allocations: Allocation[] = allUnits.map((unit) => {
    const currentAda = currentValuesAda[unit] ?? 0;
    const currentPct = (currentAda / totalValueAda) * 100;
    const targetPct = targetsPctPoints[unit] ?? 0;
    return {
      unit,
      currentPct,
      targetPct,
      diffPctPoints: currentPct - targetPct,
    };
  });

  // Compute desired vs current in ADA
  const deltas = allUnits.map((unit) => {
    const currentAda = currentValuesAda[unit] ?? 0;
    const targetPct = targetsPctPoints[unit] ?? 0;
    const desiredAda = (targetPct / 100) * totalValueAda;
    return { unit, currentAda, desiredAda, deltaAda: currentAda - desiredAda }; // + => overweight
  });

  const overweight = deltas
    .filter((d) => d.deltaAda > 1e-12)
    .sort((a, b) => b.deltaAda - a.deltaAda);
  const underweight = deltas
    .filter((d) => d.deltaAda < -1e-12)
    .sort((a, b) => a.deltaAda - b.deltaAda); // most negative first

  const fee = Math.max(0, swapFeeBps) / 10_000;
  const suggestions: RebalanceSuggestion[] = [];

  let i = 0;
  let j = 0;
  while (i < overweight.length && j < underweight.length) {
    const from = overweight[i];
    const to = underweight[j];

    const moveAda = Math.min(from.deltaAda, -to.deltaAda);
    if (moveAda <= 0) break;

    const fromPriceAda = prices[from.unit]?.priceAda;
    const toPriceAda = prices[to.unit]?.priceAda;

    if (!fromPriceAda || !toPriceAda) {
      notes.push(
        `Missing price for ${!fromPriceAda ? from.unit : ""}${!fromPriceAda && !toPriceAda ? " and " : ""}${
          !toPriceAda ? to.unit : ""
        }; cannot suggest swap for this leg.`
      );
      // Skip the one missing price to avoid infinite loop
      if (!fromPriceAda) i++;
      if (!toPriceAda) j++;
      continue;
    }

    const fromQty = moveAda / fromPriceAda;
    const receivedAda = moveAda * (1 - fee);
    const toQty = receivedAda / toPriceAda;

    suggestions.push({
      fromUnit: from.unit,
      toUnit: to.unit,
      fromQtyHuman: round(fromQty, 8),
      toQtyHuman: round(toQty, 8),
      tradeValueAda: round(moveAda, 6),
    });

    from.deltaAda -= moveAda;
    to.deltaAda += moveAda;

    if (from.deltaAda <= 1e-12) i++;
    if (to.deltaAda >= -1e-12) j++;
  }

  if (suggestions.length === 0) {
    notes.push("No actionable swap suggestions (already balanced or missing pricing).");
  }

  return { allocations, suggestions, notes };
}


