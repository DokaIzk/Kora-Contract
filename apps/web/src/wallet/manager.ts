import { isNetworkMismatch } from './network';
import { FreighterWalletAdapter, RabetWalletAdapter } from './adapters';
import type {
  StorageLike,
  WalletAdapter,
  WalletSession,
  WalletId,
  WalletNetwork,
  WalletOption,
  WalletState,
} from './types';

export const LAST_WALLET_STORAGE_KEY = 'kora:last-wallet';

const DEFAULT_STATE: WalletState = {
  status: 'disconnected',
  walletId: null,
  address: null,
  walletNetwork: 'unknown',
  expectedNetwork: 'testnet',
};

function browserStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readLastWallet(storage?: StorageLike): WalletId | null {
  try {
    const value = storage?.getItem(LAST_WALLET_STORAGE_KEY);
    return value === 'freighter' || value === 'rabet' ? value : null;
  } catch {
    return null;
  }
}

function persistLastWallet(
  storage: StorageLike | undefined,
  walletId: WalletId | null,
): void {
  try {
    if (!storage) return;
    if (walletId) storage.setItem(LAST_WALLET_STORAGE_KEY, walletId);
    else storage.removeItem(LAST_WALLET_STORAGE_KEY);
  } catch {
    // Wallet state must remain usable when localStorage is blocked.
  }
}

export class WalletManager {
  private readonly adapters = new Map<WalletId, WalletAdapter>();
  private readonly listeners = new Set<(state: WalletState) => void>();
  private state: WalletState;
  private unsubscribeAdapter?: () => void;
  private operation = 0;

