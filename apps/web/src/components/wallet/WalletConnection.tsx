import React from 'react';
import { useWallet } from '../../context/WalletContext';

function shortenAddress(address: string): string {
  if (address.length <= 16) return address;
  return address.slice(0, 8) + '…' + address.slice(-6);
}

export const WalletConnection: React.FC = () => {
  const {
    status,
    walletId,
    address,
    walletNetwork,
    expectedNetwork,
    error,
    installUrl,
    wallets,
    connect,
    disconnect,
  } = useWallet();

  const activeWallet = wallets.find((wallet) => wallet.id === walletId);

  if (status === 'connected' || status === 'network-mismatch') {
    return (
      <section
        className="wallet-connection flex flex-col gap-2"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            {activeWallet?.label ?? walletId}
          </span>
          {address && (
            <code title={address}>
              {shortenAddress(address)}
            </code>
          )}
          <span className="text-sm">{walletNetwork}</span>
          <button
            type="button"
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        </div>

        {status === 'network-mismatch' && (
          <div
            role="alert"
            className="rounded border border-amber-400 bg-amber-50 p-2"
          >
            Wallet is on <strong>{walletNetwork}</strong>, but Kora is using{' '}
            <strong>{expectedNetwork}</strong>. Switch networks in your wallet
            before signing.
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="wallet-connection flex flex-col gap-2"
      aria-live="polite"
    >
      {status === 'install-required' && (
        <div role="alert">
          {error}{' '}
          {installUrl && (
            <a
              href={installUrl}
              target="_blank"
              rel="noreferrer"
            >
              Install {activeWallet?.label ?? 'wallet'}
            </a>
          )}
        </div>
      )}

      {(status === 'error' || (status === 'disconnected' && error)) && (
        <div role="alert">
          {error ?? 'Wallet connection failed.'}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {wallets.map((wallet) => (
          <button
            key={wallet.id}
            type="button"
            disabled={status === 'connecting'}
            aria-busy={
              status === 'connecting' && wallet.id === walletId
            }
            onClick={() => void connect(wallet.id)}
          >
            {status === 'connecting' && wallet.id === walletId
              ? 'Connecting ' + wallet.label + '…'
              : 'Connect ' + wallet.label}
          </button>
        ))}
      </div>
    </section>
  );
};