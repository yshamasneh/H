import { useTranslation } from "react-i18next";

/**
 * Previous / next for a paginated list. Renders nothing when everything fits on one page, so a
 * short list looks exactly as it did before.
 */
export function Pager({
  page,
  pageSize,
  total,
  onPage
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="pagination-row">
      <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">
        {t("common.previous")}
      </button>
      <span>{t("common.pageOf", { page, pages })}</span>
      <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} type="button">
        {t("common.next")}
      </button>
    </div>
  );
}
