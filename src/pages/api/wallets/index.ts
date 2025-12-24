import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

type WalletRow = {
  id: string;
  stake_address: string;
  wallet_name: string | null;
  is_active: boolean;
  deviation_threshold_pct_points: number;
  swap_fee_bps: number;
  created_at: string;
  updated_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { data, error } = await supabase
    .from("user_wallets")
    .select(
      "id, stake_address, wallet_name, is_active, deviation_threshold_pct_points, swap_fee_bps, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "Failed to fetch wallets" });
  return res.status(200).json({ wallets: (data ?? []) as WalletRow[] });
}


