import React, { useState, useEffect } from 'react';
import { useWallet } from '@meshsdk/react';
import { BrowserWallet } from '@meshsdk/core';
import { WalletService } from '../services/walletService';
import styles from '../styles/components/Navbar.module.css';

interface WalletInfo {
    name: string;
    icon: string;
    version: string;
    id: string;
}

export default function Navbar() {
    const { connect, disconnect, connecting, connected, wallet } = useWallet();
    const [availableWallets, setAvailableWallets] = useState<WalletInfo[]>([]);
    const [showWalletList, setShowWalletList] = useState(false);
    const [walletBalance, setWalletBalance] = useState<string>('');
    const [connectedWalletName, setConnectedWalletName] = useState<string>('');

    useEffect(() => {
        // Get available wallets when component mounts
        const getWallets = async () => {
            try {
                const wallets = await BrowserWallet.getAvailableWallets();
                console.log('🔍 Raw detected wallets:', wallets);
                // Map wallet names to their correct identifiers for connection
                const walletsWithId = wallets.map(w => {
                    // Use the actual wallet ID that the wallet provides
                    // This is more reliable than hardcoded mappings
                    return { ...w, id: w.id };
                });

                console.log('🆔 Mapped wallets with IDs:', walletsWithId);
                setAvailableWallets(walletsWithId);

                // Check if there's a previously connected wallet to restore
                const storedWalletId = localStorage.getItem('connectedWalletId');
                if (storedWalletId && !connected) {
                    console.log('🔄 Attempting to restore wallet connection for:', storedWalletId);
                    // Try to reconnect to the stored wallet
                    try {
                        await connect(storedWalletId, true);
                        console.log('✅ Successfully restored wallet connection for:', storedWalletId);
                        // Set the display name
                        const walletInfo = walletsWithId.find(w => w.id === storedWalletId);
                        if (walletInfo) {
                            setConnectedWalletName(walletInfo.name);
                        }
                    } catch (error) {
                        console.error('❌ Failed to restore wallet connection:', error);
                        // Remove the stored wallet ID if restoration fails
                        localStorage.removeItem('connectedWalletId');
                    }
                }
            } catch (error) {
                console.error('Error getting available wallets:', error);
            }
        };
        getWallets();
    }, []); // Remove 'connected' dependency to avoid infinite loops

    useEffect(() => {
        // Get wallet balance and store wallet when wallet is connected
        if (connected && wallet) {
            const getBalance = async () => {
                try {
                    const balance = await wallet.getLovelace();
                    setWalletBalance(balance);
                } catch (error) {
                    console.error('Error getting wallet balance:', error);
                }
            };

            const storeWallet = async () => {
                try {
                    // Get the stake address from the connected wallet
                    const stakeAddresses = await wallet.getRewardAddresses();
                    if (stakeAddresses && stakeAddresses.length > 0) {
                        const stakeAddress = stakeAddresses[0];
                        console.log('💾 Storing wallet in database with stake address:', stakeAddress);
                        
                        const result = await WalletService.storeWallet(stakeAddress, connectedWalletName);
                        if (result.success) {
                            console.log('✅ Wallet stored successfully:', result.message);
                        } else {
                            console.warn('⚠️ Failed to store wallet:', result.message);
                        }
                    } else {
                        console.warn('⚠️ No stake address found for connected wallet');
                    }
                } catch (dbError) {
                    console.error('❌ Error storing wallet in database:', dbError);
                    // Don't fail the connection if database storage fails
                }
            };

            getBalance();
            storeWallet();
        }
    }, [connected, wallet, connectedWalletName]);

    const handleConnect = async (walletId: string) => {
        console.log('🔌 Attempting to connect to wallet ID:', walletId);
        try {
            await connect(walletId);
            console.log('✅ Successfully connected to wallet ID:', walletId);

            // Store wallet ID in localStorage for persistence
            localStorage.setItem('connectedWalletId', walletId);

            // Find the display name for this wallet ID
            const wallet = availableWallets.find(w => w.id === walletId);
            setConnectedWalletName(wallet ? wallet.name : walletId);
            setShowWalletList(false);

        } catch (error) {
            console.error('❌ Error connecting wallet:', error);
        }
    };

    const handleDisconnect = () => {
        disconnect();
        setWalletBalance('');
        setConnectedWalletName('');
        // Remove stored wallet ID
        localStorage.removeItem('connectedWalletId');
    };

    const formatLovelace = (lovelace: string) => {
        const ada = parseInt(lovelace) / 1000000;
        return `${ada.toFixed(2)} ADA`;
    };

    return (
        <nav className={styles.navbar}>
            <div className={styles.container}>
                <div className={styles.logo}>
                    <h1>Wallet Manager</h1>
                </div>

                <div className={styles.walletSection}>
                    {connected ? (
                        <div className={styles.connectedWallet}>
                            <div className={styles.walletInfo}>
                                <span className={styles.walletName}>
                                    {connectedWalletName || 'Connected Wallet'}
                                </span>
                                {walletBalance && (
                                    <span className={styles.balance}>
                                        {formatLovelace(walletBalance)}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={handleDisconnect}
                                className={styles.disconnectBtn}
                            >
                                Disconnect
                            </button>
                        </div>
                    ) : (
                        <div className={styles.connectSection}>
                            <button
                                onClick={() => setShowWalletList(!showWalletList)}
                                className={styles.connectBtn}
                                disabled={connecting}
                            >
                                {connecting ? 'Connecting...' : 'Connect Wallet'}
                            </button>

                            {showWalletList && (
                                <div className={styles.walletList}>
                                    {availableWallets.length > 0 ? (
                                        availableWallets.map((wallet) => (
                                            <button
                                                key={wallet.id}
                                                onClick={() => handleConnect(wallet.id)}
                                                className={styles.walletOption}
                                            >
                                                <img
                                                    src={wallet.icon}
                                                    alt={wallet.name}
                                                    className={styles.walletIcon}
                                                />
                                                <span>{wallet.name}</span>
                                                <span className={styles.version}>v{wallet.version}</span>
                                            </button>
                                        ))
                                    ) : (
                                        <div className={styles.noWallets}>
                                            No wallets detected. Please install a Cardano wallet extension.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
}
