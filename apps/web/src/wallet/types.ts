export type WalletId = 'freighter' | 'rabet';
export type WalletNetwork = 'testnet' | 'mainnet' | 'unknown';

export type WalletStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'network-mismatch'
  | 'install-required'
  | 'error';

export interface WalletSession {
  address: string;
  network: WalletNetwork;
  networkPassphrase?: string;
}

export interface WalletState {
  status: WalletStatus;
  walletId: WalletId | null;
  address: string | null;
  walletNetwork: WalletNetwork;
  expectedNetwork: Exclude<WalletNetwork, 'unknown'>;
  error?: string;
  installUrl?: string;
}

export interface WalletOption {
  id: WalletId;
  label: string;
  installUrl: string;
}

export type WalletChangeListener = (connection: WalletSession | null) => void;

export interface WalletAdapter extends WalletOption {
  isInstalled(): Promise<boolean>;
  connect(): Promise<WalletSession>;
  restore(): Promise<WalletSession | null>;
  disconnect(): Promise<void>;
  subscribe(listener: WalletChangeListener): () => void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}