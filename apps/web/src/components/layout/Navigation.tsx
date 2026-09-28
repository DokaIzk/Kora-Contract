import React from 'react';
import { useI18n } from '../../context/LocaleContext';

export type NavTab = 'marketplace' | 'submit' | 'funding' | 'repayment';

interface NavigationProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activeTab, onTabChange }) => {
  const { t } = useI18n();

  const NAV_ITEMS: Array<{ id: NavTab; labelKey: string; icon: string }> = [
    { id: 'marketplace', labelKey: 'nav.marketplace', icon: '🏪' },
    { id: 'submit', labelKey: 'flow.submit_invoice', icon: '📄' },
    { id: 'funding', labelKey: 'nav.funding', icon: '💸' },
    { id: 'repayment', labelKey: 'nav.repayment', icon: '💳' },
  ];

  return (
    <>
      {/* Desktop Sidebar Navigation */}
      <nav className="hidden md:flex flex-col w-64 bg-gray-50 border-r border-gray-200 p-4 space-y-1 min-h-screen">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">
          Core Flows
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors w-full text-left ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex justify-around p-1 shadow-lg">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg text-[11px] font-medium transition-colors ${
                isActive ? 'text-indigo-600 font-bold' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <span className="text-lg mb-0.5">{item.icon}</span>
              <span className="truncate max-w-[70px]">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
