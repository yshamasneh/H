import type { ReactNode } from "react";

/**
 * A labelled control with an optional hint and inline error, in the console's existing form idiom.
 * The label wraps the control so it is associated with it without id bookkeeping.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children
}: {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className} style={{ display: "block" }}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint" style={{ display: "block" }}>{hint}</span> : null}
      {error ? <span className="field-error" style={{ display: "block" }}>{error}</span> : null}
    </label>
  );
}
