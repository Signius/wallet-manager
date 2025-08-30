import type { NextApiRequest, NextApiResponse } from "next";

interface AssetInfoRequest {
    _asset_list: [string, string][]; // [policyId, assetName][]
}

interface AssetInfoResponse {
    policy_id: string;
    asset_name?: string;
    asset_name_ascii?: string;
    fingerprint: string;
    minting_tx_hash?: string;
    total_supply: string;
    mint_cnt: number;
    burn_cnt: number;
    creation_time?: number;
    minting_tx_metadata?: any;
    token_registry_metadata?: {
        name?: string;
        description?: string;
        ticker?: string;
        url?: string;
        logo?: string;
        decimals?: number;
    };
    cip68_metadata?: any;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<AssetInfoResponse[] | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { _asset_list }: AssetInfoRequest = req.body;

        if (!_asset_list || !Array.isArray(_asset_list) || _asset_list.length === 0) {
            return res.status(400).json({ error: 'Invalid asset list provided' });
        }

        const koiosApiKey = process.env.KOIOS_API_KEY;
        const headers: Record<string, string> = {
            'accept': 'application/json',
            'content-type': 'application/json'
        };

        if (koiosApiKey) {
            headers['Authorization'] = `Bearer ${koiosApiKey}`;
        }

        const response = await fetch('https://api.koios.rest/api/v1/asset_info', {
            method: 'POST',
            headers,
            body: JSON.stringify({ _asset_list })
        });

        if (!response.ok) {
            throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
        }

        const data: AssetInfoResponse[] = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching asset info:', error);
        res.status(500).json({ error: 'Failed to fetch asset information' });
    }
}
