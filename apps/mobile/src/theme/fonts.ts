import { useFonts } from "expo-font";

/**
 * Cairo (Arabic) and Inter (Latin), self-hosted as static TTF instances at
 * regular/600/700 — the same two families as apps/admin, instanced from the
 * upstream variable fonts (see apps/mobile/assets/fonts/OFL.txt) so mobile
 * ships plain static glyphs rather than a variable-font renderer no RN
 * platform reliably supports yet.
 */
export function useAppFonts(): { fontsReady: boolean; fontError: Error | null } {
  const [loaded, error] = useFonts({
    "Cairo-Regular": require("../../assets/fonts/Cairo-Regular.ttf"),
    "Cairo-SemiBold": require("../../assets/fonts/Cairo-SemiBold.ttf"),
    "Cairo-Bold": require("../../assets/fonts/Cairo-Bold.ttf"),
    "Inter-Regular": require("../../assets/fonts/Inter-Regular.ttf"),
    "Inter-SemiBold": require("../../assets/fonts/Inter-SemiBold.ttf"),
    "Inter-Bold": require("../../assets/fonts/Inter-Bold.ttf")
  });
  return { fontsReady: loaded, fontError: error ?? null };
}
