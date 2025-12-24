import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../server/supabaseAdmin";
import { assertSnapshotAuthorized } from "../../server/snapshotAuth";
import { runSnapshotPipeline } from "../../server/snapshotPipeline";

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

        const errors: string[] = [];

        // Determine monitored units (targets) for these wallets; we only store balances for monitored tokens.
        const walletIds = (wallets as WalletRecord[]).map(w => w.id);
        const { data: targets, error: tErr } = await supabase
            .from('wallet_token_targets')
            .select('wallet_id, unit')
            .in('wallet_id', walletIds);

        if (tErr) {
            console.error('Error fetching wallet targets:', tErr);
            return res.status(500).json({ error: 'Failed to fetch wallet targets' });
        }

        const monitoredUnitsByWalletId: Record<string, string[]> = {};
        const unitsToPrice = new Set<string>();
        for (const w of walletIds) monitoredUnitsByWalletId[w] = [];

        for (const row of (targets ?? []) as Array<{ wallet_id: string; unit: string }>) {
            monitoredUnitsByWalletId[row.wallet_id] = monitoredUnitsByWalletId[row.wallet_id] || [];
            monitoredUnitsByWalletId[row.wallet_id].push(row.unit);
            unitsToPrice.add(row.unit);
        }
        unitsToPrice.add('lovelace');
        unitsToPrice.add('BTC');

        const pipelineResult = await runSnapshotPipeline({
            supabase,
            wallets: wallets as WalletRecord[],
            monitoredUnitsByWalletId,
            unitsToPriceUsd: Array.from(unitsToPrice),
        });

        errors.push(...pipelineResult.errors);

        const hasMore = totalWallets ? offset + batchSizeNum < totalWallets : false;
        const nextBatch = hasMore ? batchNum + 1 : undefined;

        res.status(200).json({
            success: true,
            processed: pipelineResult.processed,
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
