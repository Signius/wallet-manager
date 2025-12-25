import React, { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../styles/pages/Tokens.module.css";

type WalletRow = {
  id: string;
  stake_address: string;
  wallet_name: string | null;
  is_active: boolean;
};

type AssetOption = {
  unit: string;
  label: string;
  ticker?: string | null;
};

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
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [assetsBusy, setAssetsBusy] = useState(false);

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [unitMode, setUnitMode] = useState<"wallet" | "custom">("wallet");
  const [pickedUnit, setPickedUnit] = useState<string>("");

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

  async function loadWallets() {
    const resp = await fetch("/api/wallets");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load wallets");
    const ws = (data.wallets || []) as WalletRow[];
    setWallets(ws);
    // Default to first wallet (if any) so token dropdown is usable immediately
    if (!selectedWalletId && ws.length) setSelectedWalletId(ws[0].id);
  }

  async function loadAssetOptions(walletId: string) {
    const resp = await fetch(`/api/wallets/${walletId}/asset-options`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load token options from wallet");
    setAssetOptions((data.options || []) as AssetOption[]);
  }

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
        await loadWallets();
        await loadTokens();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedWalletId) {
      setAssetOptions([]);
      return;
    }
    (async () => {
      try {
        setAssetsBusy(true);
        setError(null);
        await loadAssetOptions(selectedWalletId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAssetsBusy(false);
      }
    })();
  }, [selectedWalletId]);

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
      setUnitMode("wallet");
      setPickedUnit("");
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
          <select
            className={styles.select}
            value={selectedWalletId}
            onChange={(e) => {
              setSelectedWalletId(e.target.value);
              // Reset picker when wallet changes
              setPickedUnit("");
              setUnitMode("wallet");
              setForm((f) => ({ ...f, unit: "" }));
            }}
          >
            <option value="">Pick wallet (optional)</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {(w.wallet_name || w.stake_address || w.id).slice(0, 48)}
                {w.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={unitMode === "wallet" ? pickedUnit : "__custom__"}
            disabled={!selectedWalletId || assetsBusy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") {
                setUnitMode("custom");
                setPickedUnit("");
                setForm((f) => ({ ...f, unit: String(f.unit || "") }));
                return;
              }

              setUnitMode("wallet");
              setPickedUnit(v);
              const opt = assetOptions.find((o) => o.unit === v);
              setForm((f) => ({
                ...f,
                unit: v,
                ticker: f.ticker || opt?.ticker || f.ticker,
                display_name: f.display_name || (opt?.label && opt.label !== opt?.ticker ? opt.label : f.display_name),
              }));
            }}
          >
            <option value="">{assetsBusy ? "Loading wallet tokens..." : "Pick token from wallet"}</option>
            {assetOptions.map((o) => (
              <option key={o.unit} value={o.unit}>
                {o.label} ({o.unit === "lovelace" ? "lovelace" : o.unit.slice(0, 8) + "…" + o.unit.slice(-6)})
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>

          <input
            className={styles.input}
            placeholder="unit (lovelace, BTC, or policy+assetNameHex)"
            value={String(form.unit || "")}
            onChange={(e) => {
              setUnitMode("custom");
              setPickedUnit("");
              setForm((f) => ({ ...f, unit: e.target.value }));
            }}
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


