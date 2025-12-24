import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("tokens")
      .select(
        "unit, display_name, ticker, is_active, pricing_source, kraken_pair_query, kraken_result_key_hint, coingecko_id, manual_price_usd, created_at, updated_at"
      )
      .order("unit", { ascending: true });

    if (error) return res.status(500).json({ error: "Failed to fetch tokens" });
    return res.status(200).json({ tokens: data ?? [] });
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as Record<string, unknown>;
    const unit = String(body.unit || "").trim();
    if (!unit) return res.status(400).json({ error: "unit is required" });

    const row = {
      unit,
      display_name: body.display_name ? String(body.display_name) : null,
      ticker: body.ticker ? String(body.ticker) : null,
      is_active: body.is_active == null ? true : Boolean(body.is_active),
      pricing_source: body.pricing_source ? String(body.pricing_source) : "manual",
      kraken_pair_query: body.kraken_pair_query ? String(body.kraken_pair_query) : null,
      kraken_result_key_hint: body.kraken_result_key_hint ? String(body.kraken_result_key_hint) : null,
      coingecko_id: body.coingecko_id ? String(body.coingecko_id) : null,
      manual_price_usd: body.manual_price_usd == null ? null : Number(body.manual_price_usd),
    };

    const { error } = await supabase.from("tokens").upsert(row, { onConflict: "unit", ignoreDuplicates: false });
    if (error) return res.status(500).json({ error: "Failed to upsert token" });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}


