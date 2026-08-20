import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supportedLanguages, type SupportedLanguage } from "../core/language";
import { colors, radius, spacing } from "../theme/tokens";
import { text } from "../theme/typography";
import { changeLanguage } from "./index";
import { reconcileRTL, reloadApp } from "./rtl";

const languageLabels: Record<SupportedLanguage, string> = { ar: "العربية", en: "English" };

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  // null = idle · "reloading" = auto-reload in progress · "manual" = auto-reload unavailable.
  const [restart, setRestart] = useState<"reloading" | "manual" | null>(null);

  async function select(language: SupportedLanguage) {
    if (language === i18n.language || restart === "reloading") return;
    await changeLanguage(language);
    const needsReload = reconcileRTL(language);
    if (!needsReload) return;
    setRestart("reloading");
    // Let the "restarting…" copy paint, then reload. If no reload path is available
    // (e.g. a build without expo-updates), fall back to asking the user to restart manually
    // rather than leaving the UI half-mirrored silently (M-4).
    setTimeout(() => {
      void reloadApp().then((reloaded) => {
        if (!reloaded) setRestart("manual");
      });
    }, 600);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t("common:language")}</Text>
      <View style={styles.optionRow}>
        {supportedLanguages.map((language) => (
          <TouchableOpacity
            disabled={restart === "reloading"}
            key={language}
            onPress={() => void select(language)}
            style={[styles.option, i18n.language === language ? styles.optionActive : null]}
          >
            <Text style={[styles.optionText, i18n.language === language ? styles.optionTextActive : null]}>
              {languageLabels[language]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {restart === "reloading" ? <Text style={styles.restartingText}>{t("common:restartingMessage")}</Text> : null}
      {restart === "manual" ? <Text style={styles.restartingText}>{t("common:restartRequiredBody")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing[3]
  },
  label: {
    ...text("label", "medium"),
    color: colors.textMuted,
    marginBottom: spacing[2]
  },
  optionRow: {
    backgroundColor: colors.surfaceSunk,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing[1],
    padding: spacing[1]
  },
  option: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    paddingVertical: spacing[2]
  },
  optionActive: {
    backgroundColor: colors.primary
  },
  optionText: {
    ...text("bodySm", "semibold"),
    color: colors.textMuted
  },
  optionTextActive: {
    color: colors.textInverse
  },
  restartingText: {
    ...text("caption"),
    color: colors.textMuted,
    marginTop: spacing[2]
  }
});
