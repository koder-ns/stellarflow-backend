import { MarketRateService } from "../src/services/marketRate";
import { MarketRate } from "../src/services/marketRate";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  const service = Object.create(MarketRateService.prototype) as any;
  service.databaseCalls = 0;
  service.redisData = new Map<string, { value: string; expiresAt: number }>();
  service.cache = new Map<string, unknown>();
  service.LATEST_PRICES_REDIS_KEY = "market-rates:latest:v1";
  service.LATEST_PRICES_REDIS_TTL_SECONDS = 5;
  service.getLatestPricesCacheClient = () => ({
    get: async (key: string): Promise<string | null> => {
      const entry = service.redisData.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        service.redisData.delete(key);
        return null;
      }

      return entry.value;
    },
    setEx: async (
      key: string,
      ttlSeconds: number,
      value: string,
    ): Promise<void> => {
      service.redisData.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    },
    del: async (key: string): Promise<void> => {
      service.redisData.delete(key);
    },
  });
  service.fetchLatestPricesFromDatabase = async (): Promise<MarketRate[]> => {
    service.databaseCalls += 1;
    return [
      {
        currency: "KES",
        rate: 150,
        timestamp: new Date("2026-03-27T12:00:00.000Z"),
        source: "test",
      },
      {
        currency: "GHS",
        rate: 15,
        timestamp: new Date("2026-03-27T12:00:00.000Z"),
        source: "test",
      },
    ];
  };

  const firstResponse = await service.getLatestPrices();
  const secondResponse = await service.getLatestPrices();

  assert(firstResponse.success, "first latest-prices response should succeed");
  assert(
    secondResponse.success,
    "second latest-prices response should succeed",
  );
  assert(
    service.databaseCalls === 1,
    `expected Redis cache hit to avoid a second database query, got ${service.databaseCalls} queries`,
  );
  assert(
    firstResponse !== secondResponse,
    "expected Redis cache hit to return an equivalent payload, not the same object reference",
  );
  assert(
    firstResponse.data?.[0]?.timestamp instanceof Date,
    "expected first response timestamps to be Date objects",
  );
  assert(
    secondResponse.data?.[0]?.timestamp instanceof Date,
    "expected Redis response timestamps to be Date objects after hydration",
  );

  await new Promise((resolve) => setTimeout(resolve, 5100));

  const thirdResponse = await service.getLatestPrices();

  assert(thirdResponse.success, "third latest-prices response should succeed");
  assert(
    service.databaseCalls === 2,
    `expected TTL expiration to trigger a refresh, got ${service.databaseCalls} queries`,
  );

  service.clearCache();
  const fourthResponse = await service.getLatestPrices();

  assert(
    fourthResponse.success,
    "fourth latest-prices response should succeed after manual cache clear",
  );
  assert(
    service.databaseCalls === 3,
    `expected clearCache to force a fresh query, got ${service.databaseCalls} queries`,
  );

  console.log("responseCaching.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
