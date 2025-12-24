#!/usr/bin/env node

/**
 * Batch Snapshot Orchestrator
 * 
 * This script orchestrates the batch processing of wallet balance snapshots.
 * It calls the batch-snapshot API endpoint in batches to avoid overwhelming
 * the server and external APIs.
 */

interface BatchSnapshotResponse {
    success: boolean;
    processed: number;
    total: number;
    hasMore: boolean;
    nextBatch?: number;
    errors?: string[];
}

interface OrchestratorConfig {
    apiBaseUrl: string;
    authToken: string;
    batchSize: number;
    delayBetweenBatches: number; // seconds
    maxRetries: number;
}

class BatchSnapshotOrchestrator {
    private config: OrchestratorConfig;
    private currentBatch = 0;
    private totalProcessed = 0;
    private totalErrors = 0;

    constructor(config: OrchestratorConfig) {
        this.config = config;
    }

    private async delay(seconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    private async callBatchSnapshotAPI(batch: number): Promise<BatchSnapshotResponse> {
        const params = new URLSearchParams({
            batch: batch.toString(),
            batchSize: this.config.batchSize.toString()
        });
        
        const url = `${this.config.apiBaseUrl}/api/batch-snapshot?${params}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                // Prefer header auth so secrets don't appear in URLs/logs
                'Authorization': `Bearer ${this.config.authToken}`,
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        return response.json();
    }

    private async processBatchWithRetry(batch: number): Promise<BatchSnapshotResponse> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                console.log(`Processing batch ${batch} (attempt ${attempt}/${this.config.maxRetries})`);
                const result = await this.callBatchSnapshotAPI(batch);
                
                if (result.success) {
                    console.log(`✅ Batch ${batch} completed: ${result.processed} wallets processed`);
                    return result;
                } else {
                    throw new Error(`Batch ${batch} failed: ${result.errors?.join(', ') || 'Unknown error'}`);
                }
            } catch (error) {
                lastError = error as Error;
                console.error(`❌ Batch ${batch} attempt ${attempt} failed:`, lastError.message);
                
                if (attempt < this.config.maxRetries) {
                    const delaySeconds = Math.pow(2, attempt - 1); // Exponential backoff
                    console.log(`⏳ Retrying in ${delaySeconds} seconds...`);
                    await this.delay(delaySeconds);
                }
            }
        }

        throw lastError || new Error(`Failed to process batch ${batch} after ${this.config.maxRetries} attempts`);
    }

    async run(): Promise<void> {
        console.log('🚀 Starting batch snapshot orchestration');
        console.log(`📊 Configuration:`, {
            batchSize: this.config.batchSize,
            delayBetweenBatches: this.config.delayBetweenBatches,
            maxRetries: this.config.maxRetries
        });

        const startTime = Date.now();
        let hasMore = true;

        try {
            while (hasMore) {
                const result = await this.processBatchWithRetry(this.currentBatch);
                
                this.totalProcessed += result.processed;
                this.totalErrors += result.errors?.length || 0;
                
                if (result.errors && result.errors.length > 0) {
                    console.warn(`⚠️  Batch ${this.currentBatch} had ${result.errors.length} errors:`, result.errors);
                }

                hasMore = result.hasMore;
                this.currentBatch = result.nextBatch || this.currentBatch + 1;

                if (hasMore) {
                    console.log(`⏳ Waiting ${this.config.delayBetweenBatches} seconds before next batch...`);
                    await this.delay(this.config.delayBetweenBatches);
                }
            }

            const duration = Math.round((Date.now() - startTime) / 1000);
            console.log('🎉 Batch snapshot orchestration completed successfully!');
            console.log(`📈 Summary:`, {
                totalProcessed: this.totalProcessed,
                totalErrors: this.totalErrors,
                duration: `${duration} seconds`,
                batchesProcessed: this.currentBatch
            });

        } catch (error) {
            console.error('💥 Batch snapshot orchestration failed:', error);
            process.exit(1);
        }
    }
}

// Main execution
async function main() {
    const config: OrchestratorConfig = {
        apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
        authToken: process.env.SNAPSHOT_AUTH_TOKEN || '',
        batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
        delayBetweenBatches: parseInt(process.env.DELAY_BETWEEN_BATCHES || '5', 10),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10)
    };

    // Validate required environment variables
    if (!config.authToken) {
        console.error('❌ SNAPSHOT_AUTH_TOKEN environment variable is required');
        process.exit(1);
    }

    if (!config.apiBaseUrl) {
        console.error('❌ API_BASE_URL environment variable is required');
        process.exit(1);
    }

    const orchestrator = new BatchSnapshotOrchestrator(config);
    await orchestrator.run();
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run the orchestrator
main().catch((error) => {
    console.error('💥 Main execution failed:', error);
    process.exit(1);
});

export { BatchSnapshotOrchestrator };
