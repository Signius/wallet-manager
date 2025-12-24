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
  deviation_threshold_pct_points: number;
  swap_fee_bps: number;
};

type TargetRow = { unit: string; target_pct_points: number };

type SeriesPoint = {
  snapshot_bucket: string;
  total_value_ada: number;
  total_value_usd: number;
  allocations_pct: Record<string, number>;
};

function formatUnit(unit: string) {
  return unit === "lovelace" ? "ADA" : unit.slice(0, 8) + "…" + unit.slice(-6);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [newStake, setNewStake] = useState("");
  const [newName, setNewName] = useState("");
  const [targetDraft, setTargetDraft] = useState("lovelace=50\n<unit>=50");
  const [error, setError] = useState<string | null>(null);

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
    if (data.targets?.length) {
      setTargetDraft(
        data.targets.map((t: TargetRow) => `${t.unit}=${t.target_pct_points}`).join("\n")
      );
    }
  }

  async function loadSeries(walletId: string) {
    const resp = await fetch(`/api/wallets/${walletId}/snapshots?hours=${24 * 14}`); // 14d
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Failed to load snapshot series");
    setSeries(data.series || []);
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
        await Promise.all([loadTargets(selectedWalletId), loadSeries(selectedWalletId)]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [selectedWalletId]);

  const chartData = useMemo(() => {
    const units = ["lovelace", ...targets.map((t) => t.unit).filter((u) => u !== "lovelace")];
    return {
      units,
      data: series.map((p) => {
        const row: Record<string, string | number> = {
          t: p.snapshot_bucket,
        };
        for (const unit of units) row[unit] = p.allocations_pct[unit] ?? 0;
        return row;
      }),
    };
  }, [series, targets]);

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

  async function handleSaveTargets() {
    if (!selectedWalletId) return;
    try {
      setError(null);
      const parsed = targetDraft
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [unitRaw, pctRaw] = line.split("=");
          return { unit: unitRaw?.trim(), target_pct_points: Number(pctRaw) };
        })
        .filter((x) => x.unit && Number.isFinite(x.target_pct_points));

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
                        <YAxis domain={[0, 100]} />
                        <Tooltip labelFormatter={(v) => formatTime(String(v))} />
                        {chartData.units.map((u, idx) => (
                          <Line
                            key={u}
                            type="monotone"
                            dataKey={u}
                            name={formatUnit(u)}
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
                <h2>Targets (must sum to 100)</h2>
                <div className={styles.muted}>
                  Use `lovelace` for ADA. For native tokens use the Cardano unit: `policy_id + asset_name(hex)`.
                </div>
                <textarea
                  className={styles.textarea}
                  value={targetDraft}
                  onChange={(e) => setTargetDraft(e.target.value)}
                  rows={6}
                />
                <div className={styles.row}>
                  <button className={styles.primaryBtn} onClick={handleSaveTargets}>
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


