/**
 * Uniswap Trade API integration — quote, swap tx builder, approval check.
 * Docs: https://developers.uniswap.org/v4/reference/trade-api
 */

const UNISWAP_BASE = 'https://trade-api.gateway.uniswap.org/v1';

function getApiKey(): string {
  const key = (process.env.UNISWAP_API_KEY ?? process.env.UNISWAP_APIKEY)?.trim();
  if (!key) {
    throw new Error(
      'UNISWAP_API_KEY not set — get one from developers.uniswap.org/dashboard',
    );
  }
  return key;
}

export interface UniswapQuoteParams {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  chainId: number;
  swapper: string;
  slippageTolerance?: number;
}

export interface UniswapQuoteResult {
  routing: string;
  tokenIn: { amount: string; token: string };
  tokenOut: { amount: string; token: string };
  gasFeeUSD: string;
  priceImpact: number;
  routeString: string;
  permitData?: unknown;
  rawQuote: unknown;
}

export interface UniswapSwapTx {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
}

const DUTCH_ROUTINGS = new Set(['DUTCH_V2', 'DUTCH_V3', 'PRIORITY']);

export async function getUniswapQuote(params: UniswapQuoteParams): Promise<UniswapQuoteResult> {
  const apiKey = getApiKey();

  const body = {
    type: 'EXACT_INPUT',
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    tokenInChainId: params.chainId,
    tokenOutChainId: params.chainId,
    amount: params.amount,
    swapper: params.swapper,
    slippageTolerance: params.slippageTolerance ?? 0.5,
    routingPreference: 'BEST_PRICE',
    protocols: ['UNISWAPX_V2', 'V4', 'V3', 'V2'],
  };

  const res = await fetch(`${UNISWAP_BASE}/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(
      `Uniswap /quote failed (${res.status}): ${JSON.stringify(data)}`,
    );
  }

  const reasons = data['txFailureReasons'] as string[] | undefined;
  if (reasons && reasons.length > 0) {
    throw new Error(`Uniswap quote has txFailureReasons: ${reasons.join(', ')}`);
  }

  const quote = data['quote'] as Record<string, unknown> | undefined;

  return {
    routing: String(data['routing'] ?? ''),
    tokenIn: {
      amount: String((quote?.['input'] as Record<string, unknown>)?.['amount'] ?? ''),
      token: String((quote?.['input'] as Record<string, unknown>)?.['token'] ?? params.tokenIn),
    },
    tokenOut: {
      amount: String((quote?.['output'] as Record<string, unknown>)?.['amount'] ?? ''),
      token: String((quote?.['output'] as Record<string, unknown>)?.['token'] ?? params.tokenOut),
    },
    gasFeeUSD: String(quote?.['gasFeeUSD'] ?? '0'),
    priceImpact: Number(quote?.['priceImpact'] ?? 0),
    routeString: String(quote?.['routeString'] ?? ''),
    permitData: data['permitData'],
    rawQuote: data,
  };
}

export async function buildUniswapSwap(quoteResult: UniswapQuoteResult): Promise<UniswapSwapTx> {
  if (DUTCH_ROUTINGS.has(quoteResult.routing)) {
    throw new Error(
      `Dutch order routing not supported in MVP — use CLASSIC routing by setting protocols: ['V4','V3','V2']`,
    );
  }

  const apiKey = getApiKey();

  const res = await fetch(`${UNISWAP_BASE}/swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ quote: quoteResult.rawQuote }),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(`Uniswap /swap failed (${res.status}): ${JSON.stringify(data)}`);
  }

  const tx = data['transaction'] as Record<string, unknown>;
  return {
    to: String(tx['to'] ?? ''),
    data: String(tx['data'] ?? ''),
    value: String(tx['value'] ?? '0'),
    gasLimit: String(tx['gasLimit'] ?? '0'),
  };
}

export async function checkUniswapApproval(
  token: string,
  amount: string,
  walletAddress: string,
  chainId: number,
): Promise<UniswapSwapTx | null> {
  const apiKey = getApiKey();

  const res = await fetch(`${UNISWAP_BASE}/check_approval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ token, amount, walletAddress, chainId }),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(
      `Uniswap /check_approval failed (${res.status}): ${JSON.stringify(data)}`,
    );
  }

  const approval = data['approval'] as Record<string, unknown> | null | undefined;
  if (!approval) return null;

  return {
    to: String(approval['to'] ?? ''),
    data: String(approval['data'] ?? ''),
    value: String(approval['value'] ?? '0'),
    gasLimit: String(approval['gasLimit'] ?? '0'),
  };
}
