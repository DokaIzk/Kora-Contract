export type NotificationCategory =
  | 'DUE_DATE_WARNING'
  | 'FUNDING_MILESTONE'
  | 'SYSTEM_ALERT'
  | 'GOVERNANCE'
  | 'REPAYMENT';

export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  categories: Record<NotificationCategory, boolean>;
}