  constructor(
    adapters: WalletAdapter[] = [
      new FreighterWalletAdapter(),
      new RabetWalletAdapter(),
    ],
    expectedNetwork: Exclude<WalletNetwork, 'unknown'> = 'testnet',
    private readonly storage: StorageLike | undefined = browserStorage(),
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter);
    this.state = {
      ...DEFAULT_STATE,
      expectedNetwork,
      walletId: readLastWallet(storage),
    };
  }

  getState(): WalletState {
    return { ...this.state };
  }

  getWalletOptions(): WalletOption[] {
    return [...this.adapters.values()].map(({ id, label, installUrl }) => ({
      id,
      label,
      installUrl,
    }));
  }

  subscribe(listener: (state: WalletState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setExpectedNetwork(
    expectedNetwork: Exclude<WalletNetwork, 'unknown'>,
  ): void {
    if (this.state.expectedNetwork === expectedNetwork) return;

    this.state = { ...this.state, expectedNetwork };
    if (this.state.address && this.state.walletNetwork !== 'unknown') {
      this.state.status = isNetworkMismatch(
        this.state.walletNetwork,
        expectedNetwork,
      )
        ? 'network-mismatch'
        : 'connected';
    }
    this.emit();
  }

  async connect(walletId: WalletId): Promise<WalletState> {
    const token = ++this.operation;
    this.stopAdapterSubscription();

    const adapter = this.adapters.get(walletId);
    if (!adapter) {
      this.setState({
        status: 'error',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error: 'Unsupported wallet: ' + walletId,
      });
      return this.getState();
    }

    this.setState({
      status: 'connecting',
      walletId,
      address: null,
      walletNetwork: 'unknown',
      error: undefined,
      installUrl: undefined,
    });

    let installed: boolean;
    try {
      installed = await adapter.isInstalled();
    } catch (error) {
      if (token !== this.operation) return this.getState();
      this.setState({
        status: 'error',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error:
          error instanceof Error
            ? error.message
            : 'Wallet availability check failed.',
      });
      return this.getState();
    }

    if (!installed) {
      if (token !== this.operation) return this.getState();

      this.setState({
        status: 'install-required',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error: adapter.label + ' is not installed.',
        installUrl: adapter.installUrl,
      });
      return this.getState();
    }

    try {
      const connection = await adapter.connect();
      if (token !== this.operation) return this.getState();

      this.applyConnection(walletId, connection);
      if (
        this.state.status === 'connected' ||
        this.state.status === 'network-mismatch'
      ) {
        persistLastWallet(this.storage, walletId);
        this.startAdapterSubscription(adapter);
      }
    } catch (error) {
      if (token !== this.operation) return this.getState();

      this.setState({
        status: 'error',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error:
          error instanceof Error
            ? error.message
            : 'Wallet connection failed.',
      });
    }

    return this.getState();
  }

  async reconnectLastUsed(): Promise<WalletState> {
    const walletId = readLastWallet(this.storage);
    if (!walletId) return this.getState();

    const adapter = this.adapters.get(walletId);
    if (!adapter) return this.getState();

    const token = ++this.operation;
    this.stopAdapterSubscription();

    let installed: boolean;
    try {
      installed = await adapter.isInstalled();
    } catch (error) {
      if (token !== this.operation) return this.getState();
      this.setState({
        status: 'error',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error:
          error instanceof Error
            ? error.message
            : 'Wallet availability check failed.',
      });
      return this.getState();
    }

    if (!installed) {
      if (token !== this.operation) return this.getState();

      this.setState({
        status: 'install-required',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error: adapter.label + ' is not installed.',
        installUrl: adapter.installUrl,
      });
      return this.getState();
    }

    let restored: WalletSession | null;
    try {
      restored = await adapter.restore();
    } catch (error) {
      if (token !== this.operation) return this.getState();
      this.setState({
        status: 'error',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error:
          error instanceof Error
            ? error.message
            : 'Wallet session restore failed.',
      });
      return this.getState();
    }
    if (token !== this.operation) return this.getState();

    if (!restored) {
      this.setState({
        status: 'disconnected',
        walletId,
        address: null,
        walletNetwork: 'unknown',
        error: undefined,
        installUrl: undefined,
      });
      return this.getState();
    }

    this.applyConnection(walletId, restored);
    if (
      this.state.status === 'connected' ||
      this.state.status === 'network-mismatch'
    ) {
      this.startAdapterSubscription(adapter);
    }
    return this.getState();
  }

  async disconnect(): Promise<void> {
    ++this.operation;
    const adapter =
      this.state.walletId === null
        ? undefined
        : this.adapters.get(this.state.walletId);

    this.stopAdapterSubscription();

    try {
      await adapter?.disconnect();
    } finally {
      persistLastWallet(this.storage, null);
      this.state = {
        ...DEFAULT_STATE,
        expectedNetwork: this.state.expectedNetwork,
      };
      this.emit();
    }
  }

  dispose(): void {
    ++this.operation;
    this.stopAdapterSubscription();
    this.listeners.clear();
  }

  private startAdapterSubscription(adapter: WalletAdapter): void {
    this.stopAdapterSubscription();

    this.unsubscribeAdapter = adapter.subscribe((connection) => {
      if (this.state.walletId !== adapter.id) return;

      if (!connection) {
        this.setState({
          status: 'disconnected',
          walletId: adapter.id,
          address: null,
          walletNetwork: 'unknown',
          error: undefined,
        });
        return;
      }

      this.applyConnection(adapter.id, connection);
    });
  }

  private stopAdapterSubscription(): void {
    this.unsubscribeAdapter?.();
    this.unsubscribeAdapter = undefined;
  }

  private applyConnection(
    walletId: WalletId,
    connection: WalletSession,
  ): void {
    if (!connection.address) {
      this.setState({
        status: 'error',
        walletId,
        address: null,
        walletNetwork: connection.network,
        error: 'Wallet returned an empty account address.',
      });
      return;
    }

    if (connection.network === 'unknown') {
      this.setState({
        status: 'error',
        walletId,
        address: connection.address,
        walletNetwork: connection.network,
        error: 'Wallet network could not be determined.',
      });
      return;
    }

    this.setState({
      status: isNetworkMismatch(
        connection.network,
        this.state.expectedNetwork,
      )
        ? 'network-mismatch'
        : 'connected',
      walletId,
      address: connection.address,
      walletNetwork: connection.network,
      error: undefined,
      installUrl: undefined,
    });
  }

  private setState(patch: Partial<WalletState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function createWalletManager(
  expectedNetwork: Exclude<WalletNetwork, 'unknown'> = 'testnet',
): WalletManager {
  return new WalletManager(undefined, expectedNetwork);
}