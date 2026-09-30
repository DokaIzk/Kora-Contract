import {
  FreighterWalletAdapter,
  RabetWalletAdapter,
} from '../src/wallet/adapters';
import {
  isNetworkMismatch,
  normalizeWalletNetwork,
  STELLAR_NETWORK_PASSPHRASES,
} from '../src/wallet/network';
import {
  LAST_WALLET_STORAGE_KEY,
  WalletManager,
} from '../src/wallet/manager';
import type {
  StorageLike,
  WalletAdapter,
  WalletChangeListener,
  WalletSession,
  WalletId,
} from '../src/wallet/types';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeAdapter implements WalletAdapter {
  readonly label: string;
  readonly installUrl: string;
  installed = true;
  connectError?: Error;
  disconnected = false;
  unsubscribed = false;
  restoreConnection: WalletSession | null = null;
  private listener?: WalletChangeListener;

  constructor(
    readonly id: WalletId,
    readonly connection: WalletSession,
  ) {
    this.label = id === 'freighter' ? 'Freighter' : 'Rabet';
    this.installUrl = 'https://example.test/' + id;
  }

  async isInstalled(): Promise<boolean> {
    return this.installed;
  }

  async connect(): Promise<WalletSession> {
    if (this.connectError) throw this.connectError;
    return this.connection;
  }

  async restore(): Promise<WalletSession | null> {
    return this.restoreConnection;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }

  subscribe(listener: WalletChangeListener): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribed = true;
      this.listener = undefined;
    };
  }

  emit(connection: WalletSession | null): void {
    this.listener?.(connection);
  }
}

const testnetConnection: WalletSession = {
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  network: 'testnet',
  networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet,
};

const mainnetConnection: WalletSession = {
  address: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4',
  network: 'mainnet',
  networkPassphrase: STELLAR_NETWORK_PASSPHRASES.mainnet,
};

describe('wallet network normalization', () => {
  test.each([
    ['TESTNET', undefined, 'testnet'],
    ['test network', undefined, 'testnet'],
    ['PUBLIC', undefined, 'mainnet'],
    ['pubnet', undefined, 'mainnet'],
    ['custom public network', undefined, 'mainnet'],
    ['something-testnet-v2', undefined, 'testnet'],
    ['mystery', undefined, 'unknown'],
    [undefined, STELLAR_NETWORK_PASSPHRASES.testnet, 'testnet'],
    [undefined, STELLAR_NETWORK_PASSPHRASES.mainnet, 'mainnet'],
  ])('normalizes %s / %s to %s', (network, passphrase, expected) => {
    expect(normalizeWalletNetwork(network, passphrase)).toBe(expected);
  });

  it('detects known network mismatches only', () => {
    expect(isNetworkMismatch('mainnet', 'testnet')).toBe(true);
    expect(isNetworkMismatch('testnet', 'testnet')).toBe(false);
    expect(isNetworkMismatch('unknown', 'testnet')).toBe(false);
  });
});

