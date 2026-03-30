import axios from "axios";
import { OUTGOING_HTTP_TIMEOUT_MS } from "../../utils/httpTimeout.js";
import { withRetry } from "../../utils/retryUtil.js";
import { createFetcherLogger } from "../../utils/logger.js";

export class CoinGeckoFetcher {
  private static readonly API_URL = "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";
  private static logger = createFetcherLogger("CoinGecko");

  /**
   * Fetches the current XLM/USD price from CoinGecko.
   * @returns The price as a number (e.g., 0.12 for 1 XLM = $0.12)
   * @throws Error if the fetch fails or the response is invalid
   */
  static async fetchXlmUsdPrice(): Promise<number> {
    const response = await withRetry(
      () =>
        axios.get(CoinGeckoFetcher.API_URL, {
          timeout: OUTGOING_HTTP_TIMEOUT_MS,
        }),
      {
        maxRetries: 3,
        retryDelay: 1000,
        onRetry: (attempt, error, delay) => {
          CoinGeckoFetcher.logger.debug(
            `API retry attempt ${attempt}/3 after ${delay}ms`,
            { error: error.message, attempt, delay }
          );
        },
      }
    );

    if (
      response.data &&
      response.data.stellar &&
      typeof response.data.stellar.usd === "number"
    ) {
      CoinGeckoFetcher.logger.info(
        `Successfully fetched XLM/USD price`,
        { price: response.data.stellar.usd }
      );
      return response.data.stellar.usd;
    }
    
    const error = new Error("Invalid response from CoinGecko API");
    CoinGeckoFetcher.logger.fetcherError(
      error,
      "API response validation failed",
      { responseData: response.data }
    );
    throw error;
  }
}
