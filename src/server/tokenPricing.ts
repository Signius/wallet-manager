export type TokenPrice = {
  unit: string;
  /** Price per 1 whole token (human units), in ADA */
  priceAda?: number;
  /** Price per 1 whole token (human units), in USD */
  priceUsd?: number;
  source?: string;
};

type Overrides = Record<string, { priceAda?: number; priceUsd?: number }>;

function safeJsonParse<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getTokenPriceOverrides(): Overrides {
  const parsed = safeJsonParse<Overrides>(process.env.TOKEN_PRICE_OVERRIDES_JSON);
  return parsed ?? {};
}

/**
 * Minimal pricing layer.
 *
 * For now:
 * - ADA ('lovelace') is valued via adaUsdRate.
 * - Other tokens can be priced via TOKEN_PRICE_OVERRIDES_JSON (server-side env var).
 *
 * This keeps the architecture ready for a real on-chain / DEX / price API later.
 */
export function getTokenPrice(unit: string, adaUsdRate: number): TokenPrice {
  if (unit === "lovelace") {
    return { unit, priceAda: 1, priceUsd: adaUsdRate, source: "kraken:ADAUSD" };
  }

  const overrides = getTokenPriceOverrides();
  const override = overrides[unit];

  if (!override) return { unit, source: "unknown" };

  let priceUsd = override.priceUsd;
  const priceAda = override.priceAda;

  if (priceUsd == null && priceAda != null && adaUsdRate > 0) {
    priceUsd = priceAda * adaUsdRate;
  }

  return {
    unit,
    priceAda,
    priceUsd,
    source: "env:overrides",
  };
}

export function toSnapshotBucket(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0); // hour bucket in UTC
  return d;
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function lovelaceToAda(lovelace: number): number {
  return lovelace / 1_000_000;
}

export function applyDecimals(quantityRaw: string, decimals?: number): number {
  const q = Number(quantityRaw);
  if (!Number.isFinite(q)) return 0;
  if (!decimals || decimals <= 0) return q;
  return q / Math.pow(10, decimals);
}