describe('WalletManager', () => {
  it('returns install-required with an install URL when extension is missing', async () => {
    const storage = new MemoryStorage();
    const adapter = new FakeAdapter('freighter', testnetConnection);
    adapter.installed = false;
    const manager = new WalletManager([adapter], 'testnet', storage);

    const state = await manager.connect('freighter');

    expect(state.status).toBe('install-required');
    expect(state.installUrl).toBe(adapter.installUrl);
    expect(state.error).toContain('not installed');
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBeNull();
  });

  it('connects on the expected network and persists only wallet choice', async () => {
    const storage = new MemoryStorage();
    const adapter = new FakeAdapter('freighter', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', storage);

    const state = await manager.connect('freighter');

    expect(state.status).toBe('connected');
    expect(state.address).toBe(testnetConnection.address);
    expect(state.walletNetwork).toBe('testnet');
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBe('freighter');
    expect([...storage.values.values()]).toEqual(['freighter']);
  });

  it('warns on network mismatch and recovers when expected network changes', async () => {
    const adapter = new FakeAdapter('freighter', mainnetConnection);
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    expect((await manager.connect('freighter')).status).toBe('network-mismatch');

    manager.setExpectedNetwork('mainnet');
    expect(manager.getState().status).toBe('connected');
    expect(manager.getState().expectedNetwork).toBe('mainnet');
  });

  it('surfaces connection errors without persisting a session', async () => {
    const storage = new MemoryStorage();
    const adapter = new FakeAdapter('rabet', testnetConnection);
    adapter.connectError = new Error('User rejected request');
    const manager = new WalletManager([adapter], 'testnet', storage);

    const state = await manager.connect('rabet');

    expect(state.status).toBe('error');
    expect(state.error).toBe('User rejected request');
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBeNull();
  });

  it('rejects an indeterminate wallet network instead of signing blindly', async () => {
    const adapter = new FakeAdapter('rabet', {
      address: testnetConnection.address,
      network: 'unknown',
    });
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    const state = await manager.connect('rabet');

    expect(state.status).toBe('error');
    expect(state.error).toContain('could not be determined');
  });

  it('updates address and mismatch state on adapter account/network changes', async () => {
    const adapter = new FakeAdapter('freighter', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());
    await manager.connect('freighter');

    adapter.emit({
      address: mainnetConnection.address,
      network: 'testnet',
    });
    expect(manager.getState().address).toBe(mainnetConnection.address);
    expect(manager.getState().status).toBe('connected');

    adapter.emit(mainnetConnection);
    expect(manager.getState().walletNetwork).toBe('mainnet');
    expect(manager.getState().status).toBe('network-mismatch');

    adapter.emit(null);
    expect(manager.getState().status).toBe('disconnected');
    expect(manager.getState().address).toBeNull();
  });

  it('disconnects the adapter, unsubscribes, and clears persisted choice', async () => {
    const storage = new MemoryStorage();
    const adapter = new FakeAdapter('freighter', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', storage);
    await manager.connect('freighter');

    await manager.disconnect();

    expect(adapter.disconnected).toBe(true);
    expect(adapter.unsubscribed).toBe(true);
    expect(manager.getState().status).toBe('disconnected');
    expect(manager.getState().walletId).toBeNull();
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBeNull();
  });

  it('restores a persisted Freighter-like session without prompting', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');
    const adapter = new FakeAdapter('freighter', testnetConnection);
    adapter.restoreConnection = testnetConnection;
    const manager = new WalletManager([adapter], 'testnet', storage);

    const state = await manager.reconnectLastUsed();

    expect(state.status).toBe('connected');
    expect(state.address).toBe(testnetConnection.address);
  });

  it('keeps last Rabet choice selected when safe auto-restore is unavailable', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, 'rabet');
    const adapter = new FakeAdapter('rabet', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', storage);

    const state = await manager.reconnectLastUsed();

    expect(state.status).toBe('disconnected');
    expect(state.walletId).toBe('rabet');
    expect(state.address).toBeNull();
  });

  it('emits immutable snapshots and disposes listeners', async () => {
    const adapter = new FakeAdapter('freighter', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());
    const seen: string[] = [];
    const unsubscribe = manager.subscribe((state) => {
      seen.push(state.status);
      state.status = 'error';
    });

    expect(manager.getState().status).toBe('disconnected');
    await manager.connect('freighter');
    expect(seen).toContain('connected');

    unsubscribe();
    manager.dispose();
    expect(adapter.unsubscribed).toBe(true);
  });
});

