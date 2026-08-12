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
  const [isRestarting, setIsRestarting] = useState(false);

  async function select(language: SupportedLanguage) {
    if (language === i18n.language || isRestarting) return;
    await changeLanguage(language);
    const needsReload = reconcileRTL(language);
    if (needsReload) {
      setIsRestarting(true);
      setTimeout(() => reloadApp(), 600);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t("common:language")}</Text>
      <View style={styles.optionRow}>
        {supportedLanguages.map((language) => (
          <TouchableOpacity
            disabled={isRestarting}
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
      {isRestarting ? <Text style={styles.restartingText}>{t("common:restartingMessage")}</Text> : null}
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
