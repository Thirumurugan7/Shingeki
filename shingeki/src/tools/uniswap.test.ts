import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getUniswapQuote,
  buildUniswapSwap,
  checkUniswapApproval,
  type UniswapQuoteResult,
} from './uniswap.js';

// ── fetch mock helpers ────────────────────────────────────────────────────────

type FetchFn = typeof fetch;
let originalFetch: FetchFn;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  (globalThis as Record<string, unknown>)['fetch'] = handler as FetchFn;
}

function restoreFetch() {
  (globalThis as Record<string, unknown>)['fetch'] = originalFetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Uniswap tools', () => {
  before(() => {
    originalFetch = globalThis.fetch;
  });
  after(() => {
    restoreFetch();
    delete process.env['UNISWAP_API_KEY'];
  });

  it('getUniswapQuote throws when UNISWAP_API_KEY is missing', async () => {
    delete process.env['UNISWAP_API_KEY'];
    await assert.rejects(
      () =>
        getUniswapQuote({
          tokenIn: '0x0000000000000000000000000000000000000000',
          tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '10000000000000000',
          chainId: 1,
          swapper: '0x0000000000000000000000000000000000000001',
        }),
      (e: Error) => e.message.includes('UNISWAP_API_KEY not set'),
    );
  });

  it('getUniswapQuote maps response fields correctly', async () => {
    process.env['UNISWAP_API_KEY'] = 'test-key';

    const fakeQuoteResponse = {
      routing: 'CLASSIC',
      quote: {
        input: { amount: '10000000000000000', token: '0x0000000000000000000000000000000000000000' },
        output: { amount: '24500000', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
        gasFeeUSD: '3.50',
        priceImpact: 0.02,
        routeString: 'ETH → USDC (V3 0.05%)',
      },
    };

    mockFetch(async () => jsonResponse(fakeQuoteResponse));

    const result = await getUniswapQuote({
      tokenIn: '0x0000000000000000000000000000000000000000',
      tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount: '10000000000000000',
      chainId: 1,
      swapper: '0x1234567890123456789012345678901234567890',
    });

    assert.equal(result.routing, 'CLASSIC');
    assert.equal(result.tokenIn.amount, '10000000000000000');
    assert.equal(result.tokenOut.amount, '24500000');
    assert.equal(result.gasFeeUSD, '3.50');
    assert.equal(result.priceImpact, 0.02);
    assert.equal(result.routeString, 'ETH → USDC (V3 0.05%)');
    assert.deepEqual(result.rawQuote, fakeQuoteResponse);
  });

  it('getUniswapQuote throws when txFailureReasons is non-empty', async () => {
    process.env['UNISWAP_API_KEY'] = 'test-key';

    mockFetch(async () =>
      jsonResponse({
        routing: 'CLASSIC',
        txFailureReasons: ['INSUFFICIENT_LIQUIDITY', 'PRICE_IMPACT_TOO_HIGH'],
        quote: {},
      }),
    );

    await assert.rejects(
      () =>
        getUniswapQuote({
          tokenIn: '0x0000000000000000000000000000000000000000',
          tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '10000000000000000',
          chainId: 1,
          swapper: '0x0000000000000000000000000000000000000001',
        }),
      (e: Error) =>
        e.message.includes('INSUFFICIENT_LIQUIDITY') &&
        e.message.includes('PRICE_IMPACT_TOO_HIGH'),
    );
  });

  it('buildUniswapSwap throws on Dutch routing with clear message', async () => {
    const dutchQuote: UniswapQuoteResult = {
      routing: 'DUTCH_V2',
      tokenIn: { amount: '1', token: '0x0' },
      tokenOut: { amount: '1', token: '0x1' },
      gasFeeUSD: '0',
      priceImpact: 0,
      routeString: '',
      rawQuote: {},
    };

    await assert.rejects(
      () => buildUniswapSwap(dutchQuote),
      (e: Error) =>
        e.message.includes('Dutch order routing not supported in MVP') &&
        e.message.includes("protocols: ['V4','V3','V2']"),
    );

    // Also DUTCH_V3 and PRIORITY
    for (const routing of ['DUTCH_V3', 'PRIORITY']) {
      await assert.rejects(
        () => buildUniswapSwap({ ...dutchQuote, routing }),
        (e: Error) => e.message.includes('Dutch order routing not supported'),
      );
    }
  });

  it('buildUniswapSwap calls /swap and returns tx fields', async () => {
    process.env['UNISWAP_API_KEY'] = 'test-key';

    const fakeTx = {
      to: '0xRouter',
      data: '0xdeadbeef',
      value: '0',
      gasLimit: '200000',
    };

    let capturedUrl = '';
    let capturedBody: unknown;
    mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ transaction: fakeTx });
    });

    const quote: UniswapQuoteResult = {
      routing: 'CLASSIC',
      tokenIn: { amount: '1', token: '0x0' },
      tokenOut: { amount: '1', token: '0x1' },
      gasFeeUSD: '1',
      priceImpact: 0,
      routeString: '',
      rawQuote: { original: true },
    };

    const tx = await buildUniswapSwap(quote);

    assert.ok(capturedUrl.endsWith('/swap'));
    assert.deepEqual((capturedBody as Record<string, unknown>)['quote'], { original: true });
    assert.equal(tx.to, '0xRouter');
    assert.equal(tx.data, '0xdeadbeef');
    assert.equal(tx.gasLimit, '200000');
  });

  it('checkUniswapApproval returns null when approval is null', async () => {
    process.env['UNISWAP_API_KEY'] = 'test-key';
    mockFetch(async () => jsonResponse({ approval: null }));

    const result = await checkUniswapApproval(
      '0x0000000000000000000000000000000000000000',
      '10000000000000000',
      '0x1234',
      1,
    );
    assert.equal(result, null);
  });

  it('checkUniswapApproval sends x-api-key header', async () => {
    process.env['UNISWAP_API_KEY'] = 'my-key';
    let capturedHeaders: Record<string, string> = {};
    mockFetch(async (_, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return jsonResponse({ approval: { to: '0xT', data: '0xD', value: '0', gasLimit: '50000' } });
    });

    const tx = await checkUniswapApproval('0xToken', '1000', '0xWallet', 1);
    assert.equal(capturedHeaders['x-api-key'], 'my-key');
    assert.ok(tx !== null);
    assert.equal(tx!.to, '0xT');
    assert.equal(tx!.data, '0xD');
    assert.equal(tx!.value, '0');
    assert.equal(tx!.gasLimit, '50000');
  });

  it('getUniswapQuote throws on non-OK HTTP response', async () => {
    process.env['UNISWAP_API_KEY'] = 'test-key';
    mockFetch(async () =>
      jsonResponse({ errorCode: 'TOKEN_NOT_SUPPORTED', detail: 'unsupported token' }, 400),
    );
    await assert.rejects(
      () =>
        getUniswapQuote({
          tokenIn: '0x0000000000000000000000000000000000000000',
          tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: '10000000000000000',
          chainId: 1,
          swapper: '0x0000000000000000000000000000000000000001',
        }),
      (e: Error) => e.message.includes('400'),
    );
  });
});
