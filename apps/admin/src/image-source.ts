export function resolveImageSource(remoteUrl: string | null | undefined, failed: boolean, fallbackUrl: string): string {
  const normalized = remoteUrl?.trim();
  if (!normalized || failed || /\s/.test(normalized)) return fallbackUrl;
  try {
    const url = new URL(normalized);
    return ["https:", "http:", "blob:"].includes(url.protocol) ? normalized : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}
