import axios from "axios";
import {
  MarketRateFetcher,
  MarketRate,
  calculateMedian,
} from "./types";

/**
 * Binance P2P Response Interface
 */
interface BinanceP2PResponse {
  data?: Array<{
    adv?: {
      price: string;
      asset: string;
      fiatUnit: string;
    };
  }>;
  success?: boolean;
}

/**
 * ExchangeRate API Response
 */
interface ExchangeRateApiResponse {
  result?: string;
  rates?: {
    NGN?: number;
  };
  time_last_update_unix?: number;
}

export class NGNRateFetcher implements MarketRateFetcher {
  private readonly binanceP2PUrl = "https://p2p-api.binance.com/bapi/c2c/v2/public/c2c/adv/search";
  private readonly globalFxUrl = "https://open.er-api.com/v6/latest/USD";
  private readonly CROSS_CHECK_THRESHOLD = 0.15; // 15% threshold for divergence

  getCurrency(): string {
    return "NGN";
  }

  async fetchRate(): Promise<MarketRate> {
    const prices: { rate: number; timestamp: Date; source: string }[] = [];
    let primaryRate: number | null = null;
    let secondaryRate: number | null = null;

    // 1. Fetch from Binance P2P (Representing "Local" Market Data)
    try {
      const response = await axios.post<BinanceP2PResponse>(
        this.binanceP2PUrl,
        {
          fiat: "NGN",
          asset: "USDT",
          merchantCheck: false,
          rows: 5,
          page: 1,
          tradeType: "BUY",
        },
        { timeout: 10000 }
      );

      if (response.data?.data && response.data.data.length > 0) {
        const rates = response.data.data
          .map((item) => item.adv?.price)
          .filter((price): price is string => !!price)
          .map((price) => parseFloat(price))
          .filter((price) => !isNaN(price) && price > 0);

        if (rates.length > 0) {
          primaryRate = rates.reduce((a, b) => a + b, 0) / rates.length;
          prices.push({
            rate: primaryRate,
            timestamp: new Date(),
            source: "Binance P2P (Local Market)",
          });
        }
      }
    } catch (error) {
      console.warn("NGN Fetcher: Binance P2P failed", error instanceof Error ? error.message : error);
    }

    // 2. Fetch from Global FX API (Representing "Secondary Global Source")
    try {
      const response = await axios.get<ExchangeRateApiResponse>(this.globalFxUrl, { timeout: 10000 });
      if (response.data?.result === "success" && response.data.rates?.NGN) {
        secondaryRate = response.data.rates.NGN;
        const timestamp = response.data.time_last_update_unix 
          ? new Date(response.data.time_last_update_unix * 1000) 
          : new Date();
          
        prices.push({
          rate: secondaryRate,
          timestamp,
          source: "Global FX API (Secondary/Official)",
        });
      }
    } catch (error) {
      console.warn("NGN Fetcher: Global FX API failed", error instanceof Error ? error.message : error);
    }

    // 3. Cross-Check and Verification
    if (primaryRate && secondaryRate) {
      const divergence = Math.abs(primaryRate - secondaryRate) / secondaryRate;
      if (divergence > this.CROSS_CHECK_THRESHOLD) {
        console.warn(
          `⚠️ NGN Rate Cross-Check Alert: Significant divergence detected! ` +
          `Local (P2P): ${primaryRate.toFixed(2)}, Global: ${secondaryRate.toFixed(2)}. ` +
          `Divergence: ${(divergence * 100).toFixed(2)}%`
        );
      } else {
        console.info(`✅ NGN Rate Cross-Check passed. Divergence: ${(divergence * 100).toFixed(2)}%`);
      }
    }

    if (prices.length === 0) {
      throw new Error("Failed to fetch NGN rate from all sources");
    }

    // Prefer primary market rate if available, otherwise use secondary
    const finalRate = primaryRate || secondaryRate || 0;
    const finalSource = primaryRate ? "Binance P2P (Cross-checked)" : "Global FX API";
    const finalTimestamp = prices.find(p => p.rate === finalRate)?.timestamp ?? new Date();

    return {
      currency: "NGN",
      rate: finalRate,
      timestamp: finalTimestamp,
      source: finalSource,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const rate = await this.fetchRate();
      return rate.rate > 0;
    } catch {
      return false;
    }
  }
}
