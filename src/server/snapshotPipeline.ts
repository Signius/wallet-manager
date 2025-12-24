import type { KoiosAccountInfo, KoiosAsset } from "../services/walletService";
import { toIso, toSnapshotBucket } from "./tokenPricing";
import { getTokenUsdPrices } from "./tokenPriceService";

export type WalletRecord = {
  id: string;
  stake_address: string;
  wallet_name?: string;
};

type WalletSnapshotRow = {
  id: string;
  wallet_id: string;
};

type WalletSnapshotBalanceUpsertRow = {
  snapshot_id: string;
  unit: string;
  quantity_raw: number | string;
  decimals: number | null;
};

type TokenPriceSnapshotUpsertRow = {
  snapshot_bucket: string;
  unit: string;
  price_usd: number | null;
  source: string | null;
};

export type SnapshotPipelineResult = {
  processed: number;
  errors: string[];
  snapshotBucketIso: string;
};

function koiosHeaders() {
  const koiosApiKey = process.env.KOIOS_API_KEY;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (koiosApiKey) headers["Authorization"] = `Bearer ${koiosApiKey}`;
  return headers;
}

export async function runSnapshotPipeline(params: {
  supabase: {
    // supabase-js typings are heavy; keep this minimal and avoid `any` for lint.
    from: (table: string) => unknown;
  };
  wallets: WalletRecord[];
  /**
   * Per-wallet monitored token units (typically from wallet_token_targets).
   * This lets us avoid storing balances for every asset in large wallets.
   */
  monitoredUnitsByWalletId: Record<string, string[]>;
  /**
   * Global units to price for this run (deduped across wallets) in USD.
   * Should typically be union of all target units + 'lovelace' + 'BTC'.
   */
  unitsToPriceUsd: string[];
  now?: Date;
}): Promise<SnapshotPipelineResult> {
  const { supabase, wallets } = params;
  const errors: string[] = [];
  if (!wallets.length) {
    return { processed: 0, errors, snapshotBucketIso: toIso(toSnapshotBucket(params.now ?? new Date())) };
  }

  const now = params.now ?? new Date();
  const bucket = toSnapshotBucket(now);
  const snapshotAtIso = toIso(now);
  const snapshotBucketIso = toIso(bucket);

  const stakeAddresses = wallets.map((w) => w.stake_address);
  const headers = koiosHeaders();

  let accountInfo: KoiosAccountInfo[] = [];
  let accountAssets: KoiosAsset[] = [];

  try {
    [accountInfo, accountAssets] = await Promise.all([
      fetch("https://api.koios.rest/api/v1/account_info", {
        method: "POST",
        headers,
        body: JSON.stringify({ _stake_addresses: stakeAddresses }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Koios account_info API error: ${r.status} ${r.statusText}`);
        return (await r.json()) as KoiosAccountInfo[];
      }),
      fetch("https://api.koios.rest/api/v1/account_assets", {
        method: "POST",
        headers,
        body: JSON.stringify({ _stake_addresses: stakeAddresses }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Koios account_assets API error: ${r.status} ${r.statusText}`);
        return (await r.json()) as KoiosAsset[];
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { processed: 0, errors: [msg], snapshotBucketIso };
  }

  const assetsByAddress = new Map<string, KoiosAsset[]>();
  for (const asset of accountAssets) {
    if (!assetsByAddress.has(asset.stake_address)) assetsByAddress.set(asset.stake_address, []);
    assetsByAddress.get(asset.stake_address)!.push(asset);
  }

  // Upsert wallet snapshots (one per wallet per bucket)
  const snapshotRowsToUpsert: Array<{ wallet_id: string; snapshot_at: string; snapshot_bucket: string }> = [];

  for (const wallet of wallets) {
    const walletAccountInfo = accountInfo.find((acc) => acc.stake_address === wallet.stake_address);
    if (!walletAccountInfo) {
      errors.push(`No account info found for wallet ${wallet.stake_address}`);
      continue;
    }
    snapshotRowsToUpsert.push({ wallet_id: wallet.id, snapshot_at: snapshotAtIso, snapshot_bucket: snapshotBucketIso });
  }

  if (!snapshotRowsToUpsert.length) return { processed: 0, errors, snapshotBucketIso };

  const walletSnapshotsTable = supabase.from("wallet_snapshots") as {
    upsert: (
      rows: Record<string, unknown>[],
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ) => Promise<{ error: unknown | null }>;
    select: (cols: string) => {
      in: (col: string, values: string[]) => {
        eq: (col: string, value: string) => Promise<{ data: unknown; error: unknown | null }>;
      };
    };
  };

  const { error: insertError } = await walletSnapshotsTable.upsert(
    snapshotRowsToUpsert as unknown as Record<string, unknown>[],
    { onConflict: "wallet_id,snapshot_bucket", ignoreDuplicates: false }
  );

  if (insertError) {
    return { processed: 0, errors: [...errors, "Failed to save snapshots to database"], snapshotBucketIso };
  }

  // Fetch snapshot ids for this bucket to insert balances
  const walletIds = snapshotRowsToUpsert.map((s) => s.wallet_id);
  const { data: snapshotRows, error: snapshotFetchError } = await walletSnapshotsTable
    .select("id, wallet_id")
    .in("wallet_id", walletIds)
    .eq("snapshot_bucket", snapshotBucketIso);

  if (snapshotFetchError) {
    return { processed: snapshotRowsToUpsert.length, errors: [...errors, "Failed to fetch saved snapshots from database"], snapshotBucketIso };
  }

  const snapshotIdByWalletId = new Map<string, WalletSnapshotRow>();
  ((snapshotRows as WalletSnapshotRow[] | null) ?? []).forEach((row) => {
    snapshotIdByWalletId.set(row.wallet_id, row);
  });

  const balanceRows: WalletSnapshotBalanceUpsertRow[] = [];

  for (const wallet of wallets) {
    const snap = snapshotIdByWalletId.get(wallet.id);
    if (!snap) continue;

    const walletAccountInfo = accountInfo.find((acc) => acc.stake_address === wallet.stake_address);
    if (!walletAccountInfo) continue;
    const adaBalanceLovelace = parseInt(walletAccountInfo.total_balance, 10) || 0;
    balanceRows.push({
      snapshot_id: snap.id,
      unit: "lovelace",
      quantity_raw: adaBalanceLovelace,
      decimals: 6,
    });

    const walletAssets = assetsByAddress.get(wallet.stake_address) || [];
    const monitored = new Set(params.monitoredUnitsByWalletId[wallet.id] ?? []);
    // Always include ADA balances even if not explicitly targeted
    monitored.add("lovelace");

    const nonAdaAssets = walletAssets.filter((a) => a.policy_id !== "lovelace");

    for (const asset of nonAdaAssets) {
      const unit = `${asset.policy_id}${asset.asset_name || ""}`;
      if (!monitored.has(unit)) continue;
      balanceRows.push({
        snapshot_id: snap.id,
        unit,
        quantity_raw: asset.quantity,
        decimals: asset.decimals ?? null,
      });
    }
  }

  if (balanceRows.length > 0) {
    const balancesTable = supabase.from("wallet_snapshot_balances") as {
      upsert: (
        rows: WalletSnapshotBalanceUpsertRow[],
        opts: { onConflict: string; ignoreDuplicates: boolean }
      ) => Promise<{ error: unknown | null }>;
    };

    const { error: upsertErr } = await balancesTable.upsert(balanceRows, {
      onConflict: "snapshot_id,unit",
      ignoreDuplicates: false,
    });

    if (upsertErr) errors.push("Failed to save wallet snapshot balances to database");
  }

  // Price snapshotting (USD only) - deduped across wallets
  const unitsToPrice = Array.from(new Set(["lovelace", "BTC", ...(params.unitsToPriceUsd || [])]));
  const prices = await getTokenUsdPrices({ supabase: params.supabase, units: unitsToPrice });
  const tokenPriceRows: TokenPriceSnapshotUpsertRow[] = prices.map((p) => ({
    snapshot_bucket: snapshotBucketIso,
    unit: p.unit,
    price_usd: p.priceUsd ?? null,
    source: p.source ?? null,
  }));

  if (tokenPriceRows.length > 0) {
    const tokenPriceSnapshotsTable = supabase.from("token_price_snapshots") as {
      upsert: (
        rows: TokenPriceSnapshotUpsertRow[],
        opts: { onConflict: string; ignoreDuplicates: boolean }
      ) => Promise<{ error: unknown | null }>;
    };

    const { error: pricesUpsertError } = await tokenPriceSnapshotsTable.upsert(tokenPriceRows, {
      onConflict: "snapshot_bucket,unit",
      ignoreDuplicates: false,
    });

    if (pricesUpsertError) errors.push("Failed to save token price snapshots to database");
  }

  return { processed: snapshotRowsToUpsert.length, errors, snapshotBucketIso };
}


