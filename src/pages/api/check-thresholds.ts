import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../server/supabaseAdmin";
import { assertSnapshotAuthorized } from "../../server/snapshotAuth";
import { runThresholdAlerts } from "../../server/thresholdAlerts";

const supabase = getSupabaseAdmin();

type ApiOk = { success: true; processedWallets: number; alertsSent: number };
type ApiErr = { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiOk | ApiErr>) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertSnapshotAuthorized(req);
    const result = await runThresholdAlerts({ supabase });
    return res.status(200).json({ success: true, processedWallets: result.processedWallets, alertsSent: result.alertsSent });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return res.status(status).json({ error: msg });
  }
}