describe('FreighterWalletAdapter', () => {
  function makeApi(overrides: Record<string, unknown> = {}) {
    class Watcher {
      static instance: Watcher | undefined;
      stopped = false;
      callback?: (value: {
        address: string;
        network: string;
        networkPassphrase: string;
      }) => void;

      constructor(_timeout?: number) {
        Watcher.instance = this;
      }

      watch(callback: (value: {
        address: string;
        network: string;
        networkPassphrase: string;
      }) => void) {
        this.callback = callback;
        return {};
      }

      stop() {
        this.stopped = true;
      }
    }

    return {
      api: {
        isConnected: jest.fn(async () => ({ isConnected: true })),
        requestAccess: jest.fn(async () => ({ address: testnetConnection.address })),
        getAddress: jest.fn(async () => ({ address: testnetConnection.address })),
        getNetwork: jest.fn(async () => ({
          network: 'TESTNET',
          networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet,
        })),
        WatchWalletChanges: Watcher,
        ...overrides,
      },
      Watcher,
    };
  }

  it('connects and restores with normalized network details', async () => {
    const { api } = makeApi();
    const adapter = new FreighterWalletAdapter(() => api as never);

    expect(await adapter.isInstalled()).toBe(true);
    expect(await adapter.connect()).toEqual(testnetConnection);
    expect(await adapter.restore()).toEqual(testnetConnection);
  });

  it('reports unavailable providers and rejected access', async () => {
    const missing = new FreighterWalletAdapter(() => undefined);
    expect(await missing.isInstalled()).toBe(false);
    await expect(missing.connect()).rejects.toThrow('not installed');

    const { api } = makeApi({
      requestAccess: jest.fn(async () => ({
        address: '',
        error: { message: 'Rejected' },
      })),
    });
    const rejected = new FreighterWalletAdapter(() => api as never);
    await expect(rejected.connect()).rejects.toThrow('Rejected');
  });

  it('propagates watcher account/network changes and stops cleanly', async () => {
    const { api, Watcher } = makeApi();
    const adapter = new FreighterWalletAdapter(() => api as never);
    const listener = jest.fn();

    const stop = adapter.subscribe(listener);
    Watcher.instance?.callback?.({
      address: mainnetConnection.address,
      network: 'PUBLIC',
      networkPassphrase: STELLAR_NETWORK_PASSPHRASES.mainnet,
    });

    expect(listener).toHaveBeenCalledWith(mainnetConnection);
    stop();
    expect(Watcher.instance?.stopped).toBe(true);
  });
});

describe('RabetWalletAdapter', () => {
  function makeRabet() {
    const handlers = new Map<string, (network?: string) => void>();
    const api = {
      connect: jest.fn(async () => ({ publicKey: testnetConnection.address })),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest.fn(async () => 'testnet'),
      on: jest.fn((event: string, callback: (network?: string) => void) => {
        handlers.set(event, callback);
      }),
      off: jest.fn((event: string) => {
        handlers.delete(event);
      }),
    };
    return { api, handlers };
  }

  it('connects, reads network, and disconnects', async () => {
    const { api } = makeRabet();
    const adapter = new RabetWalletAdapter(() => api as never);

    expect(await adapter.isInstalled()).toBe(true);
    expect(await adapter.connect()).toEqual({
      address: testnetConnection.address,
      network: 'testnet',
    });
    expect(await adapter.restore()).toBeNull();

    await adapter.disconnect();
    expect(api.disconnect).toHaveBeenCalledTimes(1);
  });

  it('handles network and account changes mid-session', async () => {
    const { api, handlers } = makeRabet();
    const adapter = new RabetWalletAdapter(() => api as never);
    await adapter.connect();

    const listener = jest.fn();
    const unsubscribe = adapter.subscribe(listener);

    handlers.get('networkChanged')?.('mainnet');
    expect(listener).toHaveBeenCalledWith({
      address: testnetConnection.address,
      network: 'mainnet',
    });

    api.connect.mockResolvedValueOnce({ publicKey: mainnetConnection.address });
    handlers.get('accountChanged')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith({
      address: mainnetConnection.address,
      network: 'testnet',
    });

    unsubscribe();
    expect(api.off).toHaveBeenCalledTimes(2);
  });

  it('rejects missing Rabet and provider errors', async () => {
    const missing = new RabetWalletAdapter(() => undefined);
    expect(await missing.isInstalled()).toBe(false);
    await expect(missing.connect()).rejects.toThrow('not installed');

    const { api } = makeRabet();
    api.connect.mockRejectedValueOnce({ error: 'User rejected' });
    const rejected = new RabetWalletAdapter(() => api as never);
    await expect(rejected.connect()).rejects.toEqual({ error: 'User rejected' });
  });
});

describe('WalletManager defensive paths', () => {
  class ThrowingStorage implements StorageLike {
    getItem(): string | null {
      throw new Error('storage blocked');
    }
    setItem(): void {
      throw new Error('storage blocked');
    }
    removeItem(): void {
      throw new Error('storage blocked');
    }
  }

  it('keeps working when browser storage is blocked', async () => {
    const adapter = new FakeAdapter('freighter', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', new ThrowingStorage());

    expect(manager.getState().walletId).toBeNull();
    expect((await manager.connect('freighter')).status).toBe('connected');
    await expect(manager.disconnect()).resolves.toBeUndefined();
  });

  it('reports an unsupported adapter id without throwing', async () => {
    const manager = new WalletManager([], 'testnet', new MemoryStorage());

    const state = await manager.connect('phantom' as WalletId);

    expect(state.status).toBe('error');
    expect(state.error).toContain('Unsupported wallet');
  });

  it('returns unchanged state when there is no persisted wallet', async () => {
    const manager = new WalletManager([], 'testnet', new MemoryStorage());
    const before = manager.getState();

    expect(await manager.reconnectLastUsed()).toEqual(before);
  });

  it('handles a persisted wallet whose adapter is unavailable', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');
    const manager = new WalletManager([], 'testnet', storage);

    const state = await manager.reconnectLastUsed();

    expect(state.walletId).toBe('freighter');
    expect(state.status).toBe('disconnected');
  });

  it('shows install-required during persisted reconnect when extension vanished', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');
    const adapter = new FakeAdapter('freighter', testnetConnection);
    adapter.installed = false;
    const manager = new WalletManager([adapter], 'testnet', storage);

    const state = await manager.reconnectLastUsed();

    expect(state.status).toBe('install-required');
    expect(state.installUrl).toBe(adapter.installUrl);
  });

  it('rejects empty addresses returned by adapters', async () => {
    const adapter = new FakeAdapter('freighter', {
      address: '',
      network: 'testnet',
    });
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    const state = await manager.connect('freighter');

    expect(state.status).toBe('error');
    expect(state.error).toContain('empty account');
  });

  it('disconnects safely even when no wallet is active', async () => {
    const manager = new WalletManager([], 'mainnet', new MemoryStorage());

    await manager.disconnect();

    expect(manager.getState()).toMatchObject({
      status: 'disconnected',
      walletId: null,
      expectedNetwork: 'mainnet',
    });
  });

  it('ignores a late connect result after the user disconnects', async () => {
    let resolveConnect: ((value: WalletSession) => void) | undefined;
    const adapter: WalletAdapter = {
      id: 'freighter',
      label: 'Freighter',
      installUrl: 'https://example.test/freighter',
      isInstalled: async () => true,
      connect: () =>
        new Promise<WalletSession>((resolve) => {
          resolveConnect = resolve;
        }),
      restore: async () => null,
      disconnect: async () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    const pending = manager.connect('freighter');
    await Promise.resolve();
    await manager.disconnect();
    resolveConnect?.(testnetConnection);
    await pending;

    expect(manager.getState().status).toBe('disconnected');
    expect(manager.getState().address).toBeNull();
  });

  it('ignores a late install check after the operation changes', async () => {
    let resolveInstalled: ((value: boolean) => void) | undefined;
    const adapter: WalletAdapter = {
      id: 'freighter',
      label: 'Freighter',
      installUrl: 'https://example.test/freighter',
      isInstalled: () =>
        new Promise<boolean>((resolve) => {
          resolveInstalled = resolve;
        }),
      connect: async () => testnetConnection,
      restore: async () => null,
      disconnect: async () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    const pending = manager.connect('freighter');
    await manager.disconnect();
    resolveInstalled?.(false);
    await pending;

    expect(manager.getState().status).toBe('disconnected');
  });

  it('ignores a late connection rejection after the user disconnects', async () => {
    let rejectConnect: ((reason: Error) => void) | undefined;
    const adapter: WalletAdapter = {
      id: 'rabet',
      label: 'Rabet',
      installUrl: 'https://example.test/rabet',
      isInstalled: async () => true,
      connect: () =>
        new Promise<WalletSession>((_resolve, reject) => {
          rejectConnect = reject;
        }),
      restore: async () => null,
      disconnect: async () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    const pending = manager.connect('rabet');
    await Promise.resolve();
    await manager.disconnect();
    rejectConnect?.(new Error('late failure'));
    await pending;

    expect(manager.getState().status).toBe('disconnected');
  });
});

describe('FreighterWalletAdapter defensive paths', () => {
  function baseFreighterApi() {
    return {
      isConnected: jest.fn(async () => ({ isConnected: true })),
      requestAccess: jest.fn(async () => ({ address: testnetConnection.address })),
      getAddress: jest.fn(async () => ({ address: testnetConnection.address })),
      getNetwork: jest.fn(async () => ({
        network: 'TESTNET',
        networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet,
      })),
    };
  }

  it('handles connection-status exceptions and error responses', async () => {
    const throwing = baseFreighterApi();
    throwing.isConnected.mockRejectedValueOnce(new Error('bridge down'));
    expect(
      await new FreighterWalletAdapter(() => throwing as never).isInstalled(),
    ).toBe(false);

    const errored = baseFreighterApi();
    errored.isConnected.mockResolvedValueOnce({
      isConnected: true,
      error: { message: 'extension error' },
    } as never);
    expect(
      await new FreighterWalletAdapter(() => errored as never).isInstalled(),
    ).toBe(false);
  });

  it('rejects empty access addresses and network API errors', async () => {
    const empty = baseFreighterApi();
    empty.requestAccess.mockResolvedValueOnce({ address: '' });
    await expect(
      new FreighterWalletAdapter(() => empty as never).connect(),
    ).rejects.toThrow('empty account');

    const badNetwork = baseFreighterApi();
    badNetwork.getNetwork.mockResolvedValueOnce({
      network: '',
      networkPassphrase: '',
      error: { error: 'network unavailable' },
    } as never);
    await expect(
      new FreighterWalletAdapter(() => badNetwork as never).connect(),
    ).rejects.toThrow('network unavailable');

    const fallback = baseFreighterApi();
    fallback.getNetwork.mockResolvedValueOnce({
      network: '',
      networkPassphrase: '',
      error: {},
    } as never);
    await expect(
      new FreighterWalletAdapter(() => fallback as never).connect(),
    ).rejects.toThrow('Unable to read the Freighter network');
  });

  it('returns null from restore for unavailable, invalid, and throwing providers', async () => {
    expect(
      await new FreighterWalletAdapter(() => undefined).restore(),
    ).toBeNull();

    const noAddress = baseFreighterApi();
    noAddress.getAddress.mockResolvedValueOnce({
      address: '',
      error: { message: 'locked' },
    } as never);
    expect(
      await new FreighterWalletAdapter(() => noAddress as never).restore(),
    ).toBeNull();

    const throwing = baseFreighterApi();
    throwing.getAddress.mockRejectedValueOnce(new Error('locked'));
    expect(
      await new FreighterWalletAdapter(() => throwing as never).restore(),
    ).toBeNull();
  });

  it('maps watcher errors to a disconnected change', () => {
    let callback:
      | ((value: {
          address: string;
          network: string;
          networkPassphrase: string;
          error?: { message?: string };
        }) => void)
      | undefined;
    class Watcher {
      watch(cb: typeof callback) {
        callback = cb;
        return {};
      }
      stop() {}
    }
    const api = {
      ...baseFreighterApi(),
      WatchWalletChanges: Watcher,
    };
    const listener = jest.fn();
    const adapter = new FreighterWalletAdapter(() => api as never);

    adapter.subscribe(listener);
    callback?.({
      address: '',
      network: '',
      networkPassphrase: '',
      error: { message: 'locked' },
    });

    expect(listener).toHaveBeenCalledWith(null);
  });

  it('uses polling fallback when WatchWalletChanges is unavailable', async () => {
    jest.useFakeTimers();
    try {
      const api = baseFreighterApi();
      const adapter = new FreighterWalletAdapter(() => api as never, 10);
      const listener = jest.fn();

      const stop = adapter.subscribe(listener);
      await jest.advanceTimersByTimeAsync(0);

      expect(listener).toHaveBeenCalledWith(testnetConnection);

      api.getAddress.mockResolvedValue({
        address: mainnetConnection.address,
      });
      await jest.advanceTimersByTimeAsync(11);

      expect(listener).toHaveBeenLastCalledWith({
        address: mainnetConnection.address,
        network: 'testnet',
        networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet,
      });

      const calls = listener.mock.calls.length;
      stop();
      await jest.advanceTimersByTimeAsync(20);
      expect(listener).toHaveBeenCalledTimes(calls);
    } finally {
      jest.useRealTimers();
    }
  });

  it('has safe no-op subscription and disconnect when provider is absent', async () => {
    const adapter = new FreighterWalletAdapter(() => undefined);
    const listener = jest.fn();
    const stop = adapter.subscribe(listener);

    stop();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('RabetWalletAdapter defensive paths', () => {
  it('accepts string connect results and object network responses', async () => {
    const api = {
      connect: jest.fn(async () => testnetConnection.address),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest.fn(async () => ({ network: 'PUBLIC' })),
      on: jest.fn(),
    };
    const adapter = new RabetWalletAdapter(() => api as never);

    expect(await adapter.connect()).toEqual({
      address: testnetConnection.address,
      network: 'mainnet',
    });
  });

  it('surfaces provider-declared errors and empty addresses', async () => {
    const connectError = {
      connect: jest.fn(async () => ({ error: 'denied' })),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest.fn(async () => 'testnet'),
      on: jest.fn(),
    };
    await expect(
      new RabetWalletAdapter(() => connectError as never).connect(),
    ).rejects.toThrow('denied');

    const empty = {
      ...connectError,
      connect: jest.fn(async () => ({})),
    };
    await expect(
      new RabetWalletAdapter(() => empty as never).connect(),
    ).rejects.toThrow('empty account');

    const networkError = {
      ...connectError,
      connect: jest.fn(async () => ({ publicKey: testnetConnection.address })),
      getNetwork: jest.fn(async () => ({ error: 'network failed' })),
    };
    await expect(
      new RabetWalletAdapter(() => networkError as never).connect(),
    ).rejects.toThrow('network failed');
  });

  it('maps failed account change refreshes to disconnected', async () => {
    const handlers = new Map<string, (network?: string) => void>();
    const api = {
      connect: jest
        .fn()
        .mockResolvedValueOnce({ publicKey: testnetConnection.address })
        .mockRejectedValueOnce(new Error('wallet locked')),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest.fn(async () => 'testnet'),
      on: jest.fn((event: string, cb: (network?: string) => void) => {
        handlers.set(event, cb);
      }),
    };
    const adapter = new RabetWalletAdapter(() => api as never);
    await adapter.connect();
    const listener = jest.fn();

    adapter.subscribe(listener);
    handlers.get('accountChanged')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(null);
  });

  it('maps empty account-change results to disconnected', async () => {
    const handlers = new Map<string, (network?: string) => void>();
    const api = {
      connect: jest
        .fn()
        .mockResolvedValueOnce({ publicKey: testnetConnection.address })
        .mockResolvedValueOnce({}),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest.fn(async () => 'testnet'),
      on: jest.fn((event: string, cb: (network?: string) => void) => {
        handlers.set(event, cb);
      }),
    };
    const adapter = new RabetWalletAdapter(() => api as never);
    await adapter.connect();
    const listener = jest.fn();

    adapter.subscribe(listener);
    handlers.get('accountChanged')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(null);
  });

  it('ignores network events before connect and supports providers without off()', () => {
    const handlers = new Map<string, (network?: string) => void>();
    const api = {
      connect: jest.fn(async () => ({ publicKey: testnetConnection.address })),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest.fn(async () => 'testnet'),
      on: jest.fn((event: string, cb: (network?: string) => void) => {
        handlers.set(event, cb);
      }),
    };
    const adapter = new RabetWalletAdapter(() => api as never);
    const listener = jest.fn();

    const stop = adapter.subscribe(listener);
    handlers.get('networkChanged')?.('mainnet');
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('has safe no-op subscription and disconnect when provider is absent', async () => {
    const adapter = new RabetWalletAdapter(() => undefined);
    const listener = jest.fn();

    adapter.subscribe(listener)();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });
});


describe('coverage-critical wallet invariants', () => {
  it('normalizes a completely missing network as unknown', () => {
    expect(normalizeWalletNetwork()).toBe('unknown');
  });

  it('uses safe SSR defaults without browser globals', async () => {
    const freighter = new FreighterWalletAdapter();
    const rabet = new RabetWalletAdapter();
    const fListener = jest.fn();
    const rListener = jest.fn();

    expect(await freighter.isInstalled()).toBe(false);
    expect(await rabet.isInstalled()).toBe(false);
    freighter.subscribe(fListener)();
    rabet.subscribe(rListener)();

    const { createWalletManager } = await import('../src/wallet/manager');
    const manager = createWalletManager();
    expect(manager.getWalletOptions()).toEqual([
      {
        id: 'freighter',
        label: 'Freighter',
        installUrl: 'https://www.freighter.app/',
      },
      {
        id: 'rabet',
        label: 'Rabet',
        installUrl: 'https://rabet.io/',
      },
    ]);
    expect(manager.getState().expectedNetwork).toBe('testnet');
    manager.dispose();
  });

  it('works without any storage implementation', async () => {
    const adapter = new FakeAdapter('freighter', testnetConnection);
    const manager = new WalletManager([adapter], 'testnet', undefined);

    expect((await manager.connect('freighter')).status).toBe('connected');
    await manager.disconnect();
    expect(manager.getState().status).toBe('disconnected');
  });

  it('does not emit when expected network is unchanged', () => {
    const manager = new WalletManager([], 'testnet', new MemoryStorage());
    const listener = jest.fn();
    manager.subscribe(listener);
    listener.mockClear();

    manager.setExpectedNetwork('testnet');

    expect(listener).not.toHaveBeenCalled();
  });

  it('moves a connected mainnet wallet into mismatch when app switches to testnet', async () => {
    const adapter = new FakeAdapter('freighter', mainnetConnection);
    const manager = new WalletManager([adapter], 'mainnet', new MemoryStorage());
    expect((await manager.connect('freighter')).status).toBe('connected');

    manager.setExpectedNetwork('testnet');

    expect(manager.getState().status).toBe('network-mismatch');
  });

  it('maps non-Error connection rejections to the generic failure message', async () => {
    const adapter: WalletAdapter = {
      id: 'rabet',
      label: 'Rabet',
      installUrl: 'https://rabet.io/',
      isInstalled: async () => true,
      connect: async () => {
        throw { reason: 'opaque-provider-error' };
      },
      restore: async () => null,
      disconnect: async () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new WalletManager([adapter], 'testnet', new MemoryStorage());

    const state = await manager.connect('rabet');

    expect(state.status).toBe('error');
    expect(state.error).toBe('Wallet connection failed.');
  });

  it('ignores a stale reconnect install result after disconnect', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');

    let resolveInstalled: ((value: boolean) => void) | undefined;
    const adapter: WalletAdapter = {
      id: 'freighter',
      label: 'Freighter',
      installUrl: 'https://www.freighter.app/',
      isInstalled: () =>
        new Promise<boolean>((resolve) => {
          resolveInstalled = resolve;
        }),
      connect: async () => testnetConnection,
      restore: async () => testnetConnection,
      disconnect: async () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new WalletManager([adapter], 'testnet', storage);

    const pending = manager.reconnectLastUsed();
    await manager.disconnect();
    resolveInstalled?.(false);
    await pending;

    expect(manager.getState().status).toBe('disconnected');
  });

  it('ignores a stale restore result after disconnect', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');

    let resolveRestore: ((value: WalletSession | null) => void) | undefined;
    const adapter: WalletAdapter = {
      id: 'freighter',
      label: 'Freighter',
      installUrl: 'https://www.freighter.app/',
      isInstalled: async () => true,
      connect: async () => testnetConnection,
      restore: () =>
        new Promise<WalletSession | null>((resolve) => {
          resolveRestore = resolve;
        }),
      disconnect: async () => undefined,
      subscribe: () => () => undefined,
    };
    const manager = new WalletManager([adapter], 'testnet', storage);

    const pending = manager.reconnectLastUsed();
    await Promise.resolve();
    await manager.disconnect();
    resolveRestore?.(testnetConnection);
    await pending;

    expect(manager.getState().status).toBe('disconnected');
  });

  it('ignores an old adapter callback after switching wallets', async () => {
    let staleListener: WalletChangeListener | undefined;
    const first: WalletAdapter = {
      id: 'freighter',
      label: 'Freighter',
      installUrl: 'https://www.freighter.app/',
      isInstalled: async () => true,
      connect: async () => testnetConnection,
      restore: async () => null,
      disconnect: async () => undefined,
      subscribe: (listener) => {
        staleListener = listener;
        return () => undefined;
      },
    };
    const second = new FakeAdapter('rabet', {
      address: mainnetConnection.address,
      network: 'testnet',
    });
    const manager = new WalletManager(
      [first, second],
      'testnet',
      new MemoryStorage(),
    );

    await manager.connect('freighter');
    await manager.connect('rabet');
    staleListener?.(mainnetConnection);

    expect(manager.getState().walletId).toBe('rabet');
    expect(manager.getState().address).toBe(mainnetConnection.address);
    expect(manager.getState().walletNetwork).toBe('testnet');
  });

  it('uses string and fallback error messages from Freighter API errors', async () => {
    const stringApi = {
      isConnected: jest.fn(async () => ({ isConnected: true })),
      requestAccess: jest.fn(async () => ({
        address: '',
        error: 'plain rejection',
      })),
      getAddress: jest.fn(async () => ({ address: '' })),
      getNetwork: jest.fn(async () => ({
        network: 'TESTNET',
        networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet,
      })),
    };
    await expect(
      new FreighterWalletAdapter(() => stringApi as never).connect(),
    ).rejects.toThrow('plain rejection');

    const whitespaceApi = {
      ...stringApi,
      requestAccess: jest.fn(async () => ({
        address: '',
        error: '   ',
      })),
    };
    await expect(
      new FreighterWalletAdapter(() => whitespaceApi as never).connect(),
    ).rejects.toThrow('Freighter access was rejected');
  });

  it('covers Freighter polling with no duplicate event and no passphrase', async () => {
    jest.useFakeTimers();
    try {
      const api = {
        isConnected: jest.fn(async () => ({ isConnected: true })),
        requestAccess: jest.fn(async () => ({ address: testnetConnection.address })),
        getAddress: jest.fn(async () => ({ address: testnetConnection.address })),
        getNetwork: jest.fn(async () => ({
          network: 'TESTNET',
          networkPassphrase: undefined,
        })),
      };
      const adapter = new FreighterWalletAdapter(() => api as never, 5);
      const listener = jest.fn();

      const stop = adapter.subscribe(listener);
      await jest.advanceTimersByTimeAsync(0);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith({
        address: testnetConnection.address,
        network: 'testnet',
        networkPassphrase: undefined,
      });

      await jest.advanceTimersByTimeAsync(6);
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a captured Freighter poll callback after stop', async () => {
    const realSetInterval = global.setInterval;
    const realClearInterval = global.clearInterval;
    let intervalCallback: (() => void) | undefined;

    (global as unknown as { setInterval: typeof setInterval }).setInterval = ((
      callback: () => void,
    ) => {
      intervalCallback = callback;
      return 123 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    (global as unknown as { clearInterval: typeof clearInterval }).clearInterval =
      (() => undefined) as typeof clearInterval;

    try {
      const api = {
        isConnected: jest.fn(async () => ({ isConnected: true })),
        requestAccess: jest.fn(async () => ({ address: testnetConnection.address })),
        getAddress: jest.fn(async () => ({ address: testnetConnection.address })),
        getNetwork: jest.fn(async () => ({
          network: 'TESTNET',
          networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet,
        })),
      };
      const adapter = new FreighterWalletAdapter(() => api as never, 5);
      const listener = jest.fn();
      const stop = adapter.subscribe(listener);
      await Promise.resolve();
      await Promise.resolve();
      stop();

      intervalCallback?.();
      await Promise.resolve();

      const callsAfterStop = listener.mock.calls.length;
      expect(callsAfterStop).toBeLessThanOrEqual(1);
    } finally {
      global.setInterval = realSetInterval;
      global.clearInterval = realClearInterval;
    }
  });

  it('covers Rabet string account refresh and undefined network events', async () => {
    const handlers = new Map<string, (network?: string) => void>();
    const api = {
      connect: jest
        .fn()
        .mockResolvedValueOnce({ publicKey: testnetConnection.address })
        .mockResolvedValueOnce(mainnetConnection.address),
      disconnect: jest.fn(async () => undefined),
      getNetwork: jest
        .fn()
        .mockResolvedValueOnce('testnet')
        .mockResolvedValueOnce({}),
      on: jest.fn((event: string, cb: (network?: string) => void) => {
        handlers.set(event, cb);
      }),
    };
    const adapter = new RabetWalletAdapter(() => api as never);
    await adapter.connect();
    const listener = jest.fn();
    const stop = adapter.subscribe(listener);

    handlers.get('accountChanged')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith({
      address: mainnetConnection.address,
      network: 'testnet',
    });

    handlers.get('networkChanged')?.();
    expect(listener).toHaveBeenLastCalledWith({
      address: mainnetConnection.address,
      network: 'unknown',
    });

    const accountCallback = handlers.get('accountChanged');
    stop();
    accountCallback?.();
    await Promise.resolve();

    expect(api.connect).toHaveBeenCalledTimes(2);
  });
});
