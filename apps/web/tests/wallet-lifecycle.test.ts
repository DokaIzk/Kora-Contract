import { WalletManager, LAST_WALLET_STORAGE_KEY } from '../src/wallet/manager';
import { FreighterWalletAdapter, RabetWalletAdapter } from '../src/wallet/adapters';
import { normalizeWalletNetwork, STELLAR_NETWORK_PASSPHRASES } from '../src/wallet/network';
import type { WalletAdapter, WalletId, WalletSession, WalletChangeListener, StorageLike } from '../src/wallet/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let step = 0; step < 12; step++) await Promise.resolve();
}

const session: WalletSession = {
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  network: 'testnet',
};
const changed: WalletSession = { address: 'changed-test-account', network: 'mainnet' };

function memory(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

function fake(id: WalletId = 'freighter') {
  const callbacks: WalletChangeListener[] = [];
  const cleanup = jest.fn();
  const adapter = {
    id, label: id, installUrl: 'https://example.test/wallet',
    isInstalled: jest.fn(async (): Promise<boolean> => true),
    connect: jest.fn(async (): Promise<WalletSession> => session),
    restore: jest.fn(async (): Promise<WalletSession | null> => session),
    disconnect: jest.fn(async () => undefined),
    subscribe: jest.fn((callback: WalletChangeListener) => {
      callbacks.push(callback);
      return cleanup;
    }),
  } satisfies WalletAdapter;
  return { adapter, callbacks, cleanup };
}

function rabet() {
  const handlers = new Map<string, (value?: string) => void>();
  const api = {
    connect: jest.fn(async (): Promise<{ publicKey?: string; error?: string }> => ({ publicKey: session.address })),
    disconnect: jest.fn(async () => undefined),
    getNetwork: jest.fn(async (): Promise<string | { network?: string; error?: string }> => 'testnet'),
    on: jest.fn((event: string, callback: (value?: string) => void) => { handlers.set(event, callback); }),
    off: jest.fn((event: string) => { handlers.delete(event); }),
  };
  return { api, handlers, adapter: new RabetWalletAdapter(() => api) };
}

function freighter() {
  return {
    isConnected: jest.fn(async () => ({ isConnected: true })),
    requestAccess: jest.fn(async () => ({ address: session.address })),
    getAddress: jest.fn(async () => ({ address: session.address })),
    getNetwork: jest.fn(async () => ({ network: 'TESTNET', networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet })),
  };
}

describe('network identity is exact, not a display-name substring', () => {
  test.each(['custom public network', 'something-testnet-v2', 'not-mainnet', 'private-testnet', 'publicity'])('%s remains unknown', name => {
    expect(normalizeWalletNetwork(name)).toBe('unknown');
  });
  test.each(['', 'Standalone Network ; February 2017', 'Test SDF Future Network ; October 2022', ' '+STELLAR_NETWORK_PASSPHRASES.testnet, STELLAR_NETWORK_PASSPHRASES.testnet+' '])('unrecognized passphrase overrides friendly name: %s', passphrase => {
    expect(normalizeWalletNetwork('TESTNET', passphrase)).toBe('unknown');
  });
  it('uses the canonical passphrase over a conflicting label', () => {
    expect(normalizeWalletNetwork('PUBLIC', STELLAR_NETWORK_PASSPHRASES.testnet)).toBe('testnet');
  });
});

describe('WalletManager asynchronous lifecycle regressions', () => {
  test.each(['connect', 'restore'] as const)('cancelled %s never starts a provider request after a late availability result', async mode => {
    const { adapter } = fake();
    const storage = memory(); storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');
    const available = deferred<boolean>();
    adapter.isInstalled.mockImplementation(() => available.promise);
    const manager = new WalletManager([adapter], 'testnet', storage);
    const pending = mode === 'connect' ? manager.connect('freighter') : manager.reconnectLastUsed();
    await manager.disconnect();
    available.resolve(true);
    await pending;
    expect(adapter.connect).not.toHaveBeenCalled();
    expect(adapter.restore).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('disconnected');
  });

  it('revokes local connected state immediately, before provider disconnect completes', async () => {
    const { adapter } = fake(); const storage = memory();
    const pending = deferred<undefined>(); adapter.disconnect.mockImplementation(() => pending.promise);
    const manager = new WalletManager([adapter], 'testnet', storage);
    await manager.connect('freighter');
    const closing = manager.disconnect();
    const beforeProviderReturns = manager.getState();
    pending.resolve(undefined); await closing;
    expect(beforeProviderReturns.status).toBe('disconnected');
    expect(beforeProviderReturns.address).toBeNull();
  });

  it('a slow old disconnect cannot overwrite a newer wallet session or its preference', async () => {
    const old = fake('freighter'); const next = fake('rabet'); const storage = memory();
    const pending = deferred<undefined>(); old.adapter.disconnect.mockImplementation(() => pending.promise);
    const manager = new WalletManager([old.adapter, next.adapter], 'testnet', storage);
    await manager.connect('freighter');
    const closing = manager.disconnect();
    await manager.connect('rabet');
    pending.resolve(undefined); await closing;
    expect(manager.getState()).toMatchObject({ status: 'connected', walletId: 'rabet' });
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBe('rabet');
    manager.dispose();
  });

  it('disconnect bridge rejection does not become an unhandled UI promise', async () => {
    const { adapter } = fake(); adapter.disconnect.mockRejectedValue(new Error('bridge closed'));
    const manager = new WalletManager([adapter], 'testnet', memory());
    await manager.connect('freighter');
    await expect(manager.disconnect()).resolves.toBeUndefined();
    expect(manager.getState()).toMatchObject({ status: 'disconnected', address: null });
  });

  it('ignores an already-queued callback from an earlier connection to the same wallet', async () => {
    const { adapter, callbacks } = fake();
    const manager = new WalletManager([adapter], 'testnet', memory());
    await manager.connect('freighter'); const oldCallback = callbacks[0];
    await manager.connect('freighter');
    oldCallback(changed);
    expect(manager.getState()).toMatchObject({ address: session.address, walletNetwork: 'testnet' });
    manager.dispose();
  });

  it('cleanup exceptions cannot leave local connected state behind', async () => {
    const { adapter, cleanup, callbacks } = fake(); cleanup.mockImplementation(() => { throw new Error('off failed'); });
    const manager = new WalletManager([adapter], 'testnet', memory());
    await manager.connect('freighter');
    await expect(manager.disconnect()).resolves.toBeUndefined();
    callbacks[0](session);
    expect(manager.getState().status).toBe('disconnected');
  });

  it('failed restore subscriptions fail closed rather than reject or remain connected', async () => {
    const { adapter } = fake(); adapter.subscribe.mockImplementation(() => { throw new Error('watch unavailable'); });
    const storage = memory(); storage.setItem(LAST_WALLET_STORAGE_KEY, 'freighter');
    const manager = new WalletManager([adapter], 'testnet', storage);
    await expect(manager.reconnectLastUsed()).resolves.toMatchObject({ status: 'error', address: null });
  });

  it('isolates state snapshots between subscribers', async () => {
    const { adapter } = fake(); const manager = new WalletManager([adapter], 'testnet', memory());
    manager.subscribe(value => { value.status = 'error'; });
    const listener = jest.fn(); manager.subscribe(listener);
    await manager.connect('freighter');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'connected' }));
    manager.dispose();
  });

  it('validates a session passphrase at the common adapter boundary', async () => {
    const { adapter } = fake(); adapter.connect.mockResolvedValue({ ...session, networkPassphrase: 'private network' });
    const manager = new WalletManager([adapter], 'testnet', memory());
    expect((await manager.connect('freighter')).status).toBe('error');
  });
});

describe('wallet provider subscription lifetime', () => {
  it('Freighter ignores watcher callbacks queued before stop', () => {
    let callback!: WalletChangeListener;
    const stop = jest.fn();
    class Watcher {
      watch(cb: (value: { address: string; network: string; networkPassphrase: string }) => void) {
        callback = () => cb({ address: session.address, network: 'TESTNET', networkPassphrase: STELLAR_NETWORK_PASSPHRASES.testnet });
        return {};
      }
      stop() { stop(); }
    }
    const adapter = new FreighterWalletAdapter(() => ({ ...freighter(), WatchWalletChanges: Watcher }));
    const listener = jest.fn(); const unsubscribe = adapter.subscribe(listener);
    unsubscribe(); callback(session);
    expect(listener).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(1);
  });

  it('Freighter surfaces watcher initialization errors and cleans up', () => {
    const stop = jest.fn();
    class Watcher {
      watch() { return { error: { message: 'watch initialization failed' } }; }
      stop() { stop(); }
    }
    const adapter = new FreighterWalletAdapter(() => ({ ...freighter(), WatchWalletChanges: Watcher }));
    expect(() => adapter.subscribe(jest.fn())).toThrow('watch initialization failed');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('Freighter polling does not publish after unsubscribe while a request is pending', async () => {
    jest.useFakeTimers();
    try {
      const api = freighter(); const address = deferred<{ address: string }>();
      api.getAddress.mockImplementation(() => address.promise);
      const adapter = new FreighterWalletAdapter(() => api, 10); const listener = jest.fn();
      const stop = adapter.subscribe(listener); await flush(); stop();
      address.resolve({ address: session.address }); await flush();
      expect(listener).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  it('Rabet does not publish or request network after unsubscribe during account refresh', async () => {
    const { api, handlers, adapter } = rabet(); await adapter.connect();
    const account = deferred<{ publicKey: string }>(); api.connect.mockImplementation(() => account.promise);
    const listener = jest.fn(); const stop = adapter.subscribe(listener);
    handlers.get('accountChanged')?.(); stop();
    account.resolve({ publicKey: changed.address }); await flush();
    expect(listener).not.toHaveBeenCalled(); expect(api.getNetwork).toHaveBeenCalledTimes(1);
  });

  it('Rabet keeps the newest of two out-of-order account refreshes', async () => {
    const { api, handlers, adapter } = rabet(); await adapter.connect();
    const first = deferred<{ publicKey: string }>(); const second = deferred<{ publicKey: string }>();
    api.connect.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const listener = jest.fn(); const stop = adapter.subscribe(listener);
    handlers.get('accountChanged')?.(); handlers.get('accountChanged')?.();
    second.resolve({ publicKey: 'newest-test-account' }); await flush();
    first.resolve({ publicKey: 'stale-test-account' }); await flush();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ address: 'newest-test-account' })); stop();
  });

  it('Rabet does not overwrite a newer network event with a stale getNetwork response', async () => {
    const { api, handlers, adapter } = rabet(); await adapter.connect();
    const network = deferred<string>(); api.getNetwork.mockImplementationOnce(() => network.promise);
    const listener = jest.fn(); const stop = adapter.subscribe(listener);
    handlers.get('accountChanged')?.(); await flush();
    handlers.get('networkChanged')?.('mainnet'); network.resolve('testnet'); await flush();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ network: 'mainnet' })); stop();
  });

  it('Rabet does not reuse a prior network after a provider-declared refresh error', async () => {
    const { api, handlers, adapter } = rabet(); await adapter.connect();
    api.getNetwork.mockResolvedValueOnce({ error: 'network unavailable' });
    const listener = jest.fn(); const stop = adapter.subscribe(listener);
    handlers.get('accountChanged')?.(); await flush();
    expect(listener).toHaveBeenLastCalledWith(null); stop();
  });
});


describe('subscription cleanup and reentrant consumers', () => {
  it('does not attach or persist a superseded connection when a subscriber switches wallets', async () => {
    const first = fake('freighter'); const next = fake('rabet'); const storage = memory();
    const manager = new WalletManager([first.adapter, next.adapter], 'testnet', storage);
    let switched: Promise<unknown> | undefined;
    manager.subscribe(state => {
      if (state.status === 'connected' && state.walletId === 'freighter') {
        switched = manager.connect('rabet');
      }
    });
    await manager.connect('freighter'); await switched;
    expect(first.adapter.subscribe).not.toHaveBeenCalled();
    expect(manager.getState().walletId).toBe('rabet');
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBe('rabet'); manager.dispose();
  });

  it('cleans a subscription installed during a synchronous disconnect callback', async () => {
    const { adapter, cleanup } = fake();
    const manager = new WalletManager([adapter], 'testnet', memory());
    let closing: Promise<void> | undefined;
    adapter.subscribe.mockImplementation(() => {
      closing = manager.disconnect();
      return cleanup;
    });
    await manager.connect('freighter'); await closing;
    expect(manager.getState().status).toBe('disconnected');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('fails closed when subscription startup throws a non-Error value', async () => {
    const { adapter } = fake(); adapter.subscribe.mockImplementation(() => { throw 'bridge unavailable'; });
    const storage = memory(); const manager = new WalletManager([adapter], 'testnet', storage);
    expect(await manager.connect('freighter')).toMatchObject({ status: 'error', address: null, error: 'Wallet change monitoring failed.' });
    expect(storage.getItem(LAST_WALLET_STORAGE_KEY)).toBeNull();
  });

  it('ignores a stale disconnect rejection after a new wallet connects', async () => {
    const first = fake('freighter'); const next = fake('rabet');
    const pending = deferred<undefined>(); first.adapter.disconnect.mockImplementation(() => pending.promise);
    const manager = new WalletManager([first.adapter, next.adapter], 'testnet', memory());
    await manager.connect('freighter'); const closing = manager.disconnect(); await manager.connect('rabet');
    pending.reject(new Error('old bridge failed')); await closing;
    expect(manager.getState()).toMatchObject({ status: 'connected', walletId: 'rabet', error: undefined }); manager.dispose();
  });

  it('removes both Rabet handlers when the second registration fails', async () => {
    const { adapter, api, handlers } = rabet(); await adapter.connect();
    api.on.mockImplementation((event, callback) => {
      handlers.set(event, callback);
      if (event === 'networkChanged') throw new Error('registration failed');
    });
    expect(() => adapter.subscribe(jest.fn())).toThrow('registration failed');
    expect(api.off).toHaveBeenCalledTimes(2); expect(handlers.size).toBe(0);
  });

  it('Rabet tries both handler removals even if off throws', async () => {
    const { adapter, api, handlers } = rabet(); await adapter.connect();
    api.off.mockImplementation(() => { throw new Error('off failed'); });
    const listener = jest.fn(); const stop = adapter.subscribe(listener); stop(); stop();
    handlers.get('networkChanged')?.('mainnet'); handlers.get('accountChanged')?.();
    await flush(); expect(api.off).toHaveBeenCalledTimes(2); expect(listener).not.toHaveBeenCalled();
  });

  it('Rabet does not accept an address accompanied by a provider error', async () => {
    const { adapter, api, handlers } = rabet(); await adapter.connect();
    api.connect.mockResolvedValueOnce({ publicKey: session.address, error: 'account permission revoked' });
    const listener = jest.fn(); const stop = adapter.subscribe(listener);
    handlers.get('accountChanged')?.(); await flush();
    expect(listener).toHaveBeenLastCalledWith(null); expect(api.getNetwork).toHaveBeenCalledTimes(1); stop();
  });

  it('Rabet ignores a rejected refresh once its subscription is stopped', async () => {
    const { adapter, api, handlers } = rabet(); await adapter.connect();
    const pending = deferred<{ publicKey: string }>(); api.connect.mockImplementation(() => pending.promise);
    const listener = jest.fn(); const stop = adapter.subscribe(listener);
    handlers.get('accountChanged')?.(); stop(); pending.reject(new Error('late rejection')); await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('Freighter fallback emits the initial locked state and serializes slow polls', async () => {
    jest.useFakeTimers();
    try {
      const api = freighter(); api.getAddress.mockResolvedValueOnce({ address: '' });
      const adapter = new FreighterWalletAdapter(() => api, 10); const listener = jest.fn();
      const stop = adapter.subscribe(listener); await flush();
      expect(listener).toHaveBeenCalledWith(null);
      const pending = deferred<{ address: string }>(); api.getAddress.mockImplementation(() => pending.promise);
      await jest.advanceTimersByTimeAsync(45);
      expect(api.getAddress).toHaveBeenCalledTimes(2);
      pending.resolve({ address: session.address }); await flush();
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining(session)); stop();
    } finally { jest.useRealTimers(); }
  });
});

describe('deterministic model-based exercise of the actual WalletManager', () => {
  it('matches the independent lifecycle oracle for all 4,096 four-action sequences', async () => {
    // Unlike an arithmetic-only model, each action invokes the production
    // WalletManager. The oracle tracks the externally specified UI contract.
    const actions = ['freighter', 'rabet', 'disconnect', 'testnet', 'mainnet', 'expect-testnet', 'expect-mainnet', 'lost'] as const;
    for (let seed = 0; seed < 4096; seed++) {
      const callbacks = new Map<WalletId, WalletChangeListener>();
      const adapters: WalletAdapter[] = (['freighter', 'rabet'] as const).map(id => ({
        id, label: id, installUrl: 'https://example.test/wallet',
        isInstalled: async () => true, connect: async () => session,
        restore: async () => null, disconnect: async () => undefined,
        subscribe: callback => { callbacks.set(id, callback); return () => { callbacks.delete(id); }; },
      }));
      const storage = memory(); const manager = new WalletManager(adapters, 'testnet', storage);
      let active: WalletId | null = null;
      let walletId: WalletId | null = null;
      let address: string | null = null;
      let network: 'testnet' | 'mainnet' | 'unknown' = 'unknown';
      let expected: 'testnet' | 'mainnet' = 'testnet';
      let preference: WalletId | null = null;
      let code = seed;
      const history: string[] = [];
      try {
        for (let step = 0; step < 4; step++) {
          const action = actions[code % actions.length]; code = Math.floor(code / actions.length); history.push(action);
          if (action === 'freighter' || action === 'rabet') {
            await manager.connect(action);
            active = action; walletId = action; preference = action; address = session.address; network = 'testnet';
          } else if (action === 'disconnect') {
            await manager.disconnect();
            active = null; walletId = null; preference = null; address = null; network = 'unknown';
          } else if (action === 'expect-testnet' || action === 'expect-mainnet') {
            expected = action === 'expect-testnet' ? 'testnet' : 'mainnet'; manager.setExpectedNetwork(expected);
          } else if (active && action === 'lost') {
            callbacks.get(active)?.(null); address = null; network = 'unknown';
          } else if (active && (action === 'testnet' || action === 'mainnet')) {
            callbacks.get(active)?.({ address: session.address, network: action }); address = session.address; network = action;
          }
          const wanted = { walletId, address, walletNetwork: network, expectedNetwork: expected,
            status: address === null ? 'disconnected' : network === expected ? 'connected' : 'network-mismatch' };
          const state = manager.getState();
          for (const [key, value] of Object.entries(wanted)) {
            if (state[key as keyof typeof state] !== value) throw new Error(`seed=${seed} trace=${history.join(' -> ')} field=${key}: expected ${value}, got ${state[key as keyof typeof state]}`);
          }
          if (storage.getItem(LAST_WALLET_STORAGE_KEY) !== preference) throw new Error(`seed=${seed}: unexpected persisted choice`);
        }
      } finally { manager.dispose(); }
      if (callbacks.size !== 0) throw new Error(`seed=${seed}: leaked subscription`);
    }
  }, 30000);
});
