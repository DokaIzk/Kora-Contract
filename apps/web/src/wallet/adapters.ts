import {
  getAddress as freighterGetAddress,
  getNetwork as freighterGetNetwork,
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  WatchWalletChanges,
} from '@stellar/freighter-api';
import { normalizeWalletNetwork } from './network';
import type {
  WalletAdapter,
  WalletChangeListener,
  WalletSession,
} from './types';

interface ApiErrorLike {
  message?: string;
  error?: string;
}

interface FreighterWatcher {
  watch(
    callback: (value: {
      address: string;
      network: string;
      networkPassphrase: string;
      error?: ApiErrorLike;
    }) => void,
  ): { error?: ApiErrorLike };
  stop(): void;
}

interface FreighterApi {
  isConnected(): Promise<{ isConnected: boolean; error?: ApiErrorLike }>;
  requestAccess(): Promise<{ address: string; error?: ApiErrorLike }>;
  getAddress(): Promise<{ address: string; error?: ApiErrorLike }>;
  getNetwork(): Promise<{
    network: string;
    networkPassphrase: string;
    error?: ApiErrorLike;
  }>;
  WatchWalletChanges?: new (timeout?: number) => FreighterWatcher;
}

interface RabetConnectResult {
  publicKey?: string;
  address?: string;
  error?: string;
}

interface RabetApi {
  connect(): Promise<RabetConnectResult | string>;
  disconnect(): Promise<void>;
  getNetwork(): Promise<string | { network?: string; error?: string }>;
  on(
    event: 'accountChanged' | 'networkChanged',
    callback: (network?: string) => void,
  ): void;
  off?(
    event: 'accountChanged' | 'networkChanged',
    callback: (network?: string) => void,
  ): void;
}

type FreighterProviderFactory = () => FreighterApi | undefined;
type RabetProviderFactory = () => RabetApi | undefined;

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const candidate = error as ApiErrorLike;
    if (candidate.message) return candidate.message;
    if (candidate.error) return candidate.error;
  }
  return fallback;
}

function assertApiResult(error: ApiErrorLike | undefined, fallback: string): void {
  if (error) throw new Error(errorMessage(error, fallback));
}

const OFFICIAL_FREIGHTER_API: FreighterApi = {
  isConnected: freighterIsConnected,
  requestAccess: freighterRequestAccess,
  getAddress: freighterGetAddress,
  getNetwork: freighterGetNetwork,
  WatchWalletChanges: WatchWalletChanges as unknown as new (
    timeout?: number,
  ) => FreighterWatcher,
};

function defaultFreighterProvider(): FreighterApi | undefined {
  return typeof window === 'undefined' ? undefined : OFFICIAL_FREIGHTER_API;
}

function defaultRabetProvider(): RabetApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { rabet?: RabetApi }).rabet;
}

export class FreighterWalletAdapter implements WalletAdapter {
  readonly id = 'freighter' as const;
  readonly label = 'Freighter';
  readonly installUrl = 'https://www.freighter.app/';

  constructor(
    private readonly providerFactory: FreighterProviderFactory = defaultFreighterProvider,
    private readonly watchIntervalMs = 1_000,
  ) {}

  async isInstalled(): Promise<boolean> {
    const api = this.providerFactory();
    if (!api) return false;
    try {
      const result = await api.isConnected();
      return Boolean(result.isConnected && !result.error);
    } catch {
      return false;
    }
  }

  async connect(): Promise<WalletSession> {
    const api = this.providerFactory();
    if (!api || !(await this.isInstalled())) {
      throw new Error('Freighter is not installed or unavailable.');
    }

    const access = await api.requestAccess();
    assertApiResult(access.error, 'Freighter access was rejected.');
    if (!access.address) {
      throw new Error('Freighter returned an empty account address.');
    }

    const network = await api.getNetwork();
    assertApiResult(network.error, 'Unable to read the Freighter network.');

    return {
      address: access.address,
      network: normalizeWalletNetwork(network.network, network.networkPassphrase),
      networkPassphrase: network.networkPassphrase,
    };
  }

