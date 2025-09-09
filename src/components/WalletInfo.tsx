import React, { useState, useEffect } from 'react';
import { useWallet } from '@meshsdk/react';
import { WalletService, EnhancedAsset, KoiosAccountInfo } from '../services/walletService';
import styles from '../styles/components/WalletInfo.module.css';
import { findAssetImage } from '../utils/assetImageUtils';

export default function WalletInfo() {
    const { connected, wallet } = useWallet();
    const [balance, setBalance] = useState<EnhancedAsset[]>([]);
    const [addresses, setAddresses] = useState<string[]>([]);
    const [networkId, setNetworkId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [walletId, setWalletId] = useState<string>('Loading...');
    const [accountInfo, setAccountInfo] = useState<KoiosAccountInfo[]>([]);
    const [stakeAddresses, setStakeAddresses] = useState<string[]>([]);
    const [isAccountInfoOpen, setIsAccountInfoOpen] = useState(false);
    const [activeAddressTab, setActiveAddressTab] = useState<'unused' | 'stake'>('unused');

    useEffect(() => {
        if (connected && wallet) {
            // Try to get wallet ID from the wallet object or use a fallback
            try {
                // Since wallet.id might not exist, we'll use a fallback
                setWalletId('Connected Wallet');
            } catch (error) {
                setWalletId('Connected Wallet');
            }
            fetchWalletInfo();
        }
    }, [connected, wallet]);

    const fetchWalletInfo = async () => {
        if (!wallet) return;

        setLoading(true);
        try {
            // Get reward addresses (stake addresses)
            const rewardAddresses = await wallet.getRewardAddresses();
            setStakeAddresses(rewardAddresses);

            // Get unused addresses
            const unusedAddrs = await wallet.getUnusedAddresses();
            setAddresses(unusedAddrs);

            // Get network ID
            const network = await wallet.getNetworkId();
            setNetworkId(network);

            // Fetch wallet balance and account info using Koios API
            if (rewardAddresses.length > 0) {
                const walletInfo = await WalletService.getWalletInfo(rewardAddresses);
                setBalance(walletInfo.balance);
                setAccountInfo(walletInfo.accountInfo);


            }
        } catch (error) {
            console.error('Error fetching wallet info:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatLovelace = (lovelace: string) => {
        const ada = parseInt(lovelace) / 1000000;
        return `${ada.toFixed(2)} ADA`;
    };

    const getNetworkName = (id: number) => {
        switch (id) {
            case 0: return 'Testnet';
            case 1: return 'Mainnet';
            default: return `Network ${id}`;
        }
    };

    const formatAssetName = (asset: EnhancedAsset) => {
        if (asset.unit === 'lovelace') return 'ADA';

        // Try to get human-readable name from asset info
        if (asset.assetInfo?.token_registry_metadata?.name) {
            return asset.assetInfo.token_registry_metadata.name;
        }

        if (asset.assetInfo?.asset_name_ascii) {
            return asset.assetInfo.asset_name_ascii;
        }

        // Fallback to asset name or unit
        return asset.assetName || asset.unit.slice(-8);
    };

    const formatAssetQuantity = (asset: EnhancedAsset) => {
        if (asset.unit === 'lovelace') {
            return formatLovelace(asset.quantity);
        }

        // Handle token quantities with decimals
        if (asset.decimals && asset.decimals > 0) {
            const quantity = parseInt(asset.quantity) / Math.pow(10, asset.decimals);
            return quantity.toFixed(asset.decimals);
        }

        return asset.quantity;
    };

    const getAssetImage = (asset: EnhancedAsset): string | null => {
        if (asset.unit === 'lovelace') return null;
        return findAssetImage(asset, true); // Enable debug mode
    };

    // Sort assets: ADA first, then by asset name
    const sortedBalance = balance.sort((a, b) => {
        if (a.unit === 'lovelace') return -1;
        if (b.unit === 'lovelace') return 1;
        return formatAssetName(a).localeCompare(formatAssetName(b));
    });

    if (!connected || !wallet) {
        return (
            <div className={styles.container}>
                <div className={styles.notConnected}>
                    <h2>Wallet Not Connected</h2>
                    <p>Please connect your wallet to view wallet information.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>Wallet Information</h2>
                <button
                    onClick={fetchWalletInfo}
                    className={styles.refreshBtn}
                    disabled={loading}
                >
                    {loading ? 'Loading...' : 'Refresh'}
                </button>
            </div>

            <div className={styles.infoGrid}>
                <div className={styles.infoCard}>
                    <h3>Network</h3>
                    <p>{networkId !== null ? getNetworkName(networkId) : 'Loading...'}</p>
                </div>

                <div className={styles.infoCard}>
                    <h3>Wallet Name</h3>
                    <p>{walletId}</p>
                </div>

                <div className={styles.infoCard}>
                    <h3>Stake Addresses</h3>
                    <p>{stakeAddresses.length} stake address(es)</p>
                </div>

                <div className={styles.infoCard}>
                    <h3>Addresses</h3>
                    <p>{addresses.length} unused addresses</p>
                </div>
            </div>

            {accountInfo.length > 0 && (
                <div className={styles.accountSection}>
                    <div className={styles.sectionHeader} onClick={() => setIsAccountInfoOpen(!isAccountInfoOpen)}>
                        <h3>Account Information</h3>
                        <span className={`${styles.chevron} ${isAccountInfoOpen ? styles.chevronOpen : ''}`}>▼</span>
                    </div>
                    {isAccountInfoOpen && (
                        <div className={styles.collapsibleContent}>
                            {accountInfo.map((account, index) => (
                                <div key={index} className={styles.accountInfo}>
                                    <div className={styles.accountRow}>
                                        <span className={styles.label}>Total Balance:</span>
                                        <span className={styles.value}>
                                            {formatLovelace(account.total_balance)}
                                        </span>
                                    </div>
                                    <div className={styles.accountRow}>
                                        <span className={styles.label}>UTxO Balance:</span>
                                        <span className={styles.value}>
                                            {formatLovelace(account.utxo)}
                                        </span>
                                    </div>
                                    <div className={styles.accountRow}>
                                        <span className={styles.label}>Rewards:</span>
                                        <span className={styles.value}>
                                            {formatLovelace(account.rewards)}
                                        </span>
                                    </div>
                                    {account.delegated_pool && (
                                        <div className={styles.accountRow}>
                                            <span className={styles.label}>Delegated Pool:</span>
                                            <span className={styles.value}>
                                                {account.delegated_pool.pool_name ||
                                                    (account.delegated_pool.pool_id ?
                                                        account.delegated_pool.pool_id.slice(0, 8) + '...' :
                                                        'Unknown Pool')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className={styles.balanceSection}>
                <h3>Token Balance</h3>
                {loading ? (
                    <p>Loading balance...</p>
                ) : (
                    <div className={styles.tokenList}>
                        <div className={styles.tokenListHeader}>
                            <div className={styles.tokenHeader}>Asset</div>
                            <div className={styles.tokenHeader}>Quantity</div>
                            <div className={styles.tokenHeader}>Value (USD)</div>
                        </div>
                        <div className={styles.tokenListBody}>
                            {sortedBalance.map((asset, index) => {
                                const imageUrl = getAssetImage(asset);
                                const isAda = asset.unit === 'lovelace';

                                return (
                                    <div key={`${asset.unit}-${index}`} className={styles.tokenRow}>
                                        <div className={styles.tokenCell}>
                                            <div className={styles.tokenImage}>
                                                {isAda ? (
                                                    <div className={styles.adaIcon}>₳</div>
                                                ) : imageUrl ? (
                                                    <img
                                                        src={imageUrl}
                                                        alt={formatAssetName(asset)}
                                                        className={styles.tokenImg}
                                                        onError={(e) => {
                                                            const target = e.target as HTMLImageElement;
                                                            target.style.display = 'none';
                                                            const placeholder = target.nextElementSibling as HTMLElement;
                                                            if(placeholder) placeholder.style.display = 'flex';
                                                        }}
                                                    />
                                                ) : (
                                                    <div className={styles.tokenPlaceholder}>
                                                        {formatAssetName(asset).charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={styles.tokenInfo}>
                                                <div className={styles.tokenName}>{formatAssetName(asset)}</div>
                                                <div className={styles.tokenTicker}>
                                                    {isAda ? 'Cardano' : asset.assetInfo?.token_registry_metadata?.ticker || asset.unit.slice(0, 12) + "..."}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`${styles.tokenCell} ${styles.tokenQuantity}`}>
                                            {formatAssetQuantity(asset)}
                                        </div>
                                        <div className={`${styles.tokenCell} ${styles.tokenValue}`}>
                                            {/* Placeholder for value */}
                                            {isAda ? `$${(parseInt(asset.quantity) / 1000000 * 0.35).toFixed(2)}` : 'N/A'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {(addresses.length > 0 || stakeAddresses.length > 0) && (
                <div className={styles.addressesSection}>
                    <div className={styles.addressTabs}>
                        <button
                            className={`${styles.tabButton} ${activeAddressTab === 'unused' ? styles.activeTab : ''}`}
                            onClick={() => setActiveAddressTab('unused')}
                        >
                            Unused Addresses ({addresses.length})
                        </button>
                        <button
                            className={`${styles.tabButton} ${activeAddressTab === 'stake' ? styles.activeTab : ''}`}
                            onClick={() => setActiveAddressTab('stake')}
                        >
                            Stake Addresses ({stakeAddresses.length})
                        </button>
                    </div>

                    <div className={styles.addressList}>
                        {activeAddressTab === 'unused' && addresses.map((address, index) => (
                            <div key={index} className={styles.address}>
                                <span className={styles.addressText}>
                                    {address.slice(0, 25)}...{address.slice(-12)}
                                </span>
                                <button
                                    onClick={() => navigator.clipboard.writeText(address)}
                                    className={styles.copyBtn}
                                    title="Copy address"
                                >
                                    Copy
                                </button>
                            </div>
                        ))}

                        {activeAddressTab === 'stake' && stakeAddresses.map((address, index) => (
                            <div key={index} className={styles.address}>
                                <span className={styles.addressText}>
                                    {address.slice(0, 25)}...{address.slice(-12)}
                                </span>
                                <button
                                    onClick={() => navigator.clipboard.writeText(address)}
                                    className={styles.copyBtn}
                                    title="Copy stake address"
                                >
                                    Copy
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
