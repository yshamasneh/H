import type { NotificationType } from "../generated/prisma/enums";

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityId: string | null;
  isRead: boolean;
  createdAt: Date;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
