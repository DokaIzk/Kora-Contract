import {
  NotificationCategory,
  NotificationItem,
  NotificationPreferences,
} from '../types/notification';

export class NotificationService {
  private notifications: NotificationItem[] = [];
  private listeners: Array<(items: NotificationItem[]) => void> = [];
  private preferences: NotificationPreferences = {
    emailEnabled: true,
    pushEnabled: true,
    categories: {
      DUE_DATE_WARNING: true,
      FUNDING_MILESTONE: true,
      SYSTEM_ALERT: true,
      GOVERNANCE: true,
      REPAYMENT: true,
    },
  };

  constructor() {
    this.seedInitialNotifications();
  }

  private seedInitialNotifications() {
    this.notifications = [
      {
        id: 'notif-1',
        category: 'FUNDING_MILESTONE',
        priority: 'HIGH',
        title: 'Listing Fully Funded',
        message: 'Invoice #104 has reached 100% funding target of $10,000.',
        timestamp: Date.now() - 300000,
        read: false,
        link: '/marketplace/104',
      },
      {
        id: 'notif-2',
        category: 'DUE_DATE_WARNING',
        priority: 'MEDIUM',
        title: 'Payment Due Warning',
        message: 'Invoice #98 repayment is due in 3 days.',
        timestamp: Date.now() - 3600000,
        read: false,
        link: '/invoices/98',
      },
      {
        id: 'notif-3',
        category: 'GOVERNANCE',
        priority: 'LOW',
        title: 'New Parameter Proposal',
        message: 'Proposal #12 to adjust pool reserve ratio is open for voting.',
        timestamp: Date.now() - 86400000,
        read: true,
        link: '/governance/12',
      },
    ];
  }

  public getNotifications(categoryFilter?: NotificationCategory): NotificationItem[] {
    if (!categoryFilter) {
      return [...this.notifications];
    }
    return this.notifications.filter((n) => n.category === categoryFilter);
  }

  public getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  public markAsRead(id: string): void {
    const item = this.notifications.find((n) => n.id === id);
    if (item && !item.read) {
      item.read = true;
      this.notifyListeners();
    }
  }

  public markAllAsRead(): void {
    let changed = false;
    this.notifications.forEach((n) => {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) {
      this.notifyListeners();
    }
  }

  public addNotification(notification: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>): NotificationItem {
    const newItem: NotificationItem = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      read: false,
    };
    this.notifications.unshift(newItem);
    this.notifyListeners();
    return newItem;
  }

  public subscribe(listener: (items: NotificationItem[]) => void): () => void {
    this.listeners.push(listener);
    listener([...this.notifications]);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    const current = [...this.notifications];
    this.listeners.forEach((l) => l(current));
  }

  public getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  public updatePreferences(prefs: Partial<NotificationPreferences>): NotificationPreferences {
    this.preferences = {
      ...this.preferences,
      ...prefs,
      categories: {
        ...this.preferences.categories,
        ...(prefs.categories || {}),
      },
    };
    return this.getPreferences();
  }
}

export const notificationService = new NotificationService();
