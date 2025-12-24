-- Wallet Manager Database Schema (Reset-friendly)
-- Goal: scale snapshots across many wallets by:
-- - storing wallet balances per bucket
-- - storing token USD prices once per bucket (deduped across wallets)
-- - allowing per-wallet threshold basis (USD / ADA / BTC derived / holdings)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigger helper
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ===== Core Wallets =====
CREATE TABLE IF NOT EXISTS user_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stake_address VARCHAR(255) NOT NULL UNIQUE,
    wallet_name VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- How thresholds/allocations are evaluated for this wallet:
    -- 'usd' = allocations by USD value
    -- 'ada' = allocations by ADA value (derived from USD via ADAUSD)
    -- 'btc' = allocations by BTC value (derived from USD via BTCUSD)
    -- 'holdings' = allocations by raw token quantities (warning: mixed units)
    threshold_basis TEXT NOT NULL DEFAULT 'usd'
        CHECK (threshold_basis IN ('usd','ada','btc','holdings')),

    deviation_threshold_pct_points NUMERIC(10, 4) NOT NULL DEFAULT 10,
    swap_fee_bps INTEGER NOT NULL DEFAULT 30,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_stake_address ON user_wallets(stake_address);
CREATE INDEX IF NOT EXISTS idx_user_wallets_is_active ON user_wallets(is_active);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_wallets_updated_at') THEN
        CREATE TRIGGER update_user_wallets_updated_at
            BEFORE UPDATE ON user_wallets
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ===== Targets (what we monitor) =====
CREATE TABLE IF NOT EXISTS wallet_token_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    unit TEXT NOT NULL, -- 'lovelace' for ADA, else policy_id || asset_name(hex)
    target_pct_points NUMERIC(10, 4) NOT NULL CHECK (target_pct_points >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(wallet_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_wallet_token_targets_wallet_id ON wallet_token_targets(wallet_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_wallet_token_targets_updated_at') THEN
        CREATE TRIGGER update_wallet_token_targets_updated_at
            BEFORE UPDATE ON wallet_token_targets
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ===== Snapshot buckets =====
-- One row per wallet per bucket. We keep this table small.
CREATE TABLE IF NOT EXISTS wallet_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    snapshot_at TIMESTAMP WITH TIME ZONE NOT NULL,
    snapshot_bucket TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(wallet_id, snapshot_bucket)
);

CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_wallet_bucket ON wallet_snapshots(wallet_id, snapshot_bucket);
CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_bucket ON wallet_snapshots(snapshot_bucket);

-- Per-snapshot balances, but only for tokens we actually monitor (targets + ADA by default).
CREATE TABLE IF NOT EXISTS wallet_snapshot_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES wallet_snapshots(id) ON DELETE CASCADE,
    unit TEXT NOT NULL,
    quantity_raw NUMERIC(78, 0) NOT NULL DEFAULT 0,
    decimals INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(snapshot_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_wallet_snapshot_balances_snapshot_id ON wallet_snapshot_balances(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_wallet_snapshot_balances_unit ON wallet_snapshot_balances(unit);

-- ===== Global token price snapshots (USD only) =====
-- Dedupe across all wallets: one price per bucket per unit.
-- Special units:
-- - 'lovelace' => ADAUSD
-- - 'BTC' => BTCUSD
--
-- Token definitions live in `tokens` and drive how we fetch USD prices.
CREATE TABLE IF NOT EXISTS token_price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_bucket TIMESTAMP WITH TIME ZONE NOT NULL,
    unit TEXT NOT NULL,
    price_usd DECIMAL(38, 18),
    source TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(snapshot_bucket, unit)
);

CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_bucket_unit ON token_price_snapshots(snapshot_bucket, unit);
CREATE INDEX IF NOT EXISTS idx_token_price_snapshots_unit ON token_price_snapshots(unit);

-- ===== Token definitions (how to fetch USD prices) =====
-- Store the identifiers each pricing API expects so the cron job can fetch prices reliably.
CREATE TABLE IF NOT EXISTS tokens (
    unit TEXT PRIMARY KEY, -- Cardano unit (policy_id||asset_name hex), or special: 'lovelace', 'BTC'
    display_name TEXT,
    ticker TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,

    pricing_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (pricing_source IN ('kraken','coingecko','manual')),

    -- Kraken settings:
    -- Example: unit='lovelace' => kraken_pair_query='ADAUSD', kraken_result_key_hint='ADAUSD'
    -- Example: unit='BTC'      => kraken_pair_query='XBTUSD', kraken_result_key_hint='XBTUSD'
    kraken_pair_query TEXT,
    kraken_result_key_hint TEXT,

    -- CoinGecko settings:
    -- Example: coingecko_id='djed' or 'bitcoin'
    coingecko_id TEXT,

    -- Manual fallback
    manual_price_usd DECIMAL(38, 18),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_is_active ON tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_tokens_pricing_source ON tokens(pricing_source);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_tokens_updated_at') THEN
        CREATE TRIGGER update_tokens_updated_at
            BEFORE UPDATE ON tokens
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Recommended seed rows (optional, but strongly suggested)
INSERT INTO tokens (unit, display_name, ticker, pricing_source, kraken_pair_query, kraken_result_key_hint)
VALUES
    ('lovelace', 'Cardano', 'ADA', 'kraken', 'ADAUSD', 'ADAUSD'),
    ('BTC', 'Bitcoin', 'BTC', 'kraken', 'XBTUSD', 'XBTUSD')
ON CONFLICT (unit) DO NOTHING;

-- ===== Alert Events =====
CREATE TABLE IF NOT EXISTS wallet_alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    snapshot_id UUID REFERENCES wallet_snapshots(id) ON DELETE SET NULL,
    deviation_threshold_pct_points NUMERIC(10, 4) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    discord_sent BOOLEAN NOT NULL DEFAULT false,
    discord_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_alert_events_wallet_id ON wallet_alert_events(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_alert_events_created_at ON wallet_alert_events(created_at);

-- Sample data for testing (optional)
-- INSERT INTO user_wallets (stake_address, wallet_name) VALUES 
--     ('stake1uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'Test Wallet 1'),
--     ('stake1uyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 'Test Wallet 2');
