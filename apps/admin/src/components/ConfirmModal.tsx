import { useState } from "react";
import { useTranslation } from "react-i18next";

type ConfirmModalProps = {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

/** Same visual shell as ReasonModal, for confirmations that need a yes/no, not a written reason. */
export function ConfirmModal(props: ConfirmModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("common.genericActionError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reason-modal-backdrop" onClick={props.onCancel}>
      <div className="reason-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{props.title}</h3>
        <p>{props.description}</p>
        {error ? <p className="reason-modal-error">{error}</p> : null}
        <div className="btn-row reason-modal-actions">
          <button className="btn btn-outline" onClick={props.onCancel} type="button">
            {t("common.cancel")}
          </button>
          <button className="btn btn-danger" disabled={submitting} onClick={() => void confirm()} type="button">
            {submitting ? t("common.working") : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
