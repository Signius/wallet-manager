import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../../../server/supabaseAdmin";

const supabase = getSupabaseAdmin();

type AccountAssetsRow = {
  stake_address: string;
  policy_id: string;
  asset_name?: string;
  fingerprint: string;
  decimals?: number;
  quantity: string;
};

type AssetInfoRow = {
  policy_id: string;
  asset_name?: string;
  asset_name_ascii?: string;
  fingerprint: string;
  token_registry_metadata?: {
    name?: string;
    ticker?: string;
    decimals?: number;
  };
};

type AssetOption = {
  unit: string;
  label: string;
  ticker?: string | null;
  policy_id?: string | null;
  asset_name?: string | null;
  fingerprint?: string | null;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function buildLabel(unit: string, info?: AssetInfoRow) {
  if (unit === "lovelace") return "ADA";
  const ticker = info?.token_registry_metadata?.ticker;
  const name = info?.token_registry_metadata?.name || info?.asset_name_ascii;
  if (ticker && name) return `${ticker} — ${name}`;
  if (ticker) return ticker;
  if (name) return name;
  return unit.slice(0, 8) + "…" + unit.slice(-6);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const walletId = Array.isArray(req.query.walletId) ? req.query.walletId[0] : req.query.walletId;
  if (!walletId || !isUuid(walletId)) return res.status(400).json({ error: "Invalid walletId" });

  const { data: wallet, error: wErr } = await supabase
    .from("user_wallets")
    .select("stake_address")
    .eq("id", walletId)
    .maybeSingle();

  if (wErr) return res.status(500).json({ error: "Failed to load wallet" });
  if (!wallet) return res.status(404).json({ error: "Wallet not found" });

  const koiosApiKey = process.env.KOIOS_API_KEY;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (koiosApiKey) headers["Authorization"] = `Bearer ${koiosApiKey}`;

  // 1) account_assets for this stake address (includes lovelace + native tokens)
  const assetsResp = await fetch("https://api.koios.rest/api/v1/account_assets", {
    method: "POST",
    headers,
    body: JSON.stringify({ _stake_addresses: [wallet.stake_address] }),
  });

  if (!assetsResp.ok) {
    return res.status(502).json({ error: `Koios account_assets failed: ${assetsResp.status} ${assetsResp.statusText}` });
  }

  const assets = (await assetsResp.json()) as AccountAssetsRow[];

  // Ensure ADA option always exists
  const options: AssetOption[] = [{ unit: "lovelace", label: "ADA", ticker: "ADA", policy_id: "lovelace", asset_name: null, fingerprint: null }];

  const nonAda = assets.filter((a) => a.policy_id !== "lovelace");
  const assetList: [string, string][] = nonAda.map((a) => [a.policy_id, a.asset_name || ""]);

  const infoMap = new Map<string, AssetInfoRow>();
  if (assetList.length > 0) {
    const infoResp = await fetch("https://api.koios.rest/api/v1/asset_info", {
      method: "POST",
      headers,
      body: JSON.stringify({ _asset_list: assetList }),
    });

    if (infoResp.ok) {
      const infos = (await infoResp.json()) as AssetInfoRow[];
      for (const i of infos) {
        const key = `${i.policy_id}${i.asset_name || ""}`;
        infoMap.set(key, i);
      }
    }
  }

  for (const a of nonAda) {
    const unit = `${a.policy_id}${a.asset_name || ""}`;
    const info = infoMap.get(unit);
    options.push({
      unit,
      label: buildLabel(unit, info),
      ticker: info?.token_registry_metadata?.ticker ?? null,
      policy_id: a.policy_id,
      asset_name: a.asset_name ?? null,
      fingerprint: a.fingerprint ?? null,
    });
  }

  const uniq = new Map<string, AssetOption>();
  for (const o of options) uniq.set(o.unit, o);

  const deduped = Array.from(uniq.values()).sort((a, b) => {
    if (a.unit === "lovelace") return -1;
    if (b.unit === "lovelace") return 1;
    return a.label.localeCompare(b.label);
  });

  return res.status(200).json({ options: deduped });
}


