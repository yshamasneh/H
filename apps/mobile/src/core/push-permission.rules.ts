/**
 * Store audit L4: never show the system notification prompt cold. When the OS would still ask
 * (status "undetermined" and it may ask), JOVO first explains why, in the app's language, and only
 * a "Continue" opens the system prompt. "Not now" leaves the OS question unasked, so it can be
 * offered again later. Already granted or permanently denied: no explainer.
 */
export type PushPermissionSnapshot = { granted: boolean; status?: string; canAskAgain?: boolean };
export type PushPermissionPlan = "granted" | "explain-then-ask" | "ask" | "denied";

export function planPushPermission(existing: PushPermissionSnapshot): PushPermissionPlan {
  if (existing.granted) return "granted";
  if (existing.canAskAgain === false) return "denied";
  return existing.status === "undetermined" ? "explain-then-ask" : "ask";
}
