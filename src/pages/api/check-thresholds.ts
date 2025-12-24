import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../server/supabaseAdmin";
import { getTokenPrice } from "../../server/tokenPricing";
import { computeRebalancePlan } from "../../server/rebalance";
import { sendDiscordWebhook } from "../../server/discord";
import { assertSnapshotAuthorized } from "../../server/snapshotAuth";

const supabase = getSupabaseAdmin();

type ApiOk = { success: true; processedWallets: number; alertsSent: number };
type ApiErr = { error: string };

type WalletRow = {
  id: string;
  wallet_name: string | null;
  stake_address: string;
  deviation_threshold_pct_points: number;
  swap_fee_bps: number;
  is_active: boolean;
};

type TargetRow = { unit: string; target_pct_points: number };

type SnapshotRow = {
  id: string;
  wallet_id: string;
  snapshot_bucket: string;
  total_value_ada: number;
  ada_usd_rate: number;
};

type SnapshotAssetRow = {
  unit: string;
  value_ada: number | null;
  pct_of_portfolio: number | null;
};

function formatUnit(unit: string) {
  return unit === "lovelace" ? "ADA" : unit.slice(0, 8) + "…" + unit.slice(-6);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiOk | ApiErr>) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertSnapshotAuthorized(req);

    const { data: wallets, error: wErr } = await supabase
      .from("user_wallets")
      .select("id, wallet_name, stake_address, deviation_threshold_pct_points, swap_fee_bps, is_active")
      .eq("is_active", true);

    if (wErr) return res.status(500).json({ error: "Failed to fetch wallets" });
    if (!wallets || wallets.length === 0) return res.status(200).json({ success: true, processedWallets: 0, alertsSent: 0 });

    let alertsSent = 0;

    for (const wallet of wallets as WalletRow[]) {
      // Require targets to exist; otherwise no alerting for this wallet.
      const { data: targets, error: tErr } = await supabase
        .from("wallet_token_targets")
        .select("unit, target_pct_points")
        .eq("wallet_id", wallet.id);

      if (tErr || !targets || targets.length === 0) continue;

      const targetsMap: Record<string, number> = {};
      for (const t of targets as TargetRow[]) targetsMap[t.unit] = Number(t.target_pct_points);

      // Get latest snapshot for this wallet
      const { data: snap, error: sErr } = await supabase
        .from("wallet_snapshots")
        .select("id, wallet_id, snapshot_bucket, total_value_ada, ada_usd_rate")
        .eq("wallet_id", wallet.id)
        .order("snapshot_bucket", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sErr || !snap) continue;
      const snapshot = snap as SnapshotRow;

      const { data: assets, error: aErr } = await supabase
        .from("wallet_snapshot_assets")
        .select("unit, value_ada, pct_of_portfolio")
        .eq("snapshot_id", snapshot.id);

      if (aErr || !assets) continue;

      const currentValuesAda: Record<string, number> = {};
      const currentPct: Record<string, number> = {};

      for (const a of assets as SnapshotAssetRow[]) {
        if (a.value_ada != null) currentValuesAda[a.unit] = Number(a.value_ada);
        if (a.pct_of_portfolio != null) currentPct[a.unit] = Number(a.pct_of_portfolio);
      }

      // Determine deviations for the targeted units
      const threshold = Number(wallet.deviation_threshold_pct_points ?? 10);
      const deviations: Array<{ unit: string; currentPct: number; targetPct: number; diff: number }> = [];

      for (const [unit, target] of Object.entries(targetsMap)) {
        const c = currentPct[unit] ?? 0;
        const diff = c - target; // percentage points
        if (Math.abs(diff) >= threshold) {
          deviations.push({ unit, currentPct: c, targetPct: target, diff });
        }
      }

      if (deviations.length === 0) continue;

      // Build a price map for plan generation (ADA prices)
      const prices: Record<string, { priceAda?: number }> = {};
      for (const unit of Object.keys(targetsMap)) {
        const p = getTokenPrice(unit, snapshot.ada_usd_rate);
        if (p.priceAda != null) prices[unit] = { priceAda: p.priceAda };
      }
      // Always include ADA
      prices["lovelace"] = { priceAda: 1 };

      const plan = computeRebalancePlan({
        totalValueAda: Number(snapshot.total_value_ada),
        currentValuesAda,
        targetsPctPoints: targetsMap,
        prices,
        swapFeeBps: Number(wallet.swap_fee_bps ?? 30),
      });

      const webhook = process.env.DISCORD_WEBHOOK_URL;
      const walletLabel = wallet.wallet_name || wallet.stake_address.slice(0, 12) + "…";

      const contentLines: string[] = [];
      contentLines.push(`**Wallet threshold alert**: ${walletLabel}`);
      contentLines.push(`Snapshot bucket (UTC): ${snapshot.snapshot_bucket}`);
      contentLines.push(`Deviation threshold: ${threshold} percentage points`);
      contentLines.push("");
      contentLines.push("**Deviations** (current → target):");
      for (const d of deviations) {
        contentLines.push(
          `- ${formatUnit(d.unit)}: ${d.currentPct.toFixed(2)}% → ${d.targetPct.toFixed(2)}% (diff ${d.diff.toFixed(2)}pp)`
        );
      }
      contentLines.push("");
      contentLines.push("**Suggested swaps (approx)**:");
      if (plan.suggestions.length === 0) {
        contentLines.push("- (no swap plan available; missing pricing or already balanced)");
      } else {
        for (const s of plan.suggestions.slice(0, 10)) {
          contentLines.push(
            `- Swap ~${s.fromQtyHuman} ${formatUnit(s.fromUnit)} → ~${s.toQtyHuman} ${formatUnit(s.toUnit)} (value ~${s.tradeValueAda} ADA before fees)`
          );
        }
      }
      if (plan.notes.length) {
        contentLines.push("");
        contentLines.push("Notes:");
        for (const n of plan.notes.slice(0, 5)) contentLines.push(`- ${n}`);
      }

      // Persist alert event + send discord (if configured)
      const details = {
        snapshot_bucket: snapshot.snapshot_bucket,
        deviations,
        plan,
      };

      const { data: evt, error: evtErr } = await supabase
        .from("wallet_alert_events")
        .insert({
          wallet_id: wallet.id,
          snapshot_id: snapshot.id,
          deviation_threshold_pct_points: threshold,
          details,
          discord_sent: false,
        })
        .select("id")
        .single();

      if (evtErr) {
        // Skip sending to avoid duplicate spam without a record
        continue;
      }

      if (webhook) {
        try {
          await sendDiscordWebhook(webhook, contentLines.join("\n"));
          alertsSent++;
          const evtId = (evt as { id: string }).id;
          await supabase.from("wallet_alert_events").update({ discord_sent: true, discord_error: null }).eq("id", evtId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const evtId = (evt as { id: string }).id;
          await supabase.from("wallet_alert_events").update({ discord_sent: false, discord_error: msg }).eq("id", evtId);
        }
      }
    }

    return res.status(200).json({ success: true, processedWallets: wallets.length, alertsSent });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return res.status(status).json({ error: msg });
  }
}


