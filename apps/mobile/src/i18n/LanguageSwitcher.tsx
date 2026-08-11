import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supportedLanguages, type SupportedLanguage } from "../core/language";
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
    marginTop: 12
  },
  label: {
    color: "#64748B",
    fontSize: 12.5,
    fontWeight: "700",
    marginBottom: 8,
    textTransform: "uppercase"
  },
  optionRow: {
    backgroundColor: "#EEF1F8",
    borderRadius: 10,
    flexDirection: "row",
    gap: 4,
    padding: 4
  },
  option: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    paddingVertical: 8
  },
  optionActive: {
    backgroundColor: "#0F766E"
  },
  optionText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700"
  },
  optionTextActive: {
    color: "#FFFFFF"
  },
  restartingText: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 8
  }
});
