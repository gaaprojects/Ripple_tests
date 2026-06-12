import type { RouteResult } from "@fx/shared";
import type { Client } from "xrpl";
import { xrplClient } from "./xrpl/client.js";

/** An XRPL amount: drops string (XRP) or an issued-currency object. */
export type XrplAmount = string | { currency: string; issuer: string; value: string };

export interface SourceCurrency {
  currency: string;
  issuer?: string; // omitted for XRP
}

export interface FindRouteParams {
  source: string; // sender classic address
  destination: string; // beneficiary classic address
  destinationAmount: XrplAmount; // exact delivered amount (no partial payments)
  slippageTolerance?: number; // default 0.5%
  /** Restrict which source currencies path_find may use (e.g. force RLUSD as the funding asset). */
  sourceCurrencies?: SourceCurrency[];
  /**
   * Bridge currency (e.g. XRP) to fall back to when the direct legacy pathfinder finds no route.
   * The legacy `ripple_path_find` won't synthesize a 2-hop AMM bridge (RLUSD→XRP→EUD), so we
   * quote it as two single-hop legs it CAN compute and attach an explicit `[[{currency:XRP}]]` path.
   */
  bridgeVia?: SourceCurrency;
}

export interface RouteQuote {
  /** Schema-validated result for the gate + audit (numeric, currency-agnostic). */
  result: RouteResult;
  /** The chosen source cost, in its actual currency (XRP drops string or IOU object). */
  sourceAmount: XrplAmount;
  /** sourceAmount × (1 + slippage), in the same currency — feed straight to the executor's SendMax. */
  sendMaxAmount: XrplAmount;
  /** paths_computed of the chosen alternative (executor's Payment.Paths). */
  paths: Record<string, unknown>[];
}

function isXrp(a: XrplAmount): a is string {
  return typeof a === "string";
}
function amountValue(a: XrplAmount): number {
  return isXrp(a) ? Number(a) / 1_000_000 : Number(a.value);
}

/** Apply slippage and return a same-currency amount suitable for SendMax. */
function withSlippage(a: XrplAmount, slippage: number): XrplAmount {
  if (isXrp(a)) {
    const drops = Math.ceil(Number(a) * (1 + slippage));
    return String(drops);
  }
  return { ...a, value: (Number(a.value) * (1 + slippage)).toFixed(6) };
}

interface Alt {
  source_amount: unknown;
  paths_computed?: unknown[];
}

/** One ripple_path_find call. Returns alternatives (empty on error or dry route). */
async function pathFind(
  client: Client,
  source: string,
  destination: string,
  destinationAmount: XrplAmount,
  sourceCurrencies?: SourceCurrency[],
): Promise<Alt[]> {
  const req: Record<string, unknown> = {
    command: "ripple_path_find",
    source_account: source,
    destination_account: destination,
    destination_amount: destinationAmount,
  };
  if (sourceCurrencies) req.source_currencies = sourceCurrencies;
  try {
    const resp = (await client.request(req as never)) as {
      result: { alternatives?: Alt[] };
    };
    return resp.result.alternatives ?? [];
  } catch {
    return [];
  }
}

function cheapest(alts: Alt[]): Alt {
  return alts.reduce((a, b) =>
    amountValue(a.source_amount as XrplAmount) <= amountValue(b.source_amount as XrplAmount) ? a : b,
  );
}

/**
 * Routing service (SPEC §5.6). Quotes cross-currency delivery via ripple_path_find, picks the
 * cheapest source cost, and bounds it with SendMax = quote × (1 + slippage) in the SOURCE
 * currency. NEVER partial: exact Amount, bounded SendMax, no tfPartialPayment. no_route when dry.
 *
 * When the direct pathfinder is dry but `bridgeVia` is set, fall back to a 2-leg bridge quote
 * (source→bridge, bridge→destination) with an explicit bridge path the transactor can execute.
 */
