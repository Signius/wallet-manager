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
    minting_tx_metadata?: Record<string, unknown>;
    token_registry_metadata?: {
        name?: string;
        description?: string;
        ticker?: string;
        url?: string;
        logo?: string;
        decimals?: number;
    };
    cip68_metadata?: Record<string, unknown>;
}

// Initial batch size to avoid 413 Request Entity Too Large errors
// Start small to be safe - Koios API has strict limits
const INITIAL_BATCH_SIZE = 10;

async function fetchAssetInfoBatch(
    assetList: [string, string][],
    headers: Record<string, string>
): Promise<AssetInfoResponse[]> {
    // If batch is empty, return empty array
    if (assetList.length === 0) {
        return [];
    }

    try {
        const response = await fetch('https://api.koios.rest/api/v1/asset_info', {
            method: 'POST',
            headers,
            body: JSON.stringify({ _asset_list: assetList })
        });

        if (!response.ok) {
            // If we get 413 and have more than 1 item, split the batch in half and retry
            if (response.status === 413 && assetList.length > 1) {
                console.log(`Batch of ${assetList.length} assets too large, splitting...`);
                const mid = Math.floor(assetList.length / 2);
                const firstHalf = assetList.slice(0, mid);
                const secondHalf = assetList.slice(mid);
                
                // Recursively fetch both halves
                const [firstResult, secondResult] = await Promise.all([
                    fetchAssetInfoBatch(firstHalf, headers),
                    fetchAssetInfoBatch(secondHalf, headers)
                ]);
                
                return [...firstResult, ...secondResult];
            }
            
            // If we get 413 with a single asset, log it but still throw
            if (response.status === 413 && assetList.length === 1) {
                console.error(`Single asset too large for API: ${assetList[0][0]}${assetList[0][1]}`);
            }
            
            throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    } catch (error) {
        // Re-throw if it's already our error type
        if (error instanceof Error && error.message.includes('Koios API error')) {
            throw error;
        }
        // Otherwise wrap it
        throw new Error(`Failed to fetch asset info: ${error instanceof Error ? error.message : String(error)}`);
    }
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

        // Batch the requests to avoid 413 errors
        console.log(`Fetching asset info for ${_asset_list.length} assets, batching into chunks of ${INITIAL_BATCH_SIZE}`);
        const batches: [string, string][][] = [];
        for (let i = 0; i < _asset_list.length; i += INITIAL_BATCH_SIZE) {
            batches.push(_asset_list.slice(i, i + INITIAL_BATCH_SIZE));
        }
        console.log(`Created ${batches.length} batches`);

        // Fetch all batches in parallel (with automatic retry/splitting on 413)
        const results = await Promise.all(
            batches.map((batch, index) => {
                console.log(`Fetching batch ${index + 1}/${batches.length} with ${batch.length} assets`);
                return fetchAssetInfoBatch(batch, headers);
            })
        );

        // Combine all results into a single array
        const data: AssetInfoResponse[] = results.flat();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching asset info:', error);
        res.status(500).json({ error: 'Failed to fetch asset information' });
    }
}
