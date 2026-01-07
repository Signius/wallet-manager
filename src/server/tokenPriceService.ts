export type TokenDefinition = {
  unit: string;
  display_name: string | null;
  ticker: string | null;
  is_active: boolean;
  pricing_source: "kraken" | "coingecko" | "manual";
  kraken_pair_query: string | null;
  kraken_result_key_hint: string | null;
  coingecko_id: string | null;
  manual_price_usd: number | null;
};

export type TokenUsdPriceResult = {
  unit: string;
  priceUsd: number | null;
  source: string | null;
  error?: string;
};

type KrakenTickerResponse = {
  result?: Record<string, { c: string[] }>;
};

type KrakenUsdRates = { adaUsd: number; btcUsd: number };

async function fetchKrakenAdaBtcUsdRates(): Promise<KrakenUsdRates> {
  // Kraken uses XBT for BTC
  const url = "https://api.kraken.com/0/public/Ticker?pair=ADAUSD,XBTUSD";
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Kraken API error: ${resp.status} ${resp.statusText}`);
  const data = (await resp.json()) as KrakenTickerResponse;
  const result = data.result || {};

  const adaKey = Object.keys(result).find((k) => k.toUpperCase().includes("ADAUSD")) ?? "ADAUSD";
  const btcKey = Object.keys(result).find((k) => k.toUpperCase().includes("XBTUSD")) ?? "XBTUSD";
  const ada = Number(result[adaKey]?.c?.[0]);
  const btc = Number(result[btcKey]?.c?.[0]);

  if (!Number.isFinite(ada) || ada <= 0) throw new Error("Invalid ADAUSD from Kraken");
  if (!Number.isFinite(btc) || btc <= 0) throw new Error("Invalid BTCUSD from Kraken");
  return { adaUsd: ada, btcUsd: btc };
}

export async function getBaseUsdRates(): Promise<KrakenUsdRates> {
  // 1) Prefer Kraken (fast, no API key)
  try {
    return await fetchKrakenAdaBtcUsdRates();
  } catch {
    // fall through
  }

  // 2) Fallback to CoinGecko
  const cg = await fetchCoinGeckoUsd(["bitcoin", "cardano"]);
  const btc = cg["bitcoin"];
  const ada = cg["cardano"];
  if (!Number.isFinite(ada) || ada <= 0) throw new Error("Invalid ADAUSD from CoinGecko");
  if (!Number.isFinite(btc) || btc <= 0) throw new Error("Invalid BTCUSD from CoinGecko");
  return { adaUsd: ada, btcUsd: btc };
}

async function fetchKrakenPairsUsd(pairs: string[]): Promise<Record<string, number>> {
  if (pairs.length === 0) return {};
  const unique = Array.from(new Set(pairs.filter(Boolean)));
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(unique.join(","))}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Kraken API error: ${resp.status} ${resp.statusText}`);
  const data = (await resp.json()) as KrakenTickerResponse;
  const result = data.result || {};

  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(result)) {
    const price = Number(val?.c?.[0]);
    if (Number.isFinite(price) && price > 0) out[key] = price;
  }
  return out;
}

