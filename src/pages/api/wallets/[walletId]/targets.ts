import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

type TargetRow = { unit: string; target_pct_points: number };

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const walletId = Array.isArray(req.query.walletId) ? req.query.walletId[0] : req.query.walletId;
  if (!walletId || !isUuid(walletId)) return res.status(400).json({ error: "Invalid walletId" });

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("wallet_token_targets")
      .select("unit, target_pct_points")
      .eq("wallet_id", walletId)
      .order("unit", { ascending: true });

    if (error) return res.status(500).json({ error: "Failed to fetch targets" });
    return res.status(200).json({ targets: (data ?? []) as TargetRow[] });
  }

  if (req.method === "PUT") {
    const body = req.body as { targets?: Array<{ unit: string; target_pct_points: number }> };
    const targets = body.targets ?? [];

    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: "Missing targets" });
    }

    const cleaned: TargetRow[] = targets
      .map((t) => ({
        unit: String(t.unit || "").trim(),
        target_pct_points: Number(t.target_pct_points),
      }))
      .filter((t) => t.unit.length > 0 && Number.isFinite(t.target_pct_points) && t.target_pct_points >= 0);

    if (cleaned.length === 0) return res.status(400).json({ error: "No valid targets provided" });

    const sum = cleaned.reduce((acc, t) => acc + t.target_pct_points, 0);
    if (Math.abs(sum - 100) > 0.01) {
      return res.status(400).json({ error: `Targets must sum to 100 (got ${sum.toFixed(4)})` });
    }

    // Replace strategy: delete existing, insert new
    const { error: delErr } = await supabase.from("wallet_token_targets").delete().eq("wallet_id", walletId);
    if (delErr) return res.status(500).json({ error: "Failed to replace targets" });

    const rows = cleaned.map((t) => ({ wallet_id: walletId, unit: t.unit, target_pct_points: t.target_pct_points }));
    const { error: insErr } = await supabase.from("wallet_token_targets").insert(rows);
    if (insErr) return res.status(500).json({ error: "Failed to save targets" });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}


