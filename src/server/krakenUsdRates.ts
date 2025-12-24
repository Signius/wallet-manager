export type KrakenUsdRates = {
  adaUsd: number;
  btcUsd: number;
};

type KrakenTickerResponse = {
  result?: Record<
    string,
    {
      c: string[]; // last trade closed [price, lot volume]
    }
  >;
};

export async function getKrakenUsdRates(): Promise<KrakenUsdRates> {
  // Kraken uses XBT for BTC
  const url = "https://api.kraken.com/0/public/Ticker?pair=ADAUSD,XBTUSD";
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`Kraken API error: ${resp.status} ${resp.statusText}`);

  const data = (await resp.json()) as KrakenTickerResponse;
  const result = data.result || {};

  // Result keys can vary (e.g., ADAUSD, XBTUSD) but generally include those
  const adaKey = Object.keys(result).find((k) => k.toUpperCase().includes("ADAUSD")) ?? "ADAUSD";
  const btcKey = Object.keys(result).find((k) => k.toUpperCase().includes("XBTUSD")) ?? "XBTUSD";

  const ada = Number(result[adaKey]?.c?.[0]);
  const btc = Number(result[btcKey]?.c?.[0]);

  if (!Number.isFinite(ada) || ada <= 0) throw new Error("Invalid ADAUSD from Kraken");
  if (!Number.isFinite(btc) || btc <= 0) throw new Error("Invalid BTCUSD from Kraken");

  return { adaUsd: ada, btcUsd: btc };
}