async function fetchCoinGeckoUsd(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const unique = Array.from(new Set(ids.filter(Boolean)));
  // CoinGecko simple price endpoint
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    unique.join(",")
  )}&vs_currencies=usd`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`CoinGecko API error: ${resp.status} ${resp.statusText}`);
  const data = (await resp.json()) as Record<string, { usd?: number }>;

  const out: Record<string, number> = {};
  for (const id of unique) {
    const price = Number(data?.[id]?.usd);
    if (Number.isFinite(price) && price > 0) out[id] = price;
  }
  return out;
}

function pickKrakenResultKey(result: Record<string, number>, hint: string | null, pair: string | null): string | null {
  if (hint) {
    const found = Object.keys(result).find((k) => k.toUpperCase().includes(hint.toUpperCase()));
    if (found) return found;
  }
  if (pair) {
    const found = Object.keys(result).find((k) => k.toUpperCase().includes(pair.toUpperCase()));
    if (found) return found;
  }
  // last resort: if only one key returned, use it
  const keys = Object.keys(result);
  return keys.length === 1 ? keys[0] : null;
}

export async function getTokenUsdPrices(params: {
  supabase: { from: (table: string) => unknown };
  units: string[];
}): Promise<TokenUsdPriceResult[]> {
  const units = Array.from(new Set(params.units.filter(Boolean)));
  if (units.length === 0) return [];

  // Always be able to price ADA + BTC even if there is no `tokens` table definition for them.
  // This avoids UI gaps (BTC showing "—") and keeps BTC/ADA basis math working.
  let krakenRates: KrakenUsdRates | null = null;
  if (units.includes("lovelace") || units.includes("BTC")) {
    try {
      krakenRates = await getBaseUsdRates();
    } catch {
      krakenRates = null;
    }
  }

  const tokensTable = params.supabase.from("tokens") as {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: unknown; error: unknown | null }>;
    };
  };

  const { data, error } = await tokensTable
    .select(
      "unit, display_name, ticker, is_active, pricing_source, kraken_pair_query, kraken_result_key_hint, coingecko_id, manual_price_usd"
    )
    .in("unit", units);

  if (error) {
    // If tokens table missing/misconfigured, return empty with errors.
    return units.map((unit) => ({
      unit,
      priceUsd: null,
      source: null,
      error: "Failed to query tokens table",
    }));
  }

  const defs = ((data as TokenDefinition[] | null) ?? []).filter((d) => d.is_active);
  const defByUnit = new Map(defs.map((d) => [d.unit, d]));

  const krakenDefs = defs.filter((d) => d.pricing_source === "kraken" && d.kraken_pair_query);
  const cgDefs = defs.filter((d) => d.pricing_source === "coingecko" && d.coingecko_id);
  const manualDefs = defs.filter((d) => d.pricing_source === "manual" && d.manual_price_usd != null);

  let krakenRaw: Record<string, number> = {};
  let cgRaw: Record<string, number> = {};
  try {
    krakenRaw = await fetchKrakenPairsUsd(krakenDefs.map((d) => d.kraken_pair_query!).filter(Boolean));
  } catch {
    // handled per-token below
  }
  try {
    cgRaw = await fetchCoinGeckoUsd(cgDefs.map((d) => d.coingecko_id!).filter(Boolean));
  } catch {
    // handled per-token below
  }

  const results: TokenUsdPriceResult[] = [];
  for (const unit of units) {
    if (unit === "lovelace") {
      results.push({
        unit,
        priceUsd: krakenRates?.adaUsd ?? null,
        source: krakenRates ? "kraken:ADAUSD" : null,
        error: krakenRates ? undefined : "Failed to fetch ADAUSD from Kraken",
      });
      continue;
    }

    if (unit === "BTC") {
      results.push({
        unit,
        priceUsd: krakenRates?.btcUsd ?? null,
        source: krakenRates ? "kraken:BTCUSD" : null,
        error: krakenRates ? undefined : "Failed to fetch BTCUSD from Kraken",
      });
      continue;
    }

    const def = defByUnit.get(unit);
    if (!def) {
      results.push({ unit, priceUsd: null, source: null, error: "No token definition" });
      continue;
    }

    if (def.pricing_source === "manual") {
      results.push({ unit, priceUsd: def.manual_price_usd ?? null, source: "manual" });
      continue;
    }

    if (def.pricing_source === "coingecko") {
      const id = def.coingecko_id;
      const p = id ? cgRaw[id] : undefined;
      results.push({
        unit,
        priceUsd: p ?? null,
        source: p != null ? `coingecko:${id}` : `coingecko:${id ?? "unknown"}`,
        error: p == null ? "Price not found" : undefined,
      });
      continue;
    }

    if (def.pricing_source === "kraken") {
      const key = pickKrakenResultKey(krakenRaw, def.kraken_result_key_hint, def.kraken_pair_query);
      const p = key ? krakenRaw[key] : undefined;
      results.push({
        unit,
        priceUsd: p ?? null,
        source: p != null ? `kraken:${key}` : `kraken:${def.kraken_pair_query ?? "unknown"}`,
        error: p == null ? "Price not found" : undefined,
      });
      continue;
    }

    results.push({ unit, priceUsd: null, source: null, error: "Unsupported pricing_source" });
  }

  return results;
}


