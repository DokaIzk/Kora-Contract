import React, { useState } from 'react';
import { Header } from './Header';
import { Navigation, NavTab } from './Navigation';
import { MobileDrawer } from './MobileDrawer';
import { LocaleProvider } from '../../context/LocaleContext';
import { CurrencyProvider } from '../../context/CurrencyContext';
import { NotificationProvider } from '../../context/NotificationContext';
import { SimulationProvider } from '../../context/SimulationContext';
import { WalletProvider } from '../../context/WalletContext';
import { SimulationPreviewModal } from '../simulation/SimulationPreviewModal';
import { InvoiceSubmissionFlow } from '../flows/InvoiceSubmissionFlow';
import { MarketplaceBrowsingFlow } from '../flows/MarketplaceBrowsingFlow';
import { FundingFlow } from '../flows/FundingFlow';
import { RepaymentFlow } from '../flows/RepaymentFlow';

export const LayoutInner: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('marketplace');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);
  const [selectedFundingListing, setSelectedFundingListing] = useState<{ id: number; amount: number } | null>(null);

  const handleSelectFunding = (id: number, amount: number) => {
    setSelectedFundingListing({ id, amount });
    setActiveTab('funding');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans text-gray-900">
      <Header onToggleMobileDrawer={() => setIsMobileDrawerOpen(true)} />

      <div className="flex flex-1 relative">
        <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full pb-20 md:pb-8">
          {activeTab === 'marketplace' && (
            <MarketplaceBrowsingFlow onSelectListingForFunding={handleSelectFunding} />
          )}

          {activeTab === 'submit' && <InvoiceSubmissionFlow />}

          {activeTab === 'funding' && (
            <FundingFlow
              listingId={selectedFundingListing?.id || 101}
              defaultAmountUsd={selectedFundingListing?.amount || 1000}
            />
          )}

          {activeTab === 'repayment' && <RepaymentFlow />}
        </main>
      </div>

      <MobileDrawer
        isOpen={isMobileDrawerOpen}
        onClose={() => setIsMobileDrawerOpen(false)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <SimulationPreviewModal />
    </div>
  );
};

export const Layout: React.FC = () => (
  <LocaleProvider>
    <CurrencyProvider>
      <NotificationProvider>
        <WalletProvider expectedNetwork="testnet">
          <SimulationProvider>
            <LayoutInner />
          </SimulationProvider>
        </WalletProvider>
      </NotificationProvider>
    </CurrencyProvider>
  </LocaleProvider>
);
