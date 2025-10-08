import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from '@supabase/supabase-js';
import { KoiosAccountInfo, KoiosAsset } from '../../services/walletService';
import { ExchangeRateService, ExchangeRates } from '../../services/exchangeRateService';

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);


interface BatchSnapshotResponse {
    success: boolean;
    processed: number;
    total: number;
    hasMore: boolean;
    nextBatch?: number;
    errors?: string[];
}

interface WalletRecord {
    id: string;
    stake_address: string;
    wallet_name?: string;
}

interface SnapshotData {
    wallet_id: string;
    snapshot_date: string;
    ada_balance_lovelace: number;
    assets: KoiosAsset[];
    exchange_rate_usd: number;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<BatchSnapshotResponse | { error: string }>
) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { batch, batchSize, authToken } = req.query;
        
        // Validate required query parameters
        if (!batch || !batchSize || !authToken) {
            return res.status(400).json({ error: 'Missing required parameters: batch, batchSize, authToken' });
        }

        // Parse and validate parameters
        const batchStr = Array.isArray(batch) ? batch[0] : batch;
        const batchSizeStr = Array.isArray(batchSize) ? batchSize[0] : batchSize;
        const authTokenStr = Array.isArray(authToken) ? authToken[0] : authToken;

        // Validate authentication
        if (authTokenStr !== process.env.SNAPSHOT_AUTH_TOKEN) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const batchNum = parseInt(batchStr, 10);
        const batchSizeNum = parseInt(batchSizeStr, 10);
        
        if (isNaN(batchNum) || isNaN(batchSizeNum) || batchNum < 0 || batchSizeNum <= 0) {
            return res.status(400).json({ error: 'Invalid batch parameters' });
        }

        const offset = batchNum * batchSizeNum;

        // Fetch wallets from database
        const { data: wallets, error: walletsError, count: totalWallets } = await supabase
            .from('user_wallets')
            .select('id, stake_address, wallet_name', { count: 'exact' })
            .eq('is_active', true)
            .range(offset, offset + batchSizeNum - 1);

        if (walletsError) {
            console.error('Error fetching wallets:', walletsError);
            return res.status(500).json({ error: 'Failed to fetch wallets from database' });
        }

        if (!wallets || wallets.length === 0) {
            return res.status(200).json({
                success: true,
                processed: 0,
                total: totalWallets || 0,
                hasMore: false
            });
        }

        const stakeAddresses = wallets.map((wallet: WalletRecord) => wallet.stake_address);
        const errors: string[] = [];

        // Fetch account info, assets, and exchange rates for all wallets in this batch
        let accountInfo: KoiosAccountInfo[] = [];
        let accountAssets: KoiosAsset[] = [];
        let exchangeRates: ExchangeRates;

        try {
            // Make direct calls to Koios API instead of using WalletService
            const koiosApiKey = process.env.KOIOS_API_KEY;
            const headers: Record<string, string> = {
                'accept': 'application/json',
                'content-type': 'application/json'
            };

            if (koiosApiKey) {
                headers['Authorization'] = `Bearer ${koiosApiKey}`;
            }

            [accountInfo, accountAssets, exchangeRates] = await Promise.all([
                // Direct call to Koios account_info API
                fetch('https://api.koios.rest/api/v1/account_info', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ _stake_addresses: stakeAddresses })
                }).then(response => {
                    if (!response.ok) {
                        throw new Error(`Koios account_info API error: ${response.status} ${response.statusText}`);
                    }
                    return response.json();
                }),
                
                // Direct call to Koios account_assets API
                fetch('https://api.koios.rest/api/v1/account_assets', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ _stake_addresses: stakeAddresses })
                }).then(response => {
                    if (!response.ok) {
                        throw new Error(`Koios account_assets API error: ${response.status} ${response.statusText}`);
                    }
                    return response.json();
                }),
                
                // Exchange rate service call
                ExchangeRateService.getCurrentRates()
            ]);
        } catch (error) {
            console.error('Error fetching wallet data or exchange rates:', error);
            return res.status(500).json({ error: 'Failed to fetch wallet data or exchange rates' });
        }

        // Group assets by stake address
        const assetsByAddress = new Map<string, KoiosAsset[]>();
        accountAssets.forEach(asset => {
            if (!assetsByAddress.has(asset.stake_address)) {
                assetsByAddress.set(asset.stake_address, []);
            }
            assetsByAddress.get(asset.stake_address)!.push(asset);
        });

        // Prepare snapshot data
        const snapshots: SnapshotData[] = [];
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        for (const wallet of wallets) {
            const walletAccountInfo = accountInfo.find(acc => acc.stake_address === wallet.stake_address);
            const walletAssets = assetsByAddress.get(wallet.stake_address) || [];

            if (!walletAccountInfo) {
                errors.push(`No account info found for wallet ${wallet.stake_address}`);
                continue;
            }

            // Convert total balance from string to number (comes as string from Koios API)
            const adaBalanceLovelace = parseInt(walletAccountInfo.total_balance, 10) || 0;

            // Filter out ADA (lovelace) from assets since we store it separately
            const nonAdaAssets = walletAssets.filter(asset => asset.policy_id !== 'lovelace');

            snapshots.push({
                wallet_id: wallet.id,
                snapshot_date: today,
                ada_balance_lovelace: adaBalanceLovelace,
                assets: nonAdaAssets,
                exchange_rate_usd: exchangeRates.usd
            });
        }

        // Insert snapshots into database (upsert to handle duplicates)
        if (snapshots.length > 0) {
            const { error: insertError } = await supabase
                .from('wallet_snapshots')
                .upsert(snapshots, {
                    onConflict: 'wallet_id,snapshot_date',
                    ignoreDuplicates: false
                });

            if (insertError) {
                console.error('Error inserting snapshots:', insertError);
                return res.status(500).json({ error: 'Failed to save snapshots to database' });
            }
        }

        const hasMore = totalWallets ? offset + batchSizeNum < totalWallets : false;
        const nextBatch = hasMore ? batchNum + 1 : undefined;

        res.status(200).json({
            success: true,
            processed: snapshots.length,
            total: totalWallets || 0,
            hasMore,
            nextBatch,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Error in batch snapshot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