export async function findRoute(params: FindRouteParams): Promise<RouteQuote> {
  const slippage = params.slippageTolerance ?? 0.005;
  const client = await xrplClient();
  const now = new Date().toISOString();

  const alts = await pathFind(
    client,
    params.source,
    params.destination,
    params.destinationAmount,
    params.sourceCurrencies,
  );

  if (alts.length) {
    const best = cheapest(alts);
    const sourceAmount = best.source_amount as XrplAmount;
    const sendMaxAmount = withSlippage(sourceAmount, slippage);
    const paths = (best.paths_computed ?? []) as Record<string, unknown>[];
    const result: RouteResult = {
      paths: alts.map((a) => ({ steps: (a.paths_computed ?? []) as Record<string, unknown>[] })),
      quoted_cost: amountValue(sourceAmount),
      send_max: amountValue(sendMaxAmount),
      slippage_tolerance: slippage,
      pool_snapshot: {
        alternatives: alts.length,
        source_currency: isXrp(sourceAmount) ? "XRP" : sourceAmount.currency,
        bridged: false,
      },
      no_route: false,
      degraded: false,
      checked_at: now,
    };
    return { result, sourceAmount, sendMaxAmount, paths };
  }

  // Direct route dry — try the 2-leg bridge fallback if a bridge currency was provided and the
  // source is restricted to a single IOU funding asset.
  const src = params.sourceCurrencies?.length === 1 ? params.sourceCurrencies[0] : undefined;
  if (params.bridgeVia && src && src.issuer) {
    const bridged = await quoteBridge(client, params, src, params.bridgeVia, slippage, now);
    if (bridged) return bridged;
  }

  return emptyQuote(slippage, now);
}

/**
 * Two-leg bridge quote: source IOU → bridge currency → destination. Each leg is a single-hop
 * swap the legacy pathfinder can compute; we then attach the explicit `[[{currency:bridge}]]`
 * path so the transactor executes the full RLUSD→XRP→EUD route.
 */
async function quoteBridge(
  client: Client,
  params: FindRouteParams,
  src: SourceCurrency,
  bridge: SourceCurrency,
  slippage: number,
  now: string,
): Promise<RouteQuote | null> {
  // Leg A: how much bridge currency delivers the exact destination amount?
  const legA = await pathFind(client, params.source, params.destination, params.destinationAmount, [
    bridge,
  ]);
  if (!legA.length) return null;
  const bridgeAmount = cheapest(legA).source_amount as XrplAmount;

  // Leg B: how much source IOU delivers that bridge amount (self-quote on the source account)?
  const legB = await pathFind(client, params.source, params.source, bridgeAmount, [src]);
  if (!legB.length) return null;
  const sourceAmount = cheapest(legB).source_amount as XrplAmount;

  const sendMaxAmount = withSlippage(sourceAmount, slippage);
  const bridgeStep: Record<string, unknown> = { currency: bridge.currency };
  if (bridge.issuer) bridgeStep.issuer = bridge.issuer;
  const paths = [[bridgeStep]] as unknown as Record<string, unknown>[];

  const result: RouteResult = {
    paths: [{ steps: [bridgeStep] }],
    quoted_cost: amountValue(sourceAmount),
    send_max: amountValue(sendMaxAmount),
    slippage_tolerance: slippage,
    pool_snapshot: {
      alternatives: 1,
      source_currency: isXrp(sourceAmount) ? "XRP" : sourceAmount.currency,
      bridged: true,
      bridge_currency: bridge.currency,
      bridge_amount: amountValue(bridgeAmount),
    },
    no_route: false,
    degraded: false,
    checked_at: now,
  };
  return { result, sourceAmount, sendMaxAmount, paths };
}

function emptyQuote(slippage: number, now: string): RouteQuote {
  return {
    result: {
      paths: [],
      quoted_cost: 0,
      send_max: 0,
      slippage_tolerance: slippage,
      no_route: true,
      degraded: false,
      checked_at: now,
    },
    sourceAmount: "0",
    sendMaxAmount: "0",
    paths: [],
  };
}
