import { NotificationService } from '../src/services/notificationService';

describe('Notification Center Service (#782)', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
  });

  it('should list seeded notifications and calculate unread count', () => {
    const all = service.getNotifications();
    expect(all.length).toBe(3);

    const unread = service.getUnreadCount();
    expect(unread).toBe(2);
  });

  it('should filter notifications by category', () => {
    const fundingNotifs = service.getNotifications('FUNDING_MILESTONE');
    expect(fundingNotifs.length).toBe(1);
    expect(fundingNotifs[0].title).toContain('Listing Fully Funded');
  });

  it('should mark a notification as read', () => {
    const all = service.getNotifications();
    const unreadItem = all.find((n) => !n.read)!;

    service.markAsRead(unreadItem.id);
    expect(service.getUnreadCount()).toBe(1);
  });

  it('should mark all notifications as read', () => {
    service.markAllAsRead();
    expect(service.getUnreadCount()).toBe(0);
  });

  it('should add a new notification and notify subscribers', () => {
    let notifiedItemsCount = 0;
    const unsubscribe = service.subscribe((items) => {
      notifiedItemsCount = items.length;
    });

    service.addNotification({
      category: 'SYSTEM_ALERT',
      priority: 'HIGH',
      title: 'Emergency Pause Test',
      message: 'Protocol paused by admin',
    });

    expect(notifiedItemsCount).toBe(4);
    expect(service.getUnreadCount()).toBe(3);

    unsubscribe();
  });

  it('should update and retrieve notification preferences', () => {
    const updated = service.updatePreferences({
      emailEnabled: false,
      categories: {
        DUE_DATE_WARNING: false,
        FUNDING_MILESTONE: true,
        SYSTEM_ALERT: true,
        GOVERNANCE: true,
        REPAYMENT: true,
      },
    });

    expect(updated.emailEnabled).toBe(false);
    expect(updated.categories.DUE_DATE_WARNING).toBe(false);
  });
});
