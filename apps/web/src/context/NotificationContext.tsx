import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { NotificationCategory, NotificationItem, NotificationPreferences } from '../types/notification';
import { notificationService } from '../services/notificationService';

interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  categoryFilter?: NotificationCategory;
  setCategoryFilter: (cat?: NotificationCategory) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  preferences: NotificationPreferences;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | undefined>();
  const [preferences, setPreferences] = useState<NotificationPreferences>(notificationService.getPreferences());
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = notificationService.subscribe((items) => {
      setNotifications(items);
    });
    return () => unsubscribe();
  }, []);

  const filteredNotifications = categoryFilter
    ? notifications.filter((n) => n.category === categoryFilter)
    : notifications;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    notificationService.markAsRead(id);
  };

  const markAllAsRead = () => {
    notificationService.markAllAsRead();
  };

  const updatePreferences = (prefs: Partial<NotificationPreferences>) => {
    const updated = notificationService.updatePreferences(prefs);
    setPreferences(updated);
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications: filteredNotifications,
        unreadCount,
        categoryFilter,
        setCategoryFilter,
        markAsRead,
        markAllAsRead,
        preferences,
        updatePreferences,
        isOpen,
        setIsOpen,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
