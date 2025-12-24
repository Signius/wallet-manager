type Overrides = Record<
  string,
  {
    /** USD price per 1 whole token (human units) */
    priceUsd?: number;
  }
>;

function safeJsonParse<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getTokenUsdPriceOverrides(): Overrides {
  return safeJsonParse<Overrides>(process.env.TOKEN_USD_PRICE_OVERRIDES_JSON) ?? {};
}

export type TokenUsdPrice = {
  unit: string;
  priceUsd?: number;
  source?: string;
};

export function getTokenUsdPrice(unit: string, opts: { adaUsd: number; btcUsd: number }): TokenUsdPrice {
  if (unit === "lovelace") return { unit, priceUsd: opts.adaUsd, source: "kraken:ADAUSD" };
  if (unit === "BTC") return { unit, priceUsd: opts.btcUsd, source: "kraken:BTCUSD" };

  const overrides = getTokenUsdPriceOverrides();
  const o = overrides[unit];
  if (o?.priceUsd != null) return { unit, priceUsd: o.priceUsd, source: "env:overrides" };

  return { unit, source: "unknown" };
}


