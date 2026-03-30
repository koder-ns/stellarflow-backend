import axios from 'axios';
import { MarketRateFetcher, MarketRate } from './types';
import { validatePrice } from './validation';
import { OUTGOING_HTTP_TIMEOUT_MS } from '../../utils/httpTimeout.js';

type CoinGeckoPriceResponse = {
  stellar?: {
    ghs?: number;
    usd?: number;
    last_updated_at?: number;
  };
};

type ExchangeRateApiResponse = {
  result?: string;
  rates?: {
    GHS?: number;
  };
  time_last_update_unix?: number;
};

export class GHSRateFetcher implements MarketRateFetcher {
  private readonly coinGeckoUrl =
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=ghs,usd&include_last_updated_at=true";

  private readonly usdToGhsUrl = "https://open.er-api.com/v6/latest/USD";

  getCurrency(): string {
    return "GHS";
  }

  async fetchRate(): Promise<MarketRate> {
    const prices: {
      rate: number;
      timestamp: Date;
      source: string;
      trustLevel: SourceTrustLevel;
    }[] = [];

    // Strategy 1: Try CoinGecko direct GHS price
    try {
      const coinGeckoResponse = await withRetry(
        () => axios.get<CoinGeckoPriceResponse>(
          this.coinGeckoUrl,
          {
            timeout: OUTGOING_HTTP_TIMEOUT_MS,
            headers: {
              "User-Agent": "StellarFlow-Oracle/1.0",
            },
          },
        ),
        { maxRetries: 3, retryDelay: 1000 }
      );

      const stellarPrice = coinGeckoResponse.data.stellar;
      if (
        stellarPrice &&
        typeof stellarPrice.ghs === "number" &&
        stellarPrice.ghs > 0
      ) {
        const lastUpdatedAt = stellarPrice.last_updated_at
          ? new Date(stellarPrice.last_updated_at * 1000)
          : new Date();

        prices.push({
          rate: stellarPrice.ghs,
          timestamp: lastUpdatedAt,
          source: "CoinGecko (direct)",
          trustLevel: "standard",
        });
        
        // Success - reset error tracker
        errorTracker.trackSuccess("GHS-price-fetch");
      }
    } catch (error) {
      console.debug("CoinGecko direct GHS price failed");
    }

    // Strategy 2: CoinGecko XLM/USD + ExchangeRate API
    try {
      const coinGeckoResponse = await withRetry(
        () => axios.get<CoinGeckoPriceResponse>(
          this.coinGeckoUrl,
          {
            timeout: OUTGOING_HTTP_TIMEOUT_MS,
            headers: {
              "User-Agent": "StellarFlow-Oracle/1.0",
            },
          },
        ),
        { maxRetries: 3, retryDelay: 1000 }
      );

      const stellarPrice = coinGeckoResponse.data.stellar;
      if (
        stellarPrice &&
        typeof stellarPrice.usd === "number" &&
        stellarPrice.usd > 0
      ) {
        const exchangeRateResponse = await withRetry(
          () => axios.get<ExchangeRateApiResponse>(
            this.usdToGhsUrl,
            {
              timeout: OUTGOING_HTTP_TIMEOUT_MS,
              headers: {
                "User-Agent": "StellarFlow-Oracle/1.0",
              },
            },
          ),
          { maxRetries: 3, retryDelay: 1000 }
        );

      if (typeof stellarPrice.usd !== 'number') {
        throw new Error('CoinGecko did not return a usable USD price for Stellar');
      }
    } catch (error) {
      console.debug("CoinGecko + ExchangeRate API failed");
    }

      const usdPrice = validatePrice(stellarPrice.usd);

      const exchangeRateResponse = await axios.get<ExchangeRateApiResponse>(this.usdToGhsUrl, {
        timeout: OUTGOING_HTTP_TIMEOUT_MS,
        headers: {
          "User-Agent": "StellarFlow-Oracle/1.0",
        },
      });

      const usdToGhsRate = exchangeRateResponse.data.rates?.GHS;
      if (exchangeRateResponse.data.result !== 'success' || typeof usdToGhsRate !== 'number') {
        throw new Error('USD to GHS conversion feed did not return a usable GHS rate');
      }
    } catch (error) {
      console.debug("Alternative XLM pricing source failed");
    }

    // If we have prices, calculate median
    if (prices.length > 0) {
      let rateValues = prices.map((p) => p.rate).filter(p => p > 0);
      rateValues = filterOutliers(rateValues);
      const medianRate = calculateMedian(rateValues);
      const mostRecentTimestamp = prices.reduce(
        (latest, p) => (p.timestamp > latest ? p.timestamp : latest),
        prices[0]?.timestamp ?? new Date(),
      );

      const validatedUsdToGhsRate = validatePrice(usdToGhsRate);

      const fxTimestamp = exchangeRateResponse.data.time_last_update_unix
        ? new Date(exchangeRateResponse.data.time_last_update_unix * 1000)
        : lastUpdatedAt;

      return {
        currency: 'GHS',
        rate: validatePrice(usdPrice * validatedUsdToGhsRate),
        timestamp: fxTimestamp > lastUpdatedAt ? fxTimestamp : lastUpdatedAt,
        source: 'CoinGecko + ExchangeRate API'
      };
    }

    // All strategies failed - track failure and send notification if 3 consecutive failures
    const error = new Error("All GHS rate sources failed");
    const thresholdReached = errorTracker.trackFailure("GHS-price-fetch", {
      errorMessage: error.message,
      timestamp: new Date(),
      service: "GHSRateFetcher",
    });
    
    if (thresholdReached) {
      await webhookService.sendErrorNotification({
        errorType: "PRICE_FETCH_FAILED_CONSECUTIVE",
        errorMessage: error.message,
        attempts: 3,
        service: "GHSRateFetcher",
        pricePair: "XLM/GHS",
        timestamp: new Date(),
      });
    }
    
    throw error;
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
