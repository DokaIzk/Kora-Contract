/**
 * FX Ingestion Service — Entry Point
 * Issue #766
 */

import * as dotenv from "dotenv";
import { ExchangeRateApiSource, CurrencyApiSource } from "./sources";
import { CrossChecker } from "./crosscheck";
import { OracleRelay } from "./relay";
import { IngestionEngine } from "./engine";
import { FxIngestionConfig, CurrencyCode } from "./types";
import pino from "pino";

dotenv.config();

const logger = pino({ name: "fx-ingestion" });

function loadConfig(): FxIngestionConfig {
  const currencies = (process.env.FX_CURRENCIES ?? "NGN,KES,GHS,ZAR,TZS,UGX,XOF,EGP")
    .split(",")
    .map((c) => c.trim() as CurrencyCode);

  return {
    currencies,
    quoteCurrency: (process.env.FX_QUOTE_CURRENCY ?? "USDC") as CurrencyCode,
    maxDivergenceBps: Number(process.env.FX_MAX_DIVERGENCE_BPS ?? "200"),
    pollIntervalMs: Number(process.env.FX_POLL_INTERVAL_MS ?? "300000"),
    oracleContractAddress: process.env.ORACLE_CONTRACT_ADDRESS ?? "",
    relaySecret: process.env.FX_RELAY_SECRET ?? "",
    rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    maxStalenessSeconds: Number(process.env.FX_MAX_STALENESS_SECONDS ?? "3600"),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.relaySecret) {
    logger.error("FX_RELAY_SECRET is required");
    process.exit(1);
  }
  if (!config.oracleContractAddress) {
    logger.error("ORACLE_CONTRACT_ADDRESS is required");
    process.exit(1);
  }

  const sources = [
    new ExchangeRateApiSource(process.env.EXCHANGE_RATE_API_KEY ?? ""),
    new CurrencyApiSource(process.env.CURRENCY_API_KEY ?? ""),
  ];

  const checker = new CrossChecker(sources, config.maxDivergenceBps);
  const relay = new OracleRelay(config);
  const engine = new IngestionEngine(checker, relay, config);

  engine.start();

  const shutdown = (): void => {
    logger.info("Shutting down FX ingestion service…");
    engine.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error(err, "FX ingestion service crashed");
  process.exit(1);
});
