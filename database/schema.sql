-- Wallet Manager Database Schema
-- This schema defines the tables for managing user wallets, thresholds, and time-series snapshots

-- NOTE:
-- - This file is intended for Supabase Postgres.
-- - It is written to be safely re-runnable in fresh environments (CREATE IF NOT EXISTS where reasonable).
-- - If you already have existing tables, you may need to migrate data manually.

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- User Wallets Table
-- Stores information about user wallets and their stake addresses
CREATE TABLE IF NOT EXISTS user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stake_address VARCHAR(255) NOT NULL UNIQUE,
    wallet_name VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- Alerting & rebalancing settings (percentage points, not fraction)
    deviation_threshold_pct_points NUMERIC(10, 4) NOT NULL DEFAULT 10,
    -- Swap fees, in basis points (e.g. 30 = 0.30%)
    swap_fee_bps INTEGER NOT NULL DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on stake_address for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_wallets_stake_address ON user_wallets(stake_address);
CREATE INDEX IF NOT EXISTS idx_user_wallets_is_active ON user_wallets(is_active);

-- Wallet Token Targets (Thresholds)
-- Stores desired portfolio allocation per token (percentage points, should sum to 100)
CREATE TABLE IF NOT EXISTS wallet_token_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    -- Asset unit: 'lovelace' for ADA, otherwise policy_id || asset_name (hex) per Cardano convention
    unit TEXT NOT NULL,
    target_pct_points NUMERIC(10, 4) NOT NULL CHECK (target_pct_points >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(wallet_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_wallet_token_targets_wallet_id ON wallet_token_targets(wallet_id);

-- Wallet Snapshots Table
-- Stores periodic balance snapshots for each wallet (intended every 4 hours)
CREATE TABLE IF NOT EXISTS wallet_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    -- The moment we took the snapshot
    snapshot_at TIMESTAMP WITH TIME ZONE NOT NULL,
    -- A rounded bucket for idempotency (e.g., date_trunc('hour', snapshot_at))
    snapshot_bucket TIMESTAMP WITH TIME ZONE NOT NULL,
    ada_balance_lovelace NUMERIC(78, 0) NOT NULL DEFAULT 0,
    -- ADA/USD rate at snapshot time
    ada_usd_rate DECIMAL(20, 8) NOT NULL,
    -- Total portfolio value (ADA + priced tokens) at snapshot time
    total_value_ada DECIMAL(38, 12) NOT NULL DEFAULT 0,
    total_value_usd DECIMAL(38, 12) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one snapshot per wallet per bucket
    UNIQUE(wallet_id, snapshot_bucket)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_wallet_id ON wallet_snapshots(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_snapshot_bucket ON wallet_snapshots(snapshot_bucket);
CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_wallet_bucket ON wallet_snapshots(wallet_id, snapshot_bucket);

-- Snapshot Assets Table
-- Stores normalized per-asset breakdown for each snapshot
CREATE TABLE IF NOT EXISTS wallet_snapshot_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES wallet_snapshots(id) ON DELETE CASCADE,
    unit TEXT NOT NULL,
    quantity NUMERIC(78, 0) NOT NULL DEFAULT 0,
    decimals INTEGER,
    -- Pricing/valuation at snapshot time (if known)
    price_ada DECIMAL(38, 18),
    price_usd DECIMAL(38, 18),
    value_ada DECIMAL(38, 12),
    value_usd DECIMAL(38, 12),
    pct_of_portfolio NUMERIC(10, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(snapshot_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_wallet_snapshot_assets_snapshot_id ON wallet_snapshot_assets(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_wallet_snapshot_assets_unit ON wallet_snapshot_assets(unit);

-- Token Price Snapshots
-- Stores token prices at snapshot time (in ADA and USD) so alerts/strategies remain reproducible later.
CREATE TABLE IF NOT EXISTS token_price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_bucket TIMESTAMP WITH TIME ZONE NOT NULL,
    unit TEXT NOT NULL,
    price_ada DECIMAL(38, 18),
    price_usd DECIMAL(38, 18),
    source TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(snapshot_bucket, unit)
);

CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_bucket ON token_price_snapshots(snapshot_bucket);
CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_unit ON token_price_snapshots(unit);

-- Alert Events
-- Stores deviation alerts raised for wallets at a given snapshot
CREATE TABLE IF NOT EXISTS wallet_alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    snapshot_id UUID REFERENCES wallet_snapshots(id) ON DELETE SET NULL,
    deviation_threshold_pct_points NUMERIC(10, 4) NOT NULL,
    -- details: computed allocations, diffs, missing prices, and suggested swaps
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    discord_sent BOOLEAN NOT NULL DEFAULT false,
    discord_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_alert_events_wallet_id ON wallet_alert_events(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_alert_events_created_at ON wallet_alert_events(created_at);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at on user_wallets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_wallets_updated_at'
    ) THEN
        CREATE TRIGGER update_user_wallets_updated_at
            BEFORE UPDATE ON user_wallets
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Create trigger to automatically update updated_at on wallet_token_targets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_wallet_token_targets_updated_at'
    ) THEN
        CREATE TRIGGER update_wallet_token_targets_updated_at
            BEFORE UPDATE ON wallet_token_targets
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Sample data for testing (optional)
-- INSERT INTO user_wallets (stake_address, wallet_name) VALUES 
--     ('stake1uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'Test Wallet 1'),
--     ('stake1uyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 'Test Wallet 2');
