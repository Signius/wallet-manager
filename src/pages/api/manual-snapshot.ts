import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../server/supabaseAdmin";
import { runSnapshotPipeline, type WalletRecord } from "../../server/snapshotPipeline";

const supabase = getSupabaseAdmin();

type ManualSnapshotResponse =
  | {
      success: true;
      processed: number;
      errors: string[];
      snapshotBucket: string;
    }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ManualSnapshotResponse>) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = (req.body || {}) as { walletId?: string; allWallets?: boolean };
    const walletId = body.walletId;
    const allWallets = Boolean(body.allWallets);

    let wallets: WalletRecord[] = [];

    if (walletId && !allWallets) {
      const { data, error } = await supabase
        .from("user_wallets")
        .select("id, stake_address, wallet_name")
        .eq("id", walletId)
        .maybeSingle();

      if (error) return res.status(500).json({ error: "Failed to fetch wallet" });
      if (!data) return res.status(404).json({ error: "Wallet not found" });
      wallets = [data as WalletRecord];
    } else {
      const { data, error } = await supabase
        .from("user_wallets")
        .select("id, stake_address, wallet_name")
        .eq("is_active", true);

      if (error) return res.status(500).json({ error: "Failed to fetch wallets" });
      wallets = (data ?? []) as WalletRecord[];
    }

    // Cooldown: only allow manual snapshots every 10 minutes (per wallet, based on last snapshot_at).
    // Note: this will also throttle manual snapshots if a cron snapshot ran recently, which is acceptable.
    const COOLDOWN_MS = 10 * 60 * 1000;
    const now = Date.now();
    if (wallets.length > 0) {
      const walletIds = wallets.map((w) => w.id);
      const { data: latest, error: latestErr } = await supabase
        .from("wallet_snapshots")
        .select("wallet_id, snapshot_at")
        .in("wallet_id", walletIds)
        .order("snapshot_at", { ascending: false })
        .limit(1);

      if (latestErr) return res.status(500).json({ error: "Failed to check manual snapshot cooldown" });

      const row = (latest ?? [])[0] as { wallet_id: string; snapshot_at: string } | undefined;
      if (row?.snapshot_at) {
        const last = new Date(row.snapshot_at).getTime();
        if (Number.isFinite(last) && now - last < COOLDOWN_MS) {
          const remainingMs = COOLDOWN_MS - (now - last);
          const remainingMin = Math.ceil(remainingMs / 60000);
          return res.status(429).json({ error: `Manual snapshots are limited to once every 10 minutes. Try again in ~${remainingMin} minute(s).` });
        }
      }
    }

    // Determine monitored units (targets) for these wallets; we only store balances for monitored tokens.
    const walletIds = wallets.map((w) => w.id);
    const { data: targets, error: tErr } = await supabase
      .from("wallet_token_targets")
      .select("wallet_id, unit")
      .in("wallet_id", walletIds);

    if (tErr) return res.status(500).json({ error: "Failed to fetch wallet targets" });

    const monitoredUnitsByWalletId: Record<string, string[]> = {};
    const unitsToPrice = new Set<string>();
    for (const w of walletIds) monitoredUnitsByWalletId[w] = [];

    for (const row of (targets ?? []) as Array<{ wallet_id: string; unit: string }>) {
      monitoredUnitsByWalletId[row.wallet_id] = monitoredUnitsByWalletId[row.wallet_id] || [];
      monitoredUnitsByWalletId[row.wallet_id].push(row.unit);
      unitsToPrice.add(row.unit);
    }
    unitsToPrice.add("lovelace");
    unitsToPrice.add("BTC");

    const result = await runSnapshotPipeline({
      supabase,
      wallets,
      monitoredUnitsByWalletId,
      unitsToPriceUsd: Array.from(unitsToPrice),
    });

    return res.status(200).json({
      success: true,
      processed: result.processed,
      errors: result.errors,
      snapshotBucket: result.snapshotBucketIso,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: msg });
  }
}


