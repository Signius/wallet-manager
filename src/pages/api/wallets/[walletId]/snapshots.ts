import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

type SnapshotRow = {
  id: string;
  snapshot_bucket: string;
};

type AssetRow = {
  snapshot_id: string;
  unit: string;
  quantity_raw: string;
  decimals: number | null;
};

type PriceRow = {
  snapshot_bucket: string;
  unit: string;
  price_usd: number | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const walletId = Array.isArray(req.query.walletId) ? req.query.walletId[0] : req.query.walletId;
  if (!walletId || !isUuid(walletId)) return res.status(400).json({ error: "Invalid walletId" });

  const hoursStr = Array.isArray(req.query.hours) ? req.query.hours[0] : req.query.hours;
  const hours = hoursStr ? Math.max(1, Math.min(24 * 365, parseInt(hoursStr, 10))) : 24 * 7; // default 7d
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data: snaps, error: sErr } = await supabase
    .from("wallet_snapshots")
    .select("id, snapshot_bucket")
    .eq("wallet_id", walletId)
    .gte("snapshot_bucket", since)
    .order("snapshot_bucket", { ascending: true });

  if (sErr) return res.status(500).json({ error: "Failed to fetch snapshots" });
  const snapshots = (snaps ?? []) as SnapshotRow[];
  if (snapshots.length === 0) return res.status(200).json({ series: [] });

  const ids = snapshots.map((s) => s.id);
  const { data: assets, error: aErr } = await supabase
    .from("wallet_snapshot_balances")
    .select("snapshot_id, unit, quantity_raw, decimals")
    .in("snapshot_id", ids);

  if (aErr) return res.status(500).json({ error: "Failed to fetch snapshot assets" });

  const bySnapBalances = new Map<string, Record<string, { quantity_raw: string; decimals: number | null }>>();
  for (const a of (assets ?? []) as AssetRow[]) {
    if (!bySnapBalances.has(a.snapshot_id)) bySnapBalances.set(a.snapshot_id, {});
    bySnapBalances.get(a.snapshot_id)![a.unit] = { quantity_raw: a.quantity_raw, decimals: a.decimals ?? null };
  }

  // Fetch prices for these buckets (USD only). We return them so the frontend can compute allocations for USD/BTC/ADA.
  const buckets = snapshots.map((s) => s.snapshot_bucket);
  const units = Array.from(
    new Set(
      ["lovelace", "BTC", ...Array.from(bySnapBalances.values()).flatMap((m) => Object.keys(m))].filter(Boolean)
    )
  );

  const { data: prices, error: pErr } = await supabase
    .from("token_price_snapshots")
    .select("snapshot_bucket, unit, price_usd")
    .in("snapshot_bucket", buckets)
    .in("unit", units);

  if (pErr) return res.status(500).json({ error: "Failed to fetch token prices" });

  const pricesByBucket = new Map<string, Record<string, number>>();
  for (const p of (prices ?? []) as PriceRow[]) {
    if (p.price_usd == null) continue;
    if (!pricesByBucket.has(p.snapshot_bucket)) pricesByBucket.set(p.snapshot_bucket, {});
    pricesByBucket.get(p.snapshot_bucket)![p.unit] = Number(p.price_usd);
  }

  const series = snapshots.map((s) => ({
    snapshot_bucket: s.snapshot_bucket,
    balances: bySnapBalances.get(s.id) ?? {},
    prices_usd: pricesByBucket.get(s.snapshot_bucket) ?? {},
  }));

  return res.status(200).json({ series });
}


