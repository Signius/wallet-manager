import type { NextApiRequest, NextApiResponse } from "next";

interface AccountAssetsRequest {
    _stake_addresses: string[];
}

interface AccountAssetsResponse {
    stake_address: string;
    policy_id: string;
    asset_name?: string;
    fingerprint: string;
    decimals?: number;
    quantity: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<AccountAssetsResponse[] | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { _stake_addresses }: AccountAssetsRequest = req.body;

        if (!_stake_addresses || !Array.isArray(_stake_addresses) || _stake_addresses.length === 0) {
            return res.status(400).json({ error: 'Invalid stake addresses provided' });
        }

        const koiosApiKey = process.env.KOIOS_API_KEY;
        const headers: Record<string, string> = {
            'accept': 'application/json',
            'content-type': 'application/json'
        };

        if (koiosApiKey) {
            headers['Authorization'] = `Bearer ${koiosApiKey}`;
        }

        const response = await fetch('https://api.koios.rest/api/v1/account_assets', {
            method: 'POST',
            headers,
            body: JSON.stringify({ _stake_addresses })
        });

        if (!response.ok) {
            throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
        }

        const data: AccountAssetsResponse[] = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching account assets:', error);
        res.status(500).json({ error: 'Failed to fetch account assets' });
    }
}
