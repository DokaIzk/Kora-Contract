/**
 * In-memory KYB application store.
 *
 * In production this is replaced by a database (Postgres / DynamoDB).
 * The interface is extracted so the service layer does not depend on a
 * specific storage backend.
 *
 * Issue: #762
 */

import { KybApplication, KybStatus } from "./types";

export interface KybStore {
  save(app: KybApplication): Promise<void>;
  findById(id: string): Promise<KybApplication | undefined>;
  findBySmeAddress(smeAddress: string): Promise<KybApplication[]>;
  findByStatus(status: KybStatus): Promise<KybApplication[]>;
  /** Returns all applications awaiting review, ordered oldest-first. */
  findPendingQueue(): Promise<KybApplication[]>;
}

/** Simple in-memory implementation for unit tests and local development. */
export class InMemoryKybStore implements KybStore {
  private readonly _store = new Map<string, KybApplication>();

  async save(app: KybApplication): Promise<void> {
    this._store.set(app.id, { ...app });
  }

  async findById(id: string): Promise<KybApplication | undefined> {
    const entry = this._store.get(id);
    return entry ? { ...entry } : undefined;
  }

  async findBySmeAddress(smeAddress: string): Promise<KybApplication[]> {
    return Array.from(this._store.values()).filter((a) => a.smeAddress === smeAddress);
  }

  async findByStatus(status: KybStatus): Promise<KybApplication[]> {
    return Array.from(this._store.values()).filter((a) => a.status === status);
  }

  async findPendingQueue(): Promise<KybApplication[]> {
    return (await this.findByStatus("pending")).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
  }
}
