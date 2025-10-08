import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface WalletRequest {
    stake_address: string;
    wallet_name?: string;
}

interface WalletResponse {
    success: boolean;
    wallet_id?: string;
    message?: string;
    error?: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<WalletResponse | { error: string }>
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { stake_address, wallet_name }: WalletRequest = req.body;

        if (!stake_address) {
            return res.status(400).json({ error: 'Stake address is required' });
        }

        // Check if wallet already exists
        const { data: existingWallet, error: checkError } = await supabase
            .from('user_wallets')
            .select('id, wallet_name')
            .eq('stake_address', stake_address)
            .single();

        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found" error
            console.error('Error checking existing wallet:', checkError);
            return res.status(500).json({ error: 'Failed to check existing wallet' });
        }

        if (existingWallet) {
            // Wallet already exists, update it if needed
            if (wallet_name && wallet_name !== existingWallet.wallet_name) {
                const { error: updateError } = await supabase
                    .from('user_wallets')
                    .update({ 
                        wallet_name,
                        is_active: true,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingWallet.id);

                if (updateError) {
                    console.error('Error updating wallet:', updateError);
                    return res.status(500).json({ error: 'Failed to update wallet' });
                }
            }

            return res.status(200).json({
                success: true,
                wallet_id: existingWallet.id,
                message: 'Wallet already exists and is active'
            });
        }

        // Create new wallet
        const { data: newWallet, error: insertError } = await supabase
            .from('user_wallets')
            .insert({
                stake_address,
                wallet_name: wallet_name || null,
                is_active: true
            })
            .select('id')
            .single();

        if (insertError) {
            console.error('Error creating wallet:', insertError);
            return res.status(500).json({ error: 'Failed to create wallet' });
        }

        res.status(201).json({
            success: true,
            wallet_id: newWallet.id,
            message: 'Wallet created successfully'
        });

    } catch (error) {
        console.error('Error in wallet API:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
