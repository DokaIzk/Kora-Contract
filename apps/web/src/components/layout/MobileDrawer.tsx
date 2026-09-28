import React from 'react';
import { NavTab } from './Navigation';
import { useI18n } from '../../context/LocaleContext';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({
  isOpen,
  onClose,
  activeTab,
  onTabChange,
}) => {
  const { t } = useI18n();

  if (!isOpen) return null;

  const NAV_ITEMS: Array<{ id: NavTab; labelKey: string; icon: string }> = [
    { id: 'marketplace', labelKey: 'nav.marketplace', icon: '🏪' },
    { id: 'submit', labelKey: 'flow.submit_invoice', icon: '📄' },
    { id: 'funding', labelKey: 'nav.funding', icon: '💸' },
    { id: 'repayment', labelKey: 'nav.repayment', icon: '💳' },
  ];

  return (
    <div className="mobile-drawer-overlay fixed inset-0 z-50 bg-gray-900 bg-opacity-75 flex">
      <div className="mobile-drawer relative w-4/5 max-w-xs bg-white h-full shadow-2xl flex flex-col p-4">
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <span className="text-lg font-black text-indigo-600">KORA Menu</span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-2xl font-bold"
            aria-label="Close Mobile Menu"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-2">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  onClose();
                }}
                className={`flex items-center space-x-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors w-full text-left ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1" onClick={onClose} />
    </div>
  );
};
