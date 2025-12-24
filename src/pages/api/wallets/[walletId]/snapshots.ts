import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

type SnapshotRow = {
  id: string;
  snapshot_bucket: string;
  total_value_ada: number;
  total_value_usd: number;
};

type AssetRow = {
  snapshot_id: string;
  unit: string;
  pct_of_portfolio: number | null;
  value_ada: number | null;
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
    .select("id, snapshot_bucket, total_value_ada, total_value_usd")
    .eq("wallet_id", walletId)
    .gte("snapshot_bucket", since)
    .order("snapshot_bucket", { ascending: true });

  if (sErr) return res.status(500).json({ error: "Failed to fetch snapshots" });
  const snapshots = (snaps ?? []) as SnapshotRow[];
  if (snapshots.length === 0) return res.status(200).json({ series: [] });

  const ids = snapshots.map((s) => s.id);
  const { data: assets, error: aErr } = await supabase
    .from("wallet_snapshot_assets")
    .select("snapshot_id, unit, pct_of_portfolio, value_ada")
    .in("snapshot_id", ids);

  if (aErr) return res.status(500).json({ error: "Failed to fetch snapshot assets" });

  const bySnap = new Map<string, Record<string, number>>();
  for (const a of (assets ?? []) as AssetRow[]) {
    if (a.pct_of_portfolio == null) continue;
    if (!bySnap.has(a.snapshot_id)) bySnap.set(a.snapshot_id, {});
    bySnap.get(a.snapshot_id)![a.unit] = Number(a.pct_of_portfolio);
  }

  const series = snapshots.map((s) => ({
    snapshot_bucket: s.snapshot_bucket,
    total_value_ada: Number(s.total_value_ada),
    total_value_usd: Number(s.total_value_usd),
    allocations_pct: bySnap.get(s.id) ?? {},
  }));

  return res.status(200).json({ series });
}


