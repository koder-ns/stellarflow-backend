import assert from 'node:assert/strict';
import axios from 'axios';
import { GHSRateFetcher } from '../src/services/marketRate/ghsFetcher';

async function run() {
  const originalGet = axios.get;

  try {
    const fetcher = new GHSRateFetcher();

    axios.get = (async (url: string) => {
      if (url.includes('api.coingecko.com')) {
        return {
          data: {
            stellar: {
              ghs: 2.45,
              usd: 0.18,
              last_updated_at: 1_774_464_561
            }
          }
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof axios.get;

    const directRate = await fetcher.fetchRate();
    assert.equal(directRate.currency, 'GHS');
    assert.equal(directRate.rate, 2.45);
    assert.equal(directRate.source, 'Weighted average of 1 sources (outliers filtered)');

    let exchangeRateRequested = false;

    axios.get = (async (url: string) => {
      if (url.includes('api.coingecko.com')) {
        return {
          data: {
            stellar: {
              usd: 0.2,
              last_updated_at: 1_774_464_561
            }
          }
        };
      }

      if (url.includes('open.er-api.com')) {
        exchangeRateRequested = true;
        return {
          data: {
            result: 'success',
            rates: {
              GHS: 10
            },
            time_last_update_unix: 1_774_396_951
          }
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof axios.get;

    const fallbackRate = await fetcher.fetchRate();
    assert.equal(exchangeRateRequested, true);
    assert.equal(fallbackRate.currency, 'GHS');
    assert.equal(fallbackRate.rate, 2);
    assert.equal(fallbackRate.source, 'Weighted average of 2 sources (outliers filtered)');
  } finally {
    axios.get = originalGet;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

