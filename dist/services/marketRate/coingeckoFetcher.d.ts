export declare class CoinGeckoFetcher {
    private static readonly API_URL;
    /**
     * Fetches the current XLM/USD price from CoinGecko.
     * @returns The price as a number (e.g., 0.12 for 1 XLM = $0.12)
     * @throws Error if the fetch fails or the response is invalid
     */
    static fetchXlmUsdPrice(): Promise<number>;
}
//# sourceMappingURL=coingeckoFetcher.d.ts.map