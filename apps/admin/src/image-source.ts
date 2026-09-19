export function resolveImageSource(remoteUrl: string | null | undefined, failed: boolean, fallbackUrl: string): string {
  const normalized = remoteUrl?.trim();
  return !normalized || failed ? fallbackUrl : normalized;
}
