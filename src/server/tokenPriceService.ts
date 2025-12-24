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