  async restore(): Promise<WalletSession | null> {
    const api = this.providerFactory();
    if (!api || !(await this.isInstalled())) return null;

    try {
      const [address, network] = await Promise.all([
        api.getAddress(),
        api.getNetwork(),
      ]);
      if (address.error || network.error || !address.address) return null;
      return {
        address: address.address,
        network: normalizeWalletNetwork(network.network, network.networkPassphrase),
        networkPassphrase: network.networkPassphrase,
      };
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    // Freighter does not expose a dapp-side revoke/disconnect method.
    // Kora clears only its local session; wallet authorization remains user-owned.
  }

  subscribe(listener: WalletChangeListener): () => void {
    const api = this.providerFactory();
    if (!api) return () => undefined;

    if (api.WatchWalletChanges) {
      const watcher = new api.WatchWalletChanges(this.watchIntervalMs);
      let active = true;
      try {
        const result = watcher.watch(({ address, network, networkPassphrase, error }) => {
          if (!active) return;
          if (error || !address) {
            listener(null);
            return;
          }
          listener({
            address,
            network: normalizeWalletNetwork(network, networkPassphrase),
            networkPassphrase,
          });
        });
        assertApiResult(result.error, 'Freighter change monitoring failed.');
      } catch (error) {
        active = false;
        try { watcher.stop(); } catch { /* preserve the initialization error */ }
        throw error;
      }
      return () => {
        if (!active) return;
        active = false;
        watcher.stop();
      };
    }

    let active = true;
    let inFlight = false;
    let lastSignature: string | undefined;
    const poll = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const connection = await this.restore();
        if (!active) return;
        const signature = connection
          ? [connection.address, connection.network, connection.networkPassphrase ?? ''].join(':')
          : '';
        if (signature !== lastSignature) {
          lastSignature = signature;
          listener(connection);
        }
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), this.watchIntervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }
}

export class RabetWalletAdapter implements WalletAdapter {
  readonly id = 'rabet' as const;
  readonly label = 'Rabet';
  readonly installUrl = 'https://rabet.io/';

  private address: string | null = null;
  private network = 'unknown';

  constructor(
    private readonly providerFactory: RabetProviderFactory = defaultRabetProvider,
  ) {}

  async isInstalled(): Promise<boolean> {
    return Boolean(this.providerFactory());
  }

  async connect(): Promise<WalletSession> {
    const api = this.providerFactory();
    if (!api) throw new Error('Rabet is not installed or unavailable.');

    const result = await api.connect();
    const publicKey =
      typeof result === 'string'
        ? result
        : result.publicKey ?? result.address ?? '';

    if (typeof result !== 'string' && result.error) {
      throw new Error(result.error);
    }
    if (!publicKey) {
      throw new Error('Rabet returned an empty account address.');
    }

    const networkResult = await api.getNetwork();
    const networkName =
      typeof networkResult === 'string'
        ? networkResult
        : networkResult.network ?? '';

    if (typeof networkResult !== 'string' && networkResult.error) {
      throw new Error(networkResult.error);
    }

    this.address = publicKey;
    this.network = networkName;

    return {
      address: publicKey,
      network: normalizeWalletNetwork(networkName),
    };
  }

  async restore(): Promise<WalletSession | null> {
    // Rabet recommends connect() only after explicit user action.
    // Persist the wallet choice, never silently open a connection prompt.
    return null;
  }

  async disconnect(): Promise<void> {
    const api = this.providerFactory();
    this.address = null;
    this.network = 'unknown';
    await api?.disconnect();
  }

  subscribe(listener: WalletChangeListener): () => void {
    const api = this.providerFactory();
    if (!api) return () => undefined;

    let active = true;
    let refreshId = 0;
    let networkRevision = 0;

    const accountChanged = () => {
      if (!active) return;
      const requestId = ++refreshId;
      void (async () => {
        try {
          const result = await api.connect();
          if (!active || requestId !== refreshId) return;
          if (typeof result !== 'string' && result.error) throw new Error(result.error);
          const publicKey = typeof result === 'string'
            ? result
            : result.publicKey ?? result.address ?? '';
          if (!publicKey) {
            this.address = null;
            listener(null);
            return;
          }

          const revision = networkRevision;
          const networkResult = await api.getNetwork();
          if (!active || requestId !== refreshId) return;
          if (typeof networkResult !== 'string' && networkResult.error) {
            throw new Error(networkResult.error);
          }
          // A networkChanged event after this request started is newer evidence.
          const networkName = revision === networkRevision
            ? (typeof networkResult === 'string' ? networkResult : networkResult.network ?? '')
            : this.network;

          this.address = publicKey;
          this.network = networkName;
          listener({ address: publicKey, network: normalizeWalletNetwork(networkName) });
        } catch {
          if (!active || requestId !== refreshId) return;
          this.address = null;
          this.network = 'unknown';
          listener(null);
        }
      })();
    };

    const networkChanged = (network?: string) => {
      if (!active) return;
      ++networkRevision;
      this.network = network ?? 'unknown';
      if (!this.address) return;
      listener({
        address: this.address,
        network: normalizeWalletNetwork(this.network),
      });
    };

    const stop = () => {
      if (!active) return;
      active = false;
      ++refreshId;
      try { api.off?.('accountChanged', accountChanged); } catch { /* local guard remains closed */ }
      try { api.off?.('networkChanged', networkChanged); } catch { /* release the other handler independently */ }
    };
    try {
      api.on('accountChanged', accountChanged);
      api.on('networkChanged', networkChanged);
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  }
}