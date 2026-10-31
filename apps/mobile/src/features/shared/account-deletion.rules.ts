/** Formats the scheduled deletion date for the person's language; never throws. */
export function formatDeletionDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(language === "ar" ? "ar-PS" : "en-GB", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Which roles may delete their own account in the app (store audit H1). Admins are closed by another admin. */
export function canSelfDelete(role: string): boolean {
  return role === "CUSTOMER" || role === "DRIVER" || role === "RESTAURANT";
}
