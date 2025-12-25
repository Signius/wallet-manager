import { computeRebalancePlan } from "./rebalance";
import { sendDiscordWebhook } from "./discord";

type WalletRow = {
  id: string;
  wallet_name: string | null;
  stake_address: string;
  threshold_basis: "usd" | "ada" | "btc" | "holdings";
  deviation_threshold_pct_points: number;
  swap_fee_bps: number;
  is_active: boolean;
};

type TargetRow = { unit: string; target_pct_points: number };

type SnapshotRow = {
  id: string;
  wallet_id: string;
  snapshot_bucket: string;
};

type SnapshotAssetRow = {
  unit: string;
  quantity_raw: string;
  decimals: number | null;
};

type PriceRow = {
  unit: string;
  price_usd: number | null;
};

function formatUnit(unit: string) {
  return unit === "lovelace" ? "ADA" : unit.slice(0, 8) + "…" + unit.slice(-6);
}

function applyDecimals(quantityRaw: string, decimals?: number | null): number {
  const q = Number(quantityRaw);
  if (!Number.isFinite(q)) return 0;
  if (!decimals || decimals <= 0) return q;
  return q / Math.pow(10, decimals);
}

export type RunThresholdAlertsResult = {
  processedWallets: number;
  alertsSent: number;
};

export async function runThresholdAlerts(params: {
  supabase: {
    from: (table: string) => unknown;
  };
  /**
   * Optional: restrict checks to a subset of wallet ids (useful for manual snapshots).
   */
  walletIds?: string[];
  /**
   * Optional: restrict checks to a specific snapshot bucket (ISO string in DB format).
   * If omitted, we evaluate the latest snapshot per wallet.
   */
  snapshotBucketIso?: string;
}): Promise<RunThresholdAlertsResult> {
  const supabase = params.supabase;

  type PostgrestResponse<T> = { data: T | null; error: unknown | null };

  const walletsTable = supabase.from("user_wallets") as unknown as {
    select: (cols: string) => {
      eq: (
        col: string,
        value: unknown
      ) => (Promise<PostgrestResponse<WalletRow[]>> & {
        in: (col: string, values: string[]) => Promise<PostgrestResponse<WalletRow[]>>;
      });
    };
  };

  const walletsResp =
    params.walletIds && params.walletIds.length > 0
      ? await walletsTable
          .select("id, wallet_name, stake_address, threshold_basis, deviation_threshold_pct_points, swap_fee_bps, is_active")
          .eq("is_active", true)
          .in("id", params.walletIds)
      : await walletsTable
          .select("id, wallet_name, stake_address, threshold_basis, deviation_threshold_pct_points, swap_fee_bps, is_active")
          .eq("is_active", true);

  if (walletsResp.error || !walletsResp.data) return { processedWallets: 0, alertsSent: 0 };

  const wallets = walletsResp.data;
  if (wallets.length === 0) return { processedWallets: 0, alertsSent: 0 };

  let alertsSent = 0;

  for (const wallet of wallets) {
    // Require targets to exist; otherwise no alerting for this wallet.
    const targetsTable = supabase.from("wallet_token_targets") as unknown as {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => Promise<PostgrestResponse<TargetRow[]>>;
      };
    };

    const targetsResp = await targetsTable.select("unit, target_pct_points").eq("wallet_id", wallet.id);

    if (targetsResp.error || !targetsResp.data || targetsResp.data.length === 0) continue;

    const targetsMap: Record<string, number> = {};
    for (const t of targetsResp.data) targetsMap[t.unit] = Number(t.target_pct_points);

    // Get snapshot for this wallet (bucket-scoped if provided, else latest)
    const snapshotsTable = supabase.from("wallet_snapshots") as unknown as {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => {
          eq: (col: string, value: unknown) => { maybeSingle: () => Promise<PostgrestResponse<SnapshotRow>> };
          order: (col: string, opts: { ascending: boolean }) => {
            limit: (n: number) => { maybeSingle: () => Promise<PostgrestResponse<SnapshotRow>> };
          };
          maybeSingle: () => Promise<PostgrestResponse<SnapshotRow>>;
        };
      };
    };

    const snapQuery = snapshotsTable.select("id, wallet_id, snapshot_bucket").eq("wallet_id", wallet.id);

    const snapResp =
      params.snapshotBucketIso != null
        ? await snapQuery.eq("snapshot_bucket", params.snapshotBucketIso).maybeSingle()
        : await snapQuery.order("snapshot_bucket", { ascending: false }).limit(1).maybeSingle();

    if (snapResp.error || !snapResp.data) continue;
    const snapshot = snapResp.data;

    // Idempotency: avoid duplicate alerts for the same snapshot_id
    const alertEventsTable = supabase.from("wallet_alert_events") as unknown as {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => {
          eq: (col: string, value: unknown) => {
            limit: (n: number) => { maybeSingle: () => Promise<PostgrestResponse<{ id: string }>> };
          };
        };
      };
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => { single: () => Promise<PostgrestResponse<{ id: string }>> };
      };
      update: (patch: Record<string, unknown>) => { eq: (col: string, value: unknown) => Promise<PostgrestResponse<unknown>> };
    };

    const existingResp = await alertEventsTable
      .select("id")
      .eq("wallet_id", wallet.id)
      .eq("snapshot_id", snapshot.id)
      .limit(1)
      .maybeSingle();
    if (!existingResp.error && existingResp.data) continue;

    const balancesTable = supabase.from("wallet_snapshot_balances") as unknown as {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => Promise<PostgrestResponse<SnapshotAssetRow[]>>;
      };
    };

    const assetsResp = await balancesTable.select("unit, quantity_raw, decimals").eq("snapshot_id", snapshot.id);

    if (assetsResp.error || !assetsResp.data) continue;

    const quantitiesHuman: Record<string, number> = {};
    for (const a of assetsResp.data) {
      quantitiesHuman[a.unit] = applyDecimals(a.quantity_raw, a.decimals);
    }

    // Load USD prices for the bucket (targets + ADA + BTC)
    const unitsNeeded = Array.from(new Set(["lovelace", "BTC", ...Object.keys(targetsMap)]));
    const pricesTable = supabase.from("token_price_snapshots") as unknown as {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => {
          in: (col: string, values: string[]) => Promise<PostgrestResponse<PriceRow[]>>;
        };
      };
    };

    const pricesResp = await pricesTable
      .select("unit, price_usd")
      .eq("snapshot_bucket", snapshot.snapshot_bucket)
      .in("unit", unitsNeeded);

    if (pricesResp.error) continue;

    const priceUsd: Record<string, number> = {};
    for (const p of pricesResp.data ?? []) {
      if (p.price_usd != null) priceUsd[p.unit] = Number(p.price_usd);
    }

    const adaUsd = priceUsd["lovelace"];
    const btcUsd = priceUsd["BTC"];

    const valueUsdByUnit: Record<string, number> = {};
    for (const unit of Object.keys(targetsMap)) {
      const qty = quantitiesHuman[unit] ?? 0;
      const pu = priceUsd[unit];
      if (pu != null) valueUsdByUnit[unit] = qty * pu;
    }
    // ADA (for allocation math) uses ADA amount and ADAUSD
    if (adaUsd != null) valueUsdByUnit["lovelace"] = (quantitiesHuman["lovelace"] ?? 0) * adaUsd;

    // Compute allocations based on wallet basis
    const basis = wallet.threshold_basis ?? "usd";
    const currentPct: Record<string, number> = {};
    const missingPrices: string[] = [];

    if (basis === "holdings") {
      // Quantity-based allocation across targeted units
      const totalQty = Object.keys(targetsMap).reduce((acc, unit) => acc + (quantitiesHuman[unit] ?? 0), 0);
      for (const unit of Object.keys(targetsMap)) {
        currentPct[unit] = totalQty > 0 ? ((quantitiesHuman[unit] ?? 0) / totalQty) * 100 : 0;
      }
    } else {
      for (const unit of Object.keys(targetsMap)) {
        if (unit !== "lovelace" && priceUsd[unit] == null) missingPrices.push(unit);
      }

      const totalUsd = Object.keys(targetsMap).reduce((acc, unit) => acc + (valueUsdByUnit[unit] ?? 0), 0);
      const denom =
        basis === "usd"
          ? totalUsd
          : basis === "ada" && adaUsd
            ? totalUsd / adaUsd
            : basis === "btc" && btcUsd
              ? totalUsd / btcUsd
              : totalUsd;

      for (const unit of Object.keys(targetsMap)) {
        const vUsd = valueUsdByUnit[unit] ?? 0;
        const v =
          basis === "usd"
            ? vUsd
            : basis === "ada" && adaUsd
              ? vUsd / adaUsd
              : basis === "btc" && btcUsd
                ? vUsd / btcUsd
                : vUsd;
        currentPct[unit] = denom > 0 ? (v / denom) * 100 : 0;
      }
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

    // Build a price map for plan generation (USD)
    const pricesForPlan: Record<string, { priceUsd?: number }> = {};
    for (const unit of Object.keys(targetsMap)) {
      if (priceUsd[unit] != null) pricesForPlan[unit] = { priceUsd: priceUsd[unit] };
    }
    // Allow ADA swaps too if ADAUSD exists
    if (priceUsd["lovelace"] != null) pricesForPlan["lovelace"] = { priceUsd: priceUsd["lovelace"] };

    const totalUsdForPlan = Object.keys(targetsMap).reduce((acc, unit) => acc + (valueUsdByUnit[unit] ?? 0), 0);
    const plan = computeRebalancePlan({
      totalValueUsd: totalUsdForPlan,
      currentValuesUsd: valueUsdByUnit,
      targetsPctPoints: targetsMap,
      prices: pricesForPlan,
      swapFeeBps: Number(wallet.swap_fee_bps ?? 30),
    });

    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const walletLabel = wallet.wallet_name || wallet.stake_address.slice(0, 12) + "…";

    const contentLines: string[] = [];
    contentLines.push(`**Wallet threshold alert**: ${walletLabel}`);
    contentLines.push(`Snapshot bucket (UTC): ${snapshot.snapshot_bucket}`);
    contentLines.push(`Threshold basis: ${basis.toUpperCase()}`);
    contentLines.push(`Deviation threshold: ${threshold} percentage points`);
    if (missingPrices.length) contentLines.push(`Missing prices: ${missingPrices.map(formatUnit).join(", ")}`);
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
          `- Swap ~${s.fromQtyHuman} ${formatUnit(s.fromUnit)} → ~${s.toQtyHuman} ${formatUnit(s.toUnit)} (value ~$${s.tradeValueUsd} before fees)`
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

    const evtResp = await alertEventsTable
      .insert({
        wallet_id: wallet.id,
        snapshot_id: snapshot.id,
        deviation_threshold_pct_points: threshold,
        details,
        discord_sent: false,
      })
      .select("id")
      .single();

    if (evtResp.error || !evtResp.data) {
      // Skip sending to avoid duplicate spam without a record
      continue;
    }

    if (webhook) {
      try {
        await sendDiscordWebhook(webhook, contentLines.join("\n"));
        alertsSent++;
        const evtId = evtResp.data.id;
        await alertEventsTable.update({ discord_sent: true, discord_error: null }).eq("id", evtId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const evtId = evtResp.data.id;
        await alertEventsTable.update({ discord_sent: false, discord_error: msg }).eq("id", evtId);
      }
    }
  }

  return { processedWallets: wallets.length, alertsSent };
}


