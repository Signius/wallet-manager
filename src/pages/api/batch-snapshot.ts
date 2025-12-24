import type { NextApiRequest, NextApiResponse } from "next";
import { KoiosAccountInfo, KoiosAsset } from '../../services/walletService';
import { ExchangeRateService, ExchangeRates } from '../../services/exchangeRateService';
import { getSupabaseAdmin } from "../../server/supabaseAdmin";
import { applyDecimals, getTokenPrice, lovelaceToAda, toIso, toSnapshotBucket } from "../../server/tokenPricing";
import { assertSnapshotAuthorized } from "../../server/snapshotAuth";

const supabase = getSupabaseAdmin();


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
    snapshot_at: string;
    snapshot_bucket: string;
    ada_balance_lovelace: number;
    ada_usd_rate: number;
    total_value_ada: number;
    total_value_usd: number;
}

type WalletSnapshotRow = {
    id: string;
    wallet_id: string;
    total_value_ada: number;
    ada_usd_rate: number;
};

type WalletSnapshotAssetUpsertRow = {
    snapshot_id: string;
    unit: string;
    quantity: number | string;
    decimals: number | null;
    price_ada: number | null;
    price_usd: number | null;
    value_ada: number | null;
    value_usd: number | null;
    pct_of_portfolio: number | null;
};

