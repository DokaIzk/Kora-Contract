import type { WalletNetwork } from './types';

export const STELLAR_NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
} as const;

const MAINNET_NAMES = new Set(['mainnet', 'public', 'pubnet', 'public network']);
const TESTNET_NAMES = new Set(['testnet', 'test network']);

export function normalizeWalletNetwork(
  network?: string | null,
  networkPassphrase?: string | null,
): WalletNetwork {
  // A passphrase is the network identity used for transaction hashing. Do not
  // trim it or fall back to a friendly name when a different one is supplied.
  if (networkPassphrase !== undefined && networkPassphrase !== null) {
    if (networkPassphrase === STELLAR_NETWORK_PASSPHRASES.mainnet) return 'mainnet';
    if (networkPassphrase === STELLAR_NETWORK_PASSPHRASES.testnet) return 'testnet';
    return 'unknown';
  }

  // Rabet supplies a name, not a passphrase. Accept only documented aliases;
  // names such as "private-testnet" are not evidence of a public network.
  const normalized = typeof network === 'string' ? network.trim().toLowerCase() : '';
  if (MAINNET_NAMES.has(normalized)) return 'mainnet';
  if (TESTNET_NAMES.has(normalized)) return 'testnet';
  return 'unknown';
}

export function isNetworkMismatch(
  walletNetwork: WalletNetwork,
  expectedNetwork: Exclude<WalletNetwork, 'unknown'>,
): boolean {
  return walletNetwork !== 'unknown' && walletNetwork !== expectedNetwork;
}