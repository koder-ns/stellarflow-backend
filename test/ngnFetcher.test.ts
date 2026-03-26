import assert from 'node:assert/strict';
import axios from 'axios';
import { NGNRateFetcher } from '../src/services/marketRate/ngnFetcher';

async function run() {
  const originalPost = axios.post;
  const originalGet = axios.get;

  try {
    const fetcher = new NGNRateFetcher();

    // Test Case 1: Normal operation where both sources are close
    console.log('🧪 Test Case 1: Normal operation (sources are close)');
    axios.post = (async (url: string) => {
      if (url.includes('binance.com')) {
        return {
          data: {
            success: true,
            data: [{ adv: { price: '1500.00' } }, { adv: { price: '1500.00' } }]
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof axios.post;

    axios.get = (async (url: string) => {
      if (url.includes('open.er-api.com')) {
        return {
          data: {
            result: 'success',
            rates: { NGN: 1450.00 },
            time_last_update_unix: Date.now() / 1000
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof axios.get;

    const rate = await fetcher.fetchRate();
    assert.equal(rate.currency, 'NGN');
    assert.equal(rate.rate, 1500.00);
    assert.equal(rate.source, 'Binance P2P (Cross-checked)');
    console.log('✅ Test Case 1 passed');

    // Test Case 2: Divergence exceeding threshold
    console.log('\n🧪 Test Case 2: Significant divergence');
    axios.get = (async (url: string) => {
      if (url.includes('open.er-api.com')) {
        return {
          data: {
            result: 'success',
            rates: { NGN: 1200.00 }, // Big gap: (1500-1200)/1200 = 25% > 15%
            time_last_update_unix: Date.now() / 1000
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof axios.get;

    const divergentRate = await fetcher.fetchRate();
    assert.equal(divergentRate.rate, 1500.00); 
    console.log('✅ Test Case 2 (Check logs for warning)');

    // Test Case 3: Only primary source works
    console.log('\n🧪 Test Case 3: Only primary source works');
    axios.get = (async () => { throw new Error('Global API Down'); }) as typeof axios.get;
    const primaryOnlyRate = await fetcher.fetchRate();
    assert.equal(primaryOnlyRate.rate, 1500.00);
    assert.equal(primaryOnlyRate.source, 'Binance P2P (Cross-checked)');
    console.log('✅ Test Case 3 passed');

    // Test Case 4: Only secondary source works
    console.log('\n🧪 Test Case 4: Only secondary source works');
    axios.post = (async () => { throw new Error('Binance P2P Down'); }) as typeof axios.post;
    axios.get = (async (url: string) => {
      if (url.includes('open.er-api.com')) {
        return {
          data: {
            result: 'success',
            rates: { NGN: 1450.00 },
            time_last_update_unix: Date.now() / 1000
          }
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof axios.get;

    const secondaryOnlyRate = await fetcher.fetchRate();
    assert.equal(secondaryOnlyRate.rate, 1450.00);
    assert.equal(secondaryOnlyRate.source, 'Global FX API');
    console.log('✅ Test Case 4 passed');

  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
}

run().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
