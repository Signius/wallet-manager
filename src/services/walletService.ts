export interface KoiosAsset {
    stake_address: string;
    policy_id: string;
    asset_name?: string;
    fingerprint: string;
    decimals?: number;
    quantity: string;
}

export interface KoiosAccountInfo {
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

export interface KoiosAssetInfo {
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

export interface EnhancedAsset {
    unit: string;
    quantity: string;
    policyId: string;
    assetName?: string;
    fingerprint: string;
    decimals?: number;
    assetInfo?: KoiosAssetInfo;
}

export class WalletService {
    private static async fetchFromApi<T>(endpoint: string, data: unknown): Promise<T> {
        const response = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    static async getAccountInfo(stakeAddresses: string[]): Promise<KoiosAccountInfo[]> {
        return this.fetchFromApi('account_info', { _stake_addresses: stakeAddresses });
    }

    static async getAccountAssets(stakeAddresses: string[]): Promise<KoiosAsset[]> {
        return this.fetchFromApi('account_assets', { _stake_addresses: stakeAddresses });
    }

    static async getAssetInfo(assetList: [string, string][]): Promise<KoiosAssetInfo[]> {
        return this.fetchFromApi('asset_info', { _asset_list: assetList });
    }

    static async getWalletBalance(stakeAddresses: string[]): Promise<EnhancedAsset[]> {
        try {
            // Get account assets
            const assets = await this.getAccountAssets(stakeAddresses);

            // Prepare asset list for detailed info
            const assetList: [string, string][] = assets
                .filter(asset => asset.policy_id !== 'lovelace') // Exclude ADA
                .map(asset => [asset.policy_id, asset.asset_name || '']);

            // Get detailed asset information
            const assetInfoMap = new Map<string, KoiosAssetInfo>();
            if (assetList.length > 0) {
                const assetInfos = await this.getAssetInfo(assetList);
                assetInfos.forEach(info => {
                    const key = `${info.policy_id}${info.asset_name || ''}`;
                    assetInfoMap.set(key, info);
                });
            }

            // Convert to enhanced assets format
            const enhancedAssets: EnhancedAsset[] = assets.map(asset => {
                const key = `${asset.policy_id}${asset.asset_name || ''}`;
                const assetInfo = assetInfoMap.get(key);

                return {
                    unit: asset.policy_id === 'lovelace' ? 'lovelace' : `${asset.policy_id}${asset.asset_name || ''}`,
                    quantity: asset.quantity,
                    policyId: asset.policy_id,
                    assetName: asset.asset_name,
                    fingerprint: asset.fingerprint,
                    decimals: asset.decimals,
                    assetInfo: assetInfo,
                };
            });

            return enhancedAssets;
        } catch (error) {
            console.error('Error fetching wallet balance:', error);
            throw error;
        }
    }

    static async getWalletInfo(stakeAddresses: string[]): Promise<{
        balance: EnhancedAsset[];
        accountInfo: KoiosAccountInfo[];
    }> {
        try {
            const [balance, accountInfo] = await Promise.all([
                this.getWalletBalance(stakeAddresses),
                this.getAccountInfo(stakeAddresses)
            ]);

            return { balance, accountInfo };
        } catch (error) {
            console.error('Error fetching wallet info:', error);
            throw error;
        }
    }

    static async storeWallet(stakeAddress: string, walletName?: string): Promise<{
        success: boolean;
        wallet_id?: string;
        message?: string;
    }> {
        return this.fetchFromApi('wallet', { 
            stake_address: stakeAddress, 
            wallet_name: walletName 
        });
    }
}
