import React from 'react';
import { CurrencySwitcher } from '../localization/CurrencySwitcher';
import { LocaleSwitcher } from '../localization/LocaleSwitcher';
import { NotificationCenter } from '../notifications/NotificationCenter';

interface HeaderProps {
  onToggleMobileDrawer: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleMobileDrawer }) => {
  return (
    <header className="app-header sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between">
      {/* Brand & Mobile Hamburger */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onToggleMobileDrawer}
          className="md:hidden p-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 focus:outline-none"
          aria-label="Open Mobile Drawer"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center space-x-2">
          <span className="text-xl font-black text-indigo-600 tracking-tight">KORA</span>
          <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-bold bg-indigo-50 text-indigo-700 rounded-full uppercase">
            Protocol
          </span>
        </div>
      </div>

      {/* Controls: Currency, Locale, Notifications */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        <CurrencySwitcher />
        <LocaleSwitcher />
        <NotificationCenter />
      </div>
    </header>
  );
};
