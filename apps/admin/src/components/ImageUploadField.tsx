import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { validateImageFile } from "../image-upload";
import { FallbackImage } from "./FallbackImage";

export function ImageUploadField(props: {
  currentUrl?: string | null;
  selection: File | null | undefined;
  disabled?: boolean;
  progress?: number | null;
  onChange: (file: File | null) => void;
  /** Overrides for a non-product image target; default text reads "product" throughout. */
  previewAlt?: string;
  removeConfirmMessage?: string;
}) {
  const { t } = useTranslation();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!(props.selection instanceof File)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(props.selection);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [props.selection]);

  const displayedUrl = props.selection === null ? null : previewUrl ?? props.currentUrl;
  const disabled = props.disabled || props.progress !== null && props.progress !== undefined;
  return (
    <div className="image-upload-field">
      <FallbackImage
        alt={props.previewAlt ?? t("catalogue.imagePreviewAlt")}
        className="image-upload-preview"
        src={displayedUrl ?? undefined}
      />
      <div className="filters-row" style={{ margin: 0 }}>
        <label className={`btn btn-outline btn-sm${disabled ? " disabled" : ""}`}>
          {displayedUrl ? t("catalogue.changeImage") : t("catalogue.addImage")}
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const validation = validateImageFile(file);
              if (validation) {
                setError(validation === "type" ? t("catalogue.imageTypeError") : t("catalogue.imageSizeError"));
                return;
              }
              setError(null);
              props.onChange(file);
            }}
            type="file"
          />
        </label>
        {displayedUrl ? (
          <button
            className="btn btn-danger btn-sm"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(props.removeConfirmMessage ?? t("catalogue.removeImageConfirm"))) props.onChange(null);
            }}
            type="button"
          >
            {t("catalogue.removeImage")}
          </button>
        ) : null}
      </div>
      {props.progress !== null && props.progress !== undefined ? (
        <div className="image-upload-progress" aria-live="polite">
          <progress max={100} value={props.progress} /> {t("catalogue.uploadProgress", { percent: props.progress })}
        </div>
      ) : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}
