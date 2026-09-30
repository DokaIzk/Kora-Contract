/**
 * API Gateway — Query layer
 *
 * Stateless read layer over an `IndexedStore` (the indexer database in
 * production). Supports filtering, sorting, and cursor-based pagination for
 * large result sets (listings, positions). Every page carries
 * `lastIndexedLedger` so clients can reason about indexer lag. Rate limiting
 * is enforced per API key before any query runs.
 *
 * Write operations are intentionally absent: all writes remain on-chain.
 *
 * Issue #753
 */

import {
  FieldFilter,
  InvoiceFilter,
  InvoiceRecord,
  ListingFilter,
  ListingRecord,
  Page,
  PageArgs,
  PositionFilter,
  PositionRecord,
  RiskScoreFilter,
  RiskScoreRecord,
  SortDir,
} from "./types";
import { IndexedStore } from "./store";
import { RateLimiter } from "./rateLimiter";

export class RateLimitedError extends Error {
  constructor(public resetAfterMs: number) {
    super(`RATE_LIMITED: retry after ${resetAfterMs}ms`);
  }
}

function matches<T>(value: T, filter?: FieldFilter<T>): boolean {
  if (!filter) return true;
  if (filter.eq !== undefined && value !== filter.eq) return false;
  if (filter.in !== undefined && !filter.in.includes(value)) return false;
  if (filter.gte !== undefined && (value as unknown as number) < (filter.gte as unknown as number)) return false;
  if (filter.lte !== undefined && (value as unknown as number) > (filter.lte as unknown as number)) return false;
  return true;
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const n = Number(Buffer.from(cursor, "base64").toString("utf8"));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString("base64");
}

function paginate<T>(items: T[], args: PageArgs, lastIndexedLedger: number): Page<T> {
  const limit = Math.max(1, Math.min(100, args.limit ?? 20));
  const offset = decodeCursor(args.cursor);
  const data = items.slice(offset, offset + limit);
  const next = offset + data.length < items.length ? encodeCursor(offset + data.length) : null;
  return { data, nextCursor: next, lastIndexedLedger };
}

export interface QueryOptions {
  apiKey: string;
  sortBy?: string;
  sortDir?: SortDir;
}

function sortBy<T>(items: T[], key: string | undefined, dir: SortDir | undefined): T[] {
  if (!key) return items;
  const d = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key] as unknown as number | string;
    const bv = (b as Record<string, unknown>)[key] as unknown as number | string;
    if (av < bv) return -1 * d;
    if (av > bv) return 1 * d;
    return 0;
  });
}

export class ApiGateway {
  constructor(
    private store: IndexedStore,
    private limiter: RateLimiter = new RateLimiter(),
  ) {}

  private checkRateLimit(apiKey: string): void {
    const res = this.limiter.consume(apiKey);
    if (!res.allowed) throw new RateLimitedError(res.resetAfterMs);
  }

  queryInvoices(filter: InvoiceFilter = {}, page: PageArgs = {}, opts: QueryOptions): Page<InvoiceRecord> {
    this.checkRateLimit(opts.apiKey);
    const items = sortBy(
      this.store.invoices.filter(
        (i) =>
          matches(i.sme, filter.sme) &&
          matches(i.status, filter.status) &&
          matches(i.riskTier, filter.riskTier) &&
          matches(i.riskScore, filter.riskScore) &&
          matches(i.currency, filter.currency),
      ),
      opts.sortBy,
      opts.sortDir,
    );
    return paginate(items, page, this.store.lastIndexedLedger);
  }

  queryListings(filter: ListingFilter = {}, page: PageArgs = {}, opts: QueryOptions): Page<ListingRecord> {
    this.checkRateLimit(opts.apiKey);
    const items = sortBy(
      this.store.listings.filter(
        (l) =>
          matches(l.seller, filter.seller) &&
          matches(l.token, filter.token) &&
          (filter.isActive === undefined || l.isActive === filter.isActive),
      ),
      opts.sortBy,
      opts.sortDir,
    );
    return paginate(items, page, this.store.lastIndexedLedger);
  }

  queryPositions(filter: PositionFilter = {}, page: PageArgs = {}, opts: QueryOptions): Page<PositionRecord> {
    this.checkRateLimit(opts.apiKey);
    const items = sortBy(
      this.store.positions.filter(
        (p) => matches(p.investor, filter.investor) && matches(p.invoiceId, filter.invoiceId),
      ),
      opts.sortBy,
      opts.sortDir,
    );
    return paginate(items, page, this.store.lastIndexedLedger);
  }

  queryRiskScores(filter: RiskScoreFilter = {}, page: PageArgs = {}, opts: QueryOptions): Page<RiskScoreRecord> {
    this.checkRateLimit(opts.apiKey);
    const items = sortBy(
      this.store.riskScores.filter(
        (r) =>
          (filter.kind === undefined || r.kind === filter.kind) &&
          matches(r.verifier, filter.verifier) &&
          matches(r.score, filter.score),
      ),
      opts.sortBy,
      opts.sortDir,
    );
    return paginate(items, page, this.store.lastIndexedLedger);
  }
}
