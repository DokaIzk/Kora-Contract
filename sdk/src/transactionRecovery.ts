import { xdr } from "@stellar/stellar-sdk";

export type TransactionReconciliation =
  | { hash: string; status: "not_found" }
  | { hash: string; status: "success"; returnValue: xdr.ScVal | undefined }
  | { hash: string; status: "failed" };

export class TransactionOutcomeUnknownError extends Error {
  readonly hash: string;
  readonly originalError: unknown;

  constructor(hash: string, originalError?: unknown) {
    super(`Transaction ${hash} was submitted, but its outcome could not be confirmed`);
    this.name = "TransactionOutcomeUnknownError";
    this.hash = hash;
    this.originalError = originalError;
  }
}

export function classifyTransaction(
  hash: string,
  status: string,
  returnValue?: xdr.ScVal
): TransactionReconciliation {
  if (status === "NOT_FOUND") return { hash, status: "not_found" };
  if (status === "SUCCESS") return { hash, status: "success", returnValue };
  return { hash, status: "failed" };
}

export async function withUnknownOutcome<T>(
  hash: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TransactionOutcomeUnknownError) throw error;
    throw new TransactionOutcomeUnknownError(hash, error);
  }
}