export interface ExchangeRates {
    usd: number;
}

export interface KrakenResponse {
    result: {
        ADAUSD: {
            a: string[]; // Ask price array
            b: string[]; // Bid price array
            c: string[]; // Last trade closed array
            v: string[]; // Volume array
            p: string[]; // Volume weighted average price array
            t: number[]; // Number of trades array
            l: string[]; // Low array
            h: string[]; // High array
            o: string;   // Today's opening price
        };
    };
}

export class ExchangeRateService {
    private static readonly KRAKEN_API_URL = 'https://api.kraken.com/0/public/Ticker';
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private static cache: { rates: ExchangeRates; timestamp: number } | null = null;

    /**
     * Fetches current ADA/USD exchange rate from Kraken API
     * Includes caching to avoid excessive API calls
     */
    static async getCurrentRates(): Promise<ExchangeRates> {
        // Check cache first
        if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_DURATION) {
            return this.cache.rates;
        }

        try {
            const response = await fetch(
                `${this.KRAKEN_API_URL}?pair=ADAUSD`,
                {
                    headers: {
                        'Accept': 'application/json',
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
            }

            const data: KrakenResponse = await response.json();
            
            if (!data.result || !data.result.ADAUSD) {
                throw new Error('ADA/USD data not found in Kraken API response');
            }

            // Use the last trade closed price (c[0]) as the current rate
            const usdRate = parseFloat(data.result.ADAUSD.c[0]);
            
            if (isNaN(usdRate) || usdRate <= 0) {
                throw new Error('Invalid USD rate received from Kraken API');
            }

            const rates: ExchangeRates = {
                usd: usdRate,
            };

            // Update cache
            this.cache = {
                rates,
                timestamp: Date.now()
            };

            return rates;
        } catch (error) {
            console.error('Error fetching exchange rates:', error);
            
            // Return cached rates if available, otherwise throw error
            if (this.cache) {
                console.warn('Using cached exchange rates due to API error');
                return this.cache.rates;
            }
            
            throw new Error('Failed to fetch exchange rates and no cache available');
        }
    }

    /**
     * Converts ADA from lovelace to ADA units
     */
    static lovelaceToAda(lovelace: number): number {
        return lovelace / 1_000_000;
    }

    /**
     * Converts ADA from ADA units to lovelace
     */
    static adaToLovelace(ada: number): number {
        return Math.round(ada * 1_000_000);
    }

    /**
     * Calculates USD value of ADA balance
     */
    static calculateUsdValue(adaBalance: number, usdRate: number): number {
        return adaBalance * usdRate;
    }
}
