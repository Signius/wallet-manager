import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../styles/pages/Wallets.module.css";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type WalletRow = {
  id: string;
  stake_address: string;
  wallet_name: string | null;
  is_active: boolean;
  threshold_basis: "usd" | "ada" | "btc" | "holdings";
  deviation_threshold_pct_points: number;
  swap_fee_bps: number;
};

type TargetRow = { unit: string; target_pct_points: number };

type SeriesPoint = {
  snapshot_bucket: string;
  balances: Record<string, { quantity_raw: string; decimals: number | null }>;
  prices_usd: Record<string, number>;
};

type AssetOption = { unit: string; label: string };

function formatUnit(unit: string) {
  return unit === "lovelace" ? "ADA" : unit.slice(0, 8) + "…" + unit.slice(-6);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function applyDecimals(quantityRaw: string, decimals?: number | null): number {
  const q = Number(quantityRaw);
  if (!Number.isFinite(q)) return 0;
  if (!decimals || decimals <= 0) return q;
  return q / Math.pow(10, decimals);
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [newStake, setNewStake] = useState("");
  const [newName, setNewName] = useState("");
  const [targetRows, setTargetRows] = useState<TargetRow[]>([{ unit: "lovelace", target_pct_points: 100 }]);
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([{ unit: "lovelace", label: "ADA" }]);
  const [error, setError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualResult, setManualResult] = useState<string | null>(null);

  const unitLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of assetOptions) {
      if (o?.unit) m.set(o.unit, o.label || formatUnit(o.unit));
    }
    // Ensure common display names
    m.set("lovelace", "ADA");
    m.set("BTC", "BTC");
    return m;
  }, [assetOptions]);

  function labelForUnit(unit: string) {
    return unitLabelMap.get(unit) ?? formatUnit(unit);
  }

  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === selectedWalletId) ?? null,
    [wallets, selectedWalletId]
  );

  async function loadWallets() {
    const resp = await fetch("/api/wallets");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load wallets");
    setWallets(data.wallets || []);
    if (!selectedWalletId && data.wallets?.length) setSelectedWalletId(data.wallets[0].id);
  }

  async function loadTargets(walletId: string) {
    const resp = await fetch(`/api/wallets/${walletId}/targets`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load targets");
    setTargets(data.targets || []);
    if (data.targets?.length) setTargetRows(data.targets as TargetRow[]);
  }

  async function loadSeries(walletId: string) {
    const resp = await fetch(`/api/wallets/${walletId}/snapshots?hours=${24 * 14}`); // 14d
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load snapshot series");
    setSeries(data.series || []);
  }

  async function loadAssetOptions(walletId: string) {
    const resp = await fetch(`/api/wallets/${walletId}/asset-options`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load token options from Koios");

    const options = (data.options || []) as Array<{ unit: string; label: string }>;
    // Merge with any existing targets so users don't lose selection if token isn't currently held
    const targetUnits = (targets || []).map((t) => t.unit);
    const merged = new Map<string, AssetOption>();
    for (const o of options) merged.set(o.unit, o);
    for (const u of targetUnits) {
      if (!merged.has(u)) merged.set(u, { unit: u, label: formatUnit(u) });
    }
    // Ensure ADA is always present
    if (!merged.has("lovelace")) merged.set("lovelace", { unit: "lovelace", label: "ADA" });
    setAssetOptions(Array.from(merged.values()));
  }

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        await loadWallets();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedWalletId) return;
    (async () => {
      try {
        setError(null);
        // Load targets first so series loading can merge units
        await loadTargets(selectedWalletId);
        await loadAssetOptions(selectedWalletId);
        await loadSeries(selectedWalletId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWalletId]);

  const chartData = useMemo(() => {
    const units = ["lovelace", ...targets.map((t) => t.unit).filter((u) => u !== "lovelace")];
    const basis = selectedWallet?.threshold_basis ?? "usd";

    const data = series.map((p) => {
      const row: Record<string, string | number> = { t: p.snapshot_bucket };
      const adaUsd = p.prices_usd["lovelace"];
      const btcUsd = p.prices_usd["BTC"];

      // Compute values in the chosen basis
      const values: Record<string, number> = {};
      for (const u of units) {
        const bal = p.balances[u];
        const qty = bal ? applyDecimals(bal.quantity_raw, bal.decimals) : 0;
        if (basis === "holdings") {
          values[u] = qty;
        } else {
          const pu = p.prices_usd[u];
          const vUsd = pu != null ? qty * pu : 0;
          if (basis === "usd") values[u] = vUsd;
          else if (basis === "ada" && adaUsd) values[u] = vUsd / adaUsd;
          else if (basis === "btc" && btcUsd) values[u] = vUsd / btcUsd;
          else values[u] = vUsd;
        }
      }

      const denom = Object.values(values).reduce((acc, v) => acc + v, 0);
      for (const u of units) row[u] = denom > 0 ? (values[u] / denom) * 100 : 0;
      return row;
    });

    return { units, data };
  }, [series, targets, selectedWallet?.threshold_basis]);

  async function handleAddWallet() {
    try {
      setError(null);
      const resp = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_address: newStake.trim(), wallet_name: newName.trim() || undefined }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Failed to add wallet");
      setNewStake("");
      setNewName("");
      await loadWallets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const targetSum = useMemo(
    () => targetRows.reduce((acc, r) => acc + (Number.isFinite(r.target_pct_points) ? r.target_pct_points : 0), 0),
    [targetRows]
  );

  const hasDuplicateUnits = useMemo(() => {
    const seen = new Set<string>();
    for (const r of targetRows) {
      if (!r.unit) continue;
      if (seen.has(r.unit)) return true;
      seen.add(r.unit);
    }
    return false;
  }, [targetRows]);

  async function handleSaveTargets() {
    if (!selectedWalletId) return;
    try {
      setError(null);

      const parsed = targetRows
        .map((r) => ({ unit: r.unit, target_pct_points: Number(r.target_pct_points) }))
        .filter((x) => x.unit && Number.isFinite(x.target_pct_points) && x.target_pct_points >= 0);

      if (parsed.length === 0) throw new Error("Add at least one target token.");
      if (hasDuplicateUnits) throw new Error("Each token can only appear once in targets.");
      const sum = parsed.reduce((acc, r) => acc + r.target_pct_points, 0);
      if (Math.abs(sum - 100) > 0.01) throw new Error(`Targets must sum to 100 (currently ${sum.toFixed(2)})`);

      const resp = await fetch(`/api/wallets/${selectedWalletId}/targets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: parsed }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Failed to save targets");
      await loadTargets(selectedWalletId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleManualSnapshot() {
    if (!selectedWalletId) return;
    try {
      setError(null);
      setManualResult(null);
      setManualBusy(true);

      const resp = await fetch("/api/manual-snapshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ walletId: selectedWalletId }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Manual snapshot failed");

      setManualResult(
        `Snapshot completed (bucket ${data.snapshotBucket}). Processed ${data.processed} wallet(s).${
          data.errors?.length ? ` Errors: ${data.errors.join("; ")}` : ""
        }`
      );

      // refresh charts + options after snapshot
      await loadSeries(selectedWalletId);
      await loadAssetOptions(selectedWalletId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setManualBusy(false);
    }
  }

  function addTargetRow() {
    const availableUnits = assetOptions.map((o) => o.unit);
    const firstAvailable = availableUnits.find((u) => !targetRows.some((r) => r.unit === u)) || "lovelace";
    setTargetRows((rows) => [...rows, { unit: firstAvailable, target_pct_points: 0 }]);
  }

  function removeTargetRow(idx: number) {
    setTargetRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateTargetRow(idx: number, patch: Partial<TargetRow>) {
    setTargetRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Wallets Dashboard</h1>
        <Link href="/" className={styles.backLink}>
          ← Home
        </Link>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <h2>Tracked Wallets</h2>
            <div className={styles.walletList}>
              {wallets.map((w) => (
                <button
                  key={w.id}
                  className={`${styles.walletBtn} ${w.id === selectedWalletId ? styles.active : ""}`}
                  onClick={() => setSelectedWalletId(w.id)}
                >
                  <div className={styles.walletTitle}>{w.wallet_name || "Unnamed wallet"}</div>
                  <div className={styles.walletSub}>{w.stake_address.slice(0, 18)}…</div>
                </button>
              ))}
              {wallets.length === 0 && <div className={styles.muted}>No wallets tracked yet.</div>}
            </div>
          </div>

          <div className={styles.sidebarSection}>
            <h2>Add wallet</h2>
            <input
              className={styles.input}
              placeholder="stake1u…"
              value={newStake}
              onChange={(e) => setNewStake(e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Optional name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className={styles.primaryBtn} onClick={handleAddWallet} disabled={!newStake.trim()}>
              Add
            </button>
            <div className={styles.muted}>
              Tip: connecting a wallet in the navbar also auto-stores its stake address.
            </div>
          </div>
        </aside>

        <main className={styles.main}>
          {!selectedWallet ? (
            <div className={styles.card}>Select a wallet to view snapshots and targets.</div>
          ) : (
            <>
              <div className={styles.card}>
                <h2>{selectedWallet.wallet_name || "Unnamed wallet"}</h2>
                <div className={styles.muted}>
                  {selectedWallet.stake_address}
                  <br />
                  Deviation threshold: {selectedWallet.deviation_threshold_pct_points}pp • Swap fee:{" "}
                  {(selectedWallet.swap_fee_bps / 100).toFixed(2)}%
                </div>

                <div className={styles.settingsRow}>
                  <label className={styles.muted}>
                    Threshold basis
                    <select
                      className={styles.select}
                      value={selectedWallet.threshold_basis || "usd"}
                      onChange={async (e) => {
                        try {
                          setError(null);
                          const basis = e.target.value;
                          const resp = await fetch(`/api/wallets/${selectedWallet.id}/settings`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ threshold_basis: basis }),
                          });
                          const data = await resp.json();
                          if (!resp.ok) throw new Error(data?.error || "Failed to update basis");
                          await loadWallets();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      <option value="usd">USD value</option>
                      <option value="btc">BTC value (derived from USD)</option>
                      <option value="ada">ADA value (derived from USD)</option>
                      <option value="holdings">Holdings (quantity-based)</option>
                    </select>
                  </label>
                </div>

                <div className={styles.manualBox}>
                  <h3 className={styles.sectionTitle}>Manual snapshot</h3>
                  <div className={styles.muted}>
                    Uses the exact same snapshot pipeline as the cron job. Manual snapshots are limited to once every 10 minutes.
                  </div>
                  <div className={styles.manualRow}>
                    <button
                      className={styles.primaryBtn}
                      onClick={handleManualSnapshot}
                      disabled={manualBusy}
                    >
                      {manualBusy ? "Running..." : "Take snapshot now"}
                    </button>
                  </div>
                  {manualResult ? <div className={styles.muted}>{manualResult}</div> : null}
                </div>
              </div>

              <div className={styles.card}>
                <h2>Allocation over time (%, last 14 days)</h2>
                {chartData.data.length === 0 ? (
                  <div className={styles.muted}>No snapshots yet. (Run the GitHub Action or hit the snapshot API.)</div>
                ) : (
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chartData.data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="t" tickFormatter={formatTime} minTickGap={24} />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => Number(v).toFixed(2)} />
                        <Tooltip
                          labelFormatter={(v) => formatTime(String(v))}
                          formatter={(value, name) => [`${Number(value).toFixed(2)}%`, String(name)]}
                        />
                        {chartData.units.map((u, idx) => (
                          <Line
                            key={u}
                            type="monotone"
                            dataKey={u}
                            name={labelForUnit(u)}
                            strokeWidth={2}
                            dot={false}
                            stroke={["#4f46e5", "#059669", "#ea580c", "#dc2626", "#0891b2", "#7c3aed"][idx % 6]}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className={styles.card}>
                <h2>Latest token prices (USD)</h2>
                {series.length === 0 ? (
                  <div className={styles.muted}>No snapshots yet.</div>
                ) : (
                  (() => {
                    const last = series[series.length - 1];
                    const units = Array.from(new Set(["lovelace", "BTC", ...targets.map((t) => t.unit)]));
                    return (
                      <div className={styles.priceGrid}>
                        {units.map((u) => (
                          <div key={u} className={styles.priceCard}>
                            <div className={styles.priceUnit}>{formatUnit(u)}</div>
                            <div className={styles.priceValue}>
                              {last.prices_usd[u] != null ? `$${Number(last.prices_usd[u]).toFixed(6)}` : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}
                <div className={styles.muted}>
                  Note: non-ADA token USD prices currently come from `TOKEN_USD_PRICE_OVERRIDES_JSON` until a DEX/price API is integrated.
                </div>
              </div>

              <div className={styles.card}>
                <h2>Targets (must sum to 100)</h2>
                <div className={styles.muted}>
                  Pick tokens from the dropdown (from the wallet’s latest snapshot) and set desired allocation %.
                </div>

                <div className={styles.targetsTable}>
                  {targetRows.map((row, idx) => (
                    <div key={`${row.unit}-${idx}`} className={styles.targetRow}>
                      <select
                        className={styles.select}
                        value={row.unit}
                        onChange={(e) => updateTargetRow(idx, { unit: e.target.value })}
                      >
                        {assetOptions.map((o) => (
                          <option key={o.unit} value={o.unit}>
                            {o.label}
                          </option>
                        ))}
                      </select>

                      <input
                        className={styles.percentInput}
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.target_pct_points}
                        onChange={(e) => updateTargetRow(idx, { target_pct_points: Number(e.target.value) })}
                      />
                      <span className={styles.percentLabel}>%</span>

                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => removeTargetRow(idx)}
                        disabled={targetRows.length <= 1}
                        title="Remove"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <div className={styles.targetsActions}>
                    <button type="button" className={styles.secondaryBtn} onClick={addTargetRow}>
                      + Add token
                    </button>
                    <div className={styles.muted}>
                      Sum: <strong className={Math.abs(targetSum - 100) <= 0.01 ? styles.ok : styles.bad}>{targetSum.toFixed(2)}%</strong>
                      {hasDuplicateUnits ? <span className={styles.bad}> • Duplicate token selected</span> : null}
                    </div>
                  </div>
                </div>
                <div className={styles.row}>
                  <button className={styles.primaryBtn} onClick={handleSaveTargets} disabled={Math.abs(targetSum - 100) > 0.01 || hasDuplicateUnits}>
                    Save targets
                  </button>
                  <div className={styles.muted}>
                    Current:{" "}
                    {targets.length
                      ? targets.map((t) => `${formatUnit(t.unit)}=${t.target_pct_points}%`).join(", ")
                      : "none"}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}