type TokenPriceSnapshotUpsertRow = {
    snapshot_bucket: string;
    unit: string;
    price_ada: number | null;
    price_usd: number | null;
    source: string | null;
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<BatchSnapshotResponse | { error: string }>
) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { batch, batchSize } = req.query;
        
        // Validate required query parameters
        if (!batch || !batchSize) {
            return res.status(400).json({ error: 'Missing required parameters: batch, batchSize' });
        }

        // Parse and validate parameters
        const batchStr = Array.isArray(batch) ? batch[0] : batch;
        const batchSizeStr = Array.isArray(batchSize) ? batchSize[0] : batchSize;
        // Validate authentication (header preferred; query param allowed for backward compat)
        try {
            assertSnapshotAuthorized(req);
        } catch {
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
        const now = new Date();
        const bucket = toSnapshotBucket(now);
        const snapshotAtIso = toIso(now);
        const snapshotBucketIso = toIso(bucket);

        for (const wallet of wallets) {
            const walletAccountInfo = accountInfo.find(acc => acc.stake_address === wallet.stake_address);
            const walletAssets = assetsByAddress.get(wallet.stake_address) || [];

            if (!walletAccountInfo) {
                errors.push(`No account info found for wallet ${wallet.stake_address}`);
                continue;
            }

            // Convert total balance from string to number (comes as string from Koios API)
            const adaBalanceLovelace = parseInt(walletAccountInfo.total_balance, 10) || 0;

            // Build unit list (include ADA explicitly)
            const nonAdaAssets = walletAssets.filter(asset => asset.policy_id !== 'lovelace');

            // Compute valuation (ADA + any priced tokens)
            const ada = lovelaceToAda(adaBalanceLovelace);
            let totalValueAda = ada;
            let totalValueUsd = ada * exchangeRates.usd;

            for (const asset of nonAdaAssets) {
                const unit = `${asset.policy_id}${asset.asset_name || ''}`;
                const price = getTokenPrice(unit, exchangeRates.usd);
                const qty = applyDecimals(asset.quantity, asset.decimals);

                if (price.priceAda != null) {
                    totalValueAda += qty * price.priceAda;
                }
                if (price.priceUsd != null) {
                    totalValueUsd += qty * price.priceUsd;
                }
            }

            snapshots.push({
                wallet_id: wallet.id,
                ada_balance_lovelace: adaBalanceLovelace,
                snapshot_at: snapshotAtIso,
                snapshot_bucket: snapshotBucketIso,
                ada_usd_rate: exchangeRates.usd,
                total_value_ada: totalValueAda,
                total_value_usd: totalValueUsd
            });
        }

        // Insert snapshots into database (upsert to handle reruns within the same bucket)
        if (snapshots.length > 0) {
            const { error: insertError } = await supabase
                .from('wallet_snapshots')
                .upsert(snapshots as unknown as Record<string, unknown>[], {
                    onConflict: 'wallet_id,snapshot_bucket',
                    ignoreDuplicates: false
                });

            if (insertError) {
                console.error('Error inserting snapshots:', insertError);
                return res.status(500).json({ error: 'Failed to save snapshots to database' });
            }

            // Fetch snapshot ids for this bucket to insert asset breakdown
            const walletIds = snapshots.map(s => s.wallet_id);
            const { data: snapshotRows, error: snapshotFetchError } = await supabase
                .from('wallet_snapshots')
                .select('id, wallet_id, total_value_ada, ada_usd_rate')
                .in('wallet_id', walletIds)
                .eq('snapshot_bucket', snapshotBucketIso);

            if (snapshotFetchError) {
                console.error('Error fetching upserted snapshot rows:', snapshotFetchError);
                return res.status(500).json({ error: 'Failed to fetch saved snapshots from database' });
            }

            const snapshotIdByWalletId = new Map<string, { id: string; total_value_ada: number; ada_usd_rate: number }>();
            (snapshotRows as WalletSnapshotRow[] | null || []).forEach((row) => {
                snapshotIdByWalletId.set(row.wallet_id, { id: row.id, total_value_ada: row.total_value_ada, ada_usd_rate: row.ada_usd_rate });
            });

            const snapshotAssetsRows: WalletSnapshotAssetUpsertRow[] = [];
            const tokenPriceRows: TokenPriceSnapshotUpsertRow[] = [];

            for (const wallet of wallets) {
                const snap = snapshotIdByWalletId.get(wallet.id);
                if (!snap) continue;

                const walletAccountInfo = accountInfo.find(acc => acc.stake_address === wallet.stake_address);
                if (!walletAccountInfo) continue;
                const adaBalanceLovelace = parseInt(walletAccountInfo.total_balance, 10) || 0;
                const ada = lovelaceToAda(adaBalanceLovelace);

                const totalAda = Number(snap.total_value_ada) || 0;
                const pctAda = totalAda > 0 ? (ada / totalAda) * 100 : null;

                snapshotAssetsRows.push({
                    snapshot_id: snap.id,
                    unit: 'lovelace',
                    quantity: adaBalanceLovelace,
                    decimals: 6,
                    price_ada: 1,
                    price_usd: snap.ada_usd_rate,
                    value_ada: ada,
                    value_usd: ada * snap.ada_usd_rate,
                    pct_of_portfolio: pctAda
                });

                const walletAssets = assetsByAddress.get(wallet.stake_address) || [];
                const nonAdaAssets = walletAssets.filter(asset => asset.policy_id !== 'lovelace');

                for (const asset of nonAdaAssets) {
                    const unit = `${asset.policy_id}${asset.asset_name || ''}`;
                    const price = getTokenPrice(unit, snap.ada_usd_rate);
                    const qtyHuman = applyDecimals(asset.quantity, asset.decimals);

                    const valueAda = price.priceAda != null ? qtyHuman * price.priceAda : null;
                    const valueUsd = price.priceUsd != null ? qtyHuman * price.priceUsd : null;
                    const pct = totalAda > 0 && valueAda != null ? (valueAda / totalAda) * 100 : null;

                    snapshotAssetsRows.push({
                        snapshot_id: snap.id,
                        unit,
                        quantity: asset.quantity,
                        decimals: asset.decimals ?? null,
                        price_ada: price.priceAda ?? null,
                        price_usd: price.priceUsd ?? null,
                        value_ada: valueAda,
                        value_usd: valueUsd,
                        pct_of_portfolio: pct
                    });

                    if (price.priceAda != null || price.priceUsd != null) {
                        tokenPriceRows.push({
                            snapshot_bucket: snapshotBucketIso,
                            unit,
                            price_ada: price.priceAda ?? null,
                            price_usd: price.priceUsd ?? null,
                            source: price.source ?? null
                        });
                    }
                }
            }

            if (snapshotAssetsRows.length > 0) {
                const { error: assetsUpsertError } = await supabase
                    .from('wallet_snapshot_assets')
                    .upsert(snapshotAssetsRows, { onConflict: 'snapshot_id,unit', ignoreDuplicates: false });

                if (assetsUpsertError) {
                    console.error('Error inserting snapshot assets:', assetsUpsertError);
                    return res.status(500).json({ error: 'Failed to save snapshot assets to database' });
                }
            }

            if (tokenPriceRows.length > 0) {
                const { error: pricesUpsertError } = await supabase
                    .from('token_price_snapshots')
                    .upsert(tokenPriceRows, { onConflict: 'snapshot_bucket,unit', ignoreDuplicates: false });

                if (pricesUpsertError) {
                    console.error('Error inserting token prices:', pricesUpsertError);
                    // Not fatal; snapshots and assets are still valuable.
                }
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
