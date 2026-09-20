/**
 * The driver's consent to background location, and what to do next given it.
 *
 * Google Play requires a prominent in-app disclosure, shown before the system permission prompt,
 * that says what is collected, when, and why, and that the user has to accept. This file holds that
 * decision. disclosureVersion is bumped whenever the disclosure text changes materially, which
 * makes an earlier "accepted" no longer count, so drivers are asked again about the new wording.
 */

export const disclosureVersion = 1;

export type ConsentRecord = { decision: "accepted" | "declined"; version: number; at: string };
export type BackgroundPermission = "granted" | "denied" | "undetermined";

export function parseConsent(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConsentRecord>;
    if (
      (value.decision === "accepted" || value.decision === "declined") &&
      typeof value.version === "number" &&
      typeof value.at === "string"
    ) {
      return { decision: value.decision, version: value.version, at: value.at };
    }
  } catch {
    // A corrupt record is treated as no record: the driver is simply asked again.
  }
  return null;
}

export function serializeConsent(decision: ConsentRecord["decision"], now: Date): string {
  return JSON.stringify({ decision, version: disclosureVersion, at: now.toISOString() } satisfies ConsentRecord);
}

/**
 * What to do when a delivery is active and background tracking would help:
 *
 *   start            the permission is already granted: just track.
 *   disclose         no valid consent yet: show the disclosure, and only then the system prompt.
 *   open-settings    the driver accepted the disclosure but the system permission is not "all the
 *                    time" (Android will not re-ask after a denial): send them to settings.
 *   foreground-only  the driver declined the disclosure: do not nag, keep the foreground map.
 */
export type BackgroundPlan = "start" | "disclose" | "open-settings" | "foreground-only";

export function planBackgroundTracking(input: {
  consent: ConsentRecord | null;
  permission: BackgroundPermission;
}): BackgroundPlan {
  const current = input.consent && input.consent.version === disclosureVersion ? input.consent : null;
  if (input.permission === "granted") return "start";
  if (!current) return "disclose";
  if (current.decision === "declined") return "foreground-only";
  return input.permission === "denied" ? "open-settings" : "disclose";
}
