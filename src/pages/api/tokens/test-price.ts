import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../server/supabaseAdmin";
import { getTokenUsdPrices } from "../../../server/tokenPriceService";

const supabase = getSupabaseAdmin();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body || {}) as { unit?: string };
  const unit = String(body.unit || "").trim();
  if (!unit) return res.status(400).json({ error: "unit is required" });

  const results = await getTokenUsdPrices({ supabase, units: [unit] });
  const r = results[0];
  return res.status(200).json({ unit: r.unit, price_usd: r.priceUsd, source: r.source, error: r.error ?? null });
}


