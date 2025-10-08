-- Wallet Manager Database Schema
-- This schema defines the tables for managing user wallets and their balance snapshots

-- User Wallets Table
-- Stores information about user wallets and their stake addresses
CREATE TABLE user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stake_address VARCHAR(255) NOT NULL UNIQUE,
    wallet_name VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on stake_address for faster lookups
CREATE INDEX idx_user_wallets_stake_address ON user_wallets(stake_address);
CREATE INDEX idx_user_wallets_is_active ON user_wallets(is_active);

-- Wallet Snapshots Table
-- Stores daily balance snapshots for each wallet
CREATE TABLE wallet_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    ada_balance_lovelace BIGINT NOT NULL DEFAULT 0,
    assets JSONB NOT NULL DEFAULT '[]'::jsonb,
    exchange_rate_usd DECIMAL(20, 8) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one snapshot per wallet per date
    UNIQUE(wallet_id, snapshot_date)
);

-- Create indexes for better query performance
CREATE INDEX idx_wallet_snapshots_wallet_id ON wallet_snapshots(wallet_id);
CREATE INDEX idx_wallet_snapshots_snapshot_date ON wallet_snapshots(snapshot_date);
CREATE INDEX idx_wallet_snapshots_wallet_date ON wallet_snapshots(wallet_id, snapshot_date);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at on user_wallets
CREATE TRIGGER update_user_wallets_updated_at 
    BEFORE UPDATE ON user_wallets 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Sample data for testing (optional)
-- INSERT INTO user_wallets (stake_address, wallet_name) VALUES 
--     ('stake1uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'Test Wallet 1'),
--     ('stake1uyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 'Test Wallet 2');
