import { useTranslation } from "react-i18next";

/**
 * Five semantic families, and only one of them is the brand orange.
 *
 * "Attention" is reserved for work that is waiting on a human — a new order, a
 * business awaiting approval, a delivery with no driver. Because nothing else on
 * a queue board is orange, an unhandled order is identifiable by colour alone,
 * before any text is read. Everything already in flight is blue and recedes.
 */
const palette: Record<string, string> = {
  // waiting on someone
  PLACED: "badge-attention",
  PENDING: "badge-attention",
  PENDING_ASSIGNMENT: "badge-attention",

  // in flight
  ACCEPTED: "badge-info",
  PREPARING: "badge-info",
  READY_FOR_PICKUP: "badge-info",
  ASSIGNED: "badge-info",
  PICKED_UP: "badge-info",
  ON_THE_WAY: "badge-info",

  // done, healthy
  DELIVERED: "badge-good",
  APPROVED: "badge-good",
  ACTIVE: "badge-good",
  ONLINE: "badge-good",
  RECEIVED: "badge-good",

  // went wrong
  REJECTED: "badge-danger",
  SUSPENDED: "badge-danger",
  CANCELLED: "badge-danger",
  DELIVERY_FAILED: "badge-danger",
  FAILED: "badge-danger",

  // dormant, not a problem
  OFFLINE: "badge-neutral",
  INACTIVE: "badge-neutral",
  DRAFT: "badge-neutral"
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const className = palette[status] ?? "badge-neutral";
  return <span className={`badge ${className}`}>{t(`status.${status}`, status.replace(/_/g, " "))}</span>;
}
