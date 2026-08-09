import { useState } from "react";
import { useTranslation } from "react-i18next";

type ReasonModalProps = {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
};

export function ReasonModal(props: ReasonModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (reason.trim().length === 0) {
      setError(t("reasonModal.reasonRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm(reason.trim());
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
        <textarea
          autoFocus
          className="text-input"
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("reasonModal.placeholder")}
          value={reason}
        />
        {error ? <p style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 8 }}>{error}</p> : null}
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
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
