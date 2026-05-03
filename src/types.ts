export type NotificationType = 'system' | 'order' | 'message' | 'campaign';
export type Priority = 'low' | 'normal' | 'high';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  priority: Priority;
  createdAt: string;
  readAt?: string;
  deleted?: boolean;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  priority?: Priority;
}

export interface NotificationListQuery {
  userId: string;
  type?: NotificationType;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  statusCode: number;
}

// ============ Weight Record Types (v2) ============

export type WeightPeriod = 'morning' | 'evening';

export interface DailyWeightRecord {
  id: string;
  userId: string;
  date: string;
  period: WeightPeriod;
  weight: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeightRecordWithDiff extends DailyWeightRecord {
  weightDiff?: number | null;
}

export interface CreateWeightRecordInput {
  userId: string;
  date: string;
  period: WeightPeriod;
  weight: number;
  note?: string;
}

export interface WeightRecordQuery {
  userId: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  period?: WeightPeriod;
}

export interface V2WeightStats {
  avgMorningWeight: number | null;
  avgEveningWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  change: number | null;
  avgWeightDiff: number | null;
}