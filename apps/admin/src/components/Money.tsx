import { formatMinor } from "../money";

/** An amount in minor units, shown as shekels, safe inside right-to-left text. */
export function Money({ minor, signed = false }: { minor: number; signed?: boolean }) {
  const text = formatMinor(minor);
  return (
    <span className={`money${signed && minor < 0 ? " money-negative" : ""}`}>
      {signed && minor > 0 ? `+${text}` : text}
    </span>
  );
}
