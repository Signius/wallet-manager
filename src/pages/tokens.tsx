import React, { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../styles/pages/Tokens.module.css";

type TokenRow = {
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

export default function TokensPage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<Partial<TokenRow>>({
    unit: "",
    display_name: "",
    ticker: "",
    is_active: true,
    pricing_source: "manual",
    kraken_pair_query: "",
    kraken_result_key_hint: "",
    coingecko_id: "",
    manual_price_usd: null,
  });

  async function loadTokens() {
    const resp = await fetch("/api/tokens");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load tokens");
    setTokens(data.tokens || []);
  }

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        await loadTokens();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function upsertToken(row: Partial<TokenRow>) {
    const resp = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to save token");
  }

  async function testToken(unit: string) {
    const resp = await fetch("/api/tokens/test-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Test failed");
    return data as { unit: string; price_usd: number | null; source: string | null; error: string | null };
  }

  async function handleAdd() {
    try {
      setBusy(true);
      setError(null);
      await upsertToken(form);
      setForm({
        unit: "",
        display_name: "",
        ticker: "",
        is_active: true,
        pricing_source: "manual",
        kraken_pair_query: "",
        kraken_result_key_hint: "",
        coingecko_id: "",
        manual_price_usd: null,
      });
      await loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Tokens</h1>
        <div className={styles.headerLinks}>
          <Link href="/wallets" className={styles.backLink}>
            ← Wallets
          </Link>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.card}>
        <h2>Add / update token</h2>
        <div className={styles.muted}>
          Store the identifiers required by price APIs. These definitions are used by cron snapshots to populate{" "}
          <code>token_price_snapshots</code>.
        </div>

        <div className={styles.formGrid}>
          <input
            className={styles.input}
            placeholder="unit (lovelace, BTC, or policy+assetNameHex)"
            value={String(form.unit || "")}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder="display name (optional)"
            value={String(form.display_name || "")}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder="ticker (optional)"
            value={String(form.ticker || "")}
            onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value }))}
          />

          <select
            className={styles.select}
            value={String(form.pricing_source || "manual")}
            onChange={(e) => setForm((f) => ({ ...f, pricing_source: e.target.value as TokenRow["pricing_source"] }))}
          >
            <option value="manual">Manual</option>
            <option value="kraken">Kraken</option>
            <option value="coingecko">CoinGecko</option>
          </select>

          {form.pricing_source === "kraken" ? (
            <>
              <input
                className={styles.input}
                placeholder="kraken_pair_query (e.g. ADAUSD, XBTUSD)"
                value={String(form.kraken_pair_query || "")}
                onChange={(e) => setForm((f) => ({ ...f, kraken_pair_query: e.target.value }))}
              />
              <input
                className={styles.input}
                placeholder="kraken_result_key_hint (e.g. ADAUSD, XBTUSD)"
                value={String(form.kraken_result_key_hint || "")}
                onChange={(e) => setForm((f) => ({ ...f, kraken_result_key_hint: e.target.value }))}
              />
            </>
          ) : null}

          {form.pricing_source === "coingecko" ? (
            <input
              className={styles.input}
              placeholder="coingecko_id (e.g. bitcoin)"
              value={String(form.coingecko_id || "")}
              onChange={(e) => setForm((f) => ({ ...f, coingecko_id: e.target.value }))}
            />
          ) : null}

          {form.pricing_source === "manual" ? (
            <input
              className={styles.input}
              placeholder="manual_price_usd"
              type="number"
              step={0.000001}
              value={form.manual_price_usd == null ? "" : String(form.manual_price_usd)}
              onChange={(e) => setForm((f) => ({ ...f, manual_price_usd: e.target.value ? Number(e.target.value) : null }))}
            />
          ) : null}
        </div>

        <button className={styles.primaryBtn} onClick={handleAdd} disabled={busy || !String(form.unit || "").trim()}>
          {busy ? "Saving..." : "Save token"}
        </button>
      </div>

      <div className={styles.card}>
        <h2>Configured tokens</h2>
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.headerRow}`}>
            <div>Unit</div>
            <div>Source</div>
            <div>Identifiers</div>
            <div>Test</div>
          </div>
          {tokens.map((t) => (
            <div key={t.unit} className={styles.row}>
              <div>
                <div className={styles.unit}>{t.ticker || t.display_name || t.unit}</div>
                <div className={styles.mutedSmall}>{t.unit}</div>
              </div>
              <div>{t.pricing_source}</div>
              <div className={styles.mono}>
                {t.pricing_source === "kraken" ? `${t.kraken_pair_query || ""} / ${t.kraken_result_key_hint || ""}` : null}
                {t.pricing_source === "coingecko" ? `${t.coingecko_id || ""}` : null}
                {t.pricing_source === "manual" ? `${t.manual_price_usd ?? ""}` : null}
              </div>
              <div>
                <button
                  className={styles.secondaryBtn}
                  onClick={async () => {
                    try {
                      setError(null);
                      const r = await testToken(t.unit);
                      if (r.price_usd == null) {
                        setError(`Test failed for ${t.unit}: ${r.error || "No price returned"} (${r.source || "no source"})`);
                      } else {
                        setError(`OK: ${t.unit} = $${Number(r.price_usd).toFixed(6)} (${r.source})`);
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Test price
                </button>
              </div>
            </div>
          ))}
          {tokens.length === 0 ? <div className={styles.muted}>No tokens configured yet.</div> : null}
        </div>
      </div>
    </div>
  );
}


