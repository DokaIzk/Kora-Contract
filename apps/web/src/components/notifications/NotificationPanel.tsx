import React from 'react';
import { useNotifications } from '../../context/NotificationContext';
import { NotificationCategory } from '../../types/notification';

const CATEGORIES: Array<{ key?: NotificationCategory; label: string }> = [
  { label: 'All' },
  { key: 'FUNDING_MILESTONE', label: 'Funding' },
  { key: 'DUE_DATE_WARNING', label: 'Due Dates' },
  { key: 'GOVERNANCE', label: 'Governance' },
  { key: 'SYSTEM_ALERT', label: 'System' },
];

export const NotificationPanel: React.FC = () => {
  const {
    notifications,
    unreadCount,
    categoryFilter,
    setCategoryFilter,
    markAsRead,
    markAllAsRead,
    isOpen,
    setIsOpen,
  } = useNotifications();

  if (!isOpen) return null;

  return (
    <div className="notification-panel-overlay fixed inset-0 z-50 overflow-hidden bg-gray-500 bg-opacity-75 flex justify-end">
      <div className="notification-panel relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-indigo-600 text-white">
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-semibold">Notification Center</h2>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                {unreadCount} unread
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-white hover:text-gray-200 focus:outline-none text-xl font-bold"
            aria-label="Close Notification Panel"
          >
            ×
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex border-b border-gray-200 overflow-x-auto p-2 bg-gray-50 space-x-1">
          {CATEGORIES.map((cat) => {
            const isActive = categoryFilter === cat.key;
            return (
              <button
                key={cat.label}
                onClick={() => setCategoryFilter(cat.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap ${
                  isActive ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Action bar */}
        {unreadCount > 0 && (
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex justify-end">
            <button
              onClick={markAllAsRead}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Mark all as read
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No notifications available.</div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                onClick={() => markAsRead(item.id)}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  item.read ? 'bg-white text-gray-600' : 'bg-indigo-50/50 text-gray-900 border-l-4 border-indigo-600'
                }`}
              >
                <div className="flex justify-between items-start">
                  <h4 className="text-sm font-semibold">{item.title}</h4>
                  <span className="text-xs text-gray-400">
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{item.message}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                  <span className="uppercase tracking-wider font-medium text-[10px]">
                    {item.category.replace('_', ' ')}
                  </span>
                  {!item.read && <span className="h-2 w-2 rounded-full bg-indigo-600" />}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
