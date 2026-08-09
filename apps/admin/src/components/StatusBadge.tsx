import { useTranslation } from "react-i18next";

const palette: Record<string, string> = {
  PENDING: "badge-warn",
  PENDING_ASSIGNMENT: "badge-warn",
  PLACED: "badge-warn",
  APPROVED: "badge-good",
  ASSIGNED: "badge-info",
  ACCEPTED: "badge-info",
  PREPARING: "badge-info",
  PICKED_UP: "badge-info",
  ON_THE_WAY: "badge-info",
  READY_FOR_PICKUP: "badge-info",
  DELIVERED: "badge-good",
  ACTIVE: "badge-good",
  ONLINE: "badge-good",
  REJECTED: "badge-danger",
  SUSPENDED: "badge-danger",
  CANCELLED: "badge-danger",
  OFFLINE: "badge-neutral",
  INACTIVE: "badge-neutral"
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const className = palette[status] ?? "badge-neutral";
  return <span className={`badge ${className}`}>{t(`status.${status}`, status.replace(/_/g, " "))}</span>;
}
