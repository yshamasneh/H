import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { chooseAndPrepareImage, type PreparedImage } from "../core/image-upload";
import { colors, radius, spacing } from "../theme/tokens";
import { text } from "../theme/typography";
import { RemoteImage } from "./remote-image";

export function ImageUploadField(props: {
  uri?: string | null;
  disabled?: boolean;
  progress?: number | null;
  onChange: (image: PreparedImage | null) => void;
}) {
  const { t } = useTranslation("common");
  const [choosing, setChoosing] = useState(false);

  async function choose(source: "library" | "camera") {
    setChoosing(true);
    try {
      const result = await chooseAndPrepareImage(source);
      if (result.status === "selected") props.onChange(result.image);
      else if (result.status === "permission-denied") Alert.alert(t("imageUpload.permissionTitle"), t("imageUpload.permissionMessage"));
      else if (result.status === "too-large") Alert.alert(t("imageUpload.invalidTitle"), t("imageUpload.tooLarge"));
    } catch {
      Alert.alert(t("imageUpload.invalidTitle"), t("imageUpload.processingFailed"));
    } finally {
      setChoosing(false);
    }
  }

  const disabled = props.disabled || choosing || props.progress !== null && props.progress !== undefined;
  return (
    <View style={styles.container}>
      <RemoteImage resizeMode="cover" style={styles.preview} uri={props.uri} />
      {props.progress !== null && props.progress !== undefined ? (
        <Text style={styles.status}>{t("imageUpload.uploading", { percent: props.progress })}</Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable disabled={disabled} onPress={() => void choose("library")} style={[styles.button, disabled && styles.disabled]}>
          <Text style={styles.buttonText}>{props.uri ? t("imageUpload.change") : t("imageUpload.add")}</Text>
        </Pressable>
        <Pressable disabled={disabled} onPress={() => void choose("camera")} style={[styles.button, disabled && styles.disabled]}>
          <Text style={styles.buttonText}>{t("imageUpload.camera")}</Text>
        </Pressable>
        {props.uri ? (
          <Pressable
            disabled={disabled}
            onPress={() => Alert.alert(t("imageUpload.removeTitle"), t("imageUpload.removeMessage"), [
              { text: t("cancel"), style: "cancel" },
              { text: t("imageUpload.remove"), style: "destructive", onPress: () => props.onChange(null) }
            ])}
            style={[styles.button, styles.remove, disabled && styles.disabled]}
          >
            <Text style={[styles.buttonText, styles.removeText]}>{t("imageUpload.remove")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  button: { backgroundColor: colors.primarySubtle, borderRadius: radius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  buttonText: { ...text("bodySm", "semibold"), color: colors.primary },
  container: { gap: spacing[2], marginVertical: spacing[2] },
  disabled: { opacity: 0.5 },
  preview: { aspectRatio: 1, backgroundColor: colors.surfaceSunk, borderRadius: radius.md, width: "100%" },
  remove: { backgroundColor: colors.errorSubtle },
  removeText: { color: colors.error },
  status: { ...text("caption", "medium"), color: colors.textMuted }
});
