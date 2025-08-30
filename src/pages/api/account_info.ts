import type { NextApiRequest, NextApiResponse } from "next";

interface AccountInfoRequest {
    _stake_addresses: string[];
}

interface AccountInfoResponse {
    stake_address: string;
    status: "registered" | "not registered";
    delegated_drep?: {
        drep_id: string;
        drep_view: string;
        epoch_no: number;
    };
    delegated_pool?: {
        pool_id: string;
        pool_name?: string;
        epoch_no: number;
    };
    total_balance: string;
    utxo: string;
    rewards: string;
    withdrawals: string;
    rewards_available: string;
    deposit: string;
    reserves: string;
    treasury: string;
    "proposal-refund": string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<AccountInfoResponse[] | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { _stake_addresses }: AccountInfoRequest = req.body;

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

        const response = await fetch('https://api.koios.rest/api/v1/account_info', {
            method: 'POST',
            headers,
            body: JSON.stringify({ _stake_addresses })
        });

        if (!response.ok) {
            throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
        }

        const data: AccountInfoResponse[] = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching account info:', error);
        res.status(500).json({ error: 'Failed to fetch account information' });
    }
}
