import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

const allowedBases = new Set(["usd", "ada", "btc", "holdings"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const walletId = Array.isArray(req.query.walletId) ? req.query.walletId[0] : req.query.walletId;
  if (!walletId || !isUuid(walletId)) return res.status(400).json({ error: "Invalid walletId" });

  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body || {}) as Partial<{
    threshold_basis: string;
    deviation_threshold_pct_points: number;
    swap_fee_bps: number;
  }>;

  const patch: Record<string, unknown> = {};

  if (body.threshold_basis != null) {
    const v = String(body.threshold_basis);
    if (!allowedBases.has(v)) return res.status(400).json({ error: "Invalid threshold_basis" });
    patch.threshold_basis = v;
  }
  if (body.deviation_threshold_pct_points != null) {
    const v = Number(body.deviation_threshold_pct_points);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: "Invalid deviation_threshold_pct_points" });
    patch.deviation_threshold_pct_points = v;
  }
  if (body.swap_fee_bps != null) {
    const v = Number(body.swap_fee_bps);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: "Invalid swap_fee_bps" });
    patch.swap_fee_bps = v;
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });

  const { error } = await supabase.from("user_wallets").update(patch).eq("id", walletId);
  if (error) return res.status(500).json({ error: "Failed to update wallet settings" });

  return res.status(200).json({ success: true });
}


