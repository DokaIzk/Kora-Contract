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
  const passphrase = networkPassphrase?.trim();
  if (passphrase === STELLAR_NETWORK_PASSPHRASES.mainnet) return 'mainnet';
  if (passphrase === STELLAR_NETWORK_PASSPHRASES.testnet) return 'testnet';

  const normalized = network?.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (MAINNET_NAMES.has(normalized)) return 'mainnet';
  if (TESTNET_NAMES.has(normalized)) return 'testnet';
  if (normalized.includes('mainnet') || normalized.includes('public')) return 'mainnet';
  if (normalized.includes('testnet')) return 'testnet';
  return 'unknown';
}

export function isNetworkMismatch(
  walletNetwork: WalletNetwork,
  expectedNetwork: Exclude<WalletNetwork, 'unknown'>,
): boolean {
  return walletNetwork !== 'unknown' && walletNetwork !== expectedNetwork;
}