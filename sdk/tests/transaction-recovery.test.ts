import { Account, Keypair, Networks, rpc, StrKey, xdr } from "@stellar/stellar-sdk";
import { BaseClient } from "../src/base";
import {
  classifyTransaction,
  TransactionOutcomeUnknownError,
  withUnknownOutcome,
} from "../src/transactionRecovery";

class TestClient extends BaseClient {
  constructor() {
    super(StrKey.encodeContract(Buffer.alloc(32)), {
      rpcUrl: "https://example.test",
      networkPassphrase: Networks.TESTNET,
    });
  }

  setServer(server: unknown): void {
    this.server = server as rpc.Server;
  }

  submit(keypair: Keypair, retries: number): Promise<xdr.ScVal> {
    return this.invoke("change", [], keypair, { retries });
  }
}

describe("transaction recovery", () => {
  const hash = "transaction-hash";

  it("does not treat an unindexed transaction as success or failure", () => {
    expect(classifyTransaction(hash, "NOT_FOUND")).toEqual({ hash, status: "not_found" });
  });

  it("returns the confirmed successful result", () => {
    const returnValue = xdr.ScVal.scvVoid();
    expect(classifyTransaction(hash, "SUCCESS", returnValue)).toEqual({
      hash,
      status: "success",
      returnValue,
    });
  });

  it("returns a confirmed failed result", () => {
    expect(classifyTransaction(hash, "FAILED")).toEqual({ hash, status: "failed" });
  });

  it("returns successful operation values unchanged", async () => {
    await expect(withUnknownOutcome(hash, async () => "submitted")).resolves.toBe("submitted");
  });

  it("retains the hash and cause after an ambiguous submission error", async () => {
    const cause = new Error("connection dropped");
    await expect(withUnknownOutcome(hash, async () => Promise.reject(cause))).rejects.toMatchObject({
      name: "TransactionOutcomeUnknownError",
      hash,
      originalError: cause,
    });
  });

  it("preserves an existing unknown-outcome error", async () => {
    const error = new TransactionOutcomeUnknownError(hash);
    await expect(withUnknownOutcome(hash, async () => Promise.reject(error))).rejects.toBe(error);
  });

  it("does not retry an ambiguous submission and reconciles it after reconnect", async () => {
    const keypair = Keypair.random();
    const transactionHash = "ab".repeat(32);
    const server = {
      getAccount: jest.fn().mockResolvedValue(new Account(keypair.publicKey(), "0")),
      prepareTransaction: jest.fn().mockResolvedValue({
        sign: jest.fn(),
        hash: () => Buffer.from(transactionHash, "hex"),
      }),
      sendTransaction: jest.fn().mockRejectedValue(new Error("connection dropped")),
      getTransaction: jest.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: xdr.ScVal.scvVoid(),
      }),
    };
    const client = new TestClient();
    client.setServer(server);

    let submissionError: unknown;
    try {
      await client.submit(keypair, 2);
    } catch (error) {
      submissionError = error;
    }

    expect(submissionError).toBeInstanceOf(TransactionOutcomeUnknownError);
    expect((submissionError as TransactionOutcomeUnknownError).hash).toBe(transactionHash);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    await expect(client.reconcileTransaction(transactionHash)).resolves.toEqual({
      hash: transactionHash,
      status: "success",
      returnValue: xdr.ScVal.scvVoid(),
    });
  });
});