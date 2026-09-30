import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletProvider } from '../src/context/WalletContext';
import { WalletConnection } from '../src/components/wallet/WalletConnection';
import { WalletManager } from '../src/wallet/manager';
import type { WalletAdapter, WalletSession } from '../src/wallet/types';

const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
function setup(connection: WalletSession = { address, network: 'testnet' }) {
  const adapter: WalletAdapter = {
    id: 'freighter', label: 'Freighter', installUrl: 'https://www.freighter.app/',
    isInstalled: jest.fn(async () => true), connect: jest.fn(async () => connection),
    restore: async () => null, disconnect: jest.fn(async () => undefined), subscribe: () => () => undefined,
  };
  const manager = new WalletManager([adapter], 'testnet');
  const html = () => renderToStaticMarkup(<WalletProvider manager={manager}><WalletConnection /></WalletProvider>);
  return { adapter, manager, html };
}

describe('wallet connection SSR UI integration', () => {
  it('shows explicit connection choices without pretending to be connected', () => {
    const { manager, html } = setup();
    expect(html()).toContain('Connect Freighter'); expect(html()).not.toContain(address); manager.dispose();
  });
  it('shows an accessible install prompt when the extension is absent', async () => {
    const { adapter, manager, html } = setup(); jest.spyOn(adapter, 'isInstalled').mockResolvedValue(false);
    await manager.connect('freighter'); const markup = html();
    expect(markup).toContain('role="alert"'); expect(markup).toContain('href="https://www.freighter.app/"');
    expect(markup).toContain('Install Freighter'); manager.dispose();
  });
  it('shows current account and disconnect after successful connection', async () => {
    const { manager, html } = setup(); await manager.connect('freighter');
    expect(html()).toContain(`title="${address}"`); expect(html()).toContain('Disconnect'); manager.dispose();
  });
  it('renders a clear mismatch warning rather than a normal connected state', async () => {
    const { manager, html } = setup({ address, network: 'mainnet' }); await manager.connect('freighter');
    expect(html()).toContain('role="alert"'); expect(html()).toContain('Switch networks in your wallet'); manager.dispose();
  });
  it('renders custom-passphrase failures without displaying a connected account', async () => {
    const { manager, html } = setup({ address, network: 'testnet', networkPassphrase: 'Standalone Network ; February 2017' });
    await manager.connect('freighter'); expect(html()).toContain('could not be determined'); expect(html()).not.toContain('Disconnect'); manager.dispose();
  });
  it('shows local disconnection and a warning when extension cleanup fails', async () => {
    const { adapter, manager, html } = setup(); jest.spyOn(adapter, 'disconnect').mockRejectedValue(new Error('bridge closed'));
    await manager.connect('freighter'); await manager.disconnect();
    expect(html()).toContain('Local session cleared'); expect(html()).toContain('role="alert"');
    expect(html()).not.toContain(address); expect(html()).toContain('Connect Freighter'); manager.dispose();
  });
});
