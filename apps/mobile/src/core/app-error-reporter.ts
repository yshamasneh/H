import Constants from "expo-constants";
import { Platform } from "react-native";
import { createErrorReporter } from "./error-reporting";

/**
 * The app's single error reporter (store audit M2). Off unless EXPO_PUBLIC_ERROR_REPORT_URL is set
 * in the EAS environment. See error-reporting.ts for what is (and is never) sent.
 */
export const appErrorReporter = createErrorReporter({
  endpoint: process.env.EXPO_PUBLIC_ERROR_REPORT_URL ?? null,
  appVersion: Constants.expoConfig?.version ?? "unknown",
  platform: Platform.OS,
  send: (endpoint, report) =>
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) })
});

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): GlobalErrorHandler; setGlobalHandler(handler: GlobalErrorHandler): void };

/** Chains onto React Native's global JS error handler; the existing behaviour runs unchanged. */
export function installGlobalErrorReporting(): void {
  if (!appErrorReporter.enabled) return;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    appErrorReporter.report(error, { fatal: Boolean(isFatal), context: "global" });
    previous(error, isFatal);
  });
}
