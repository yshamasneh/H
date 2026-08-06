import { Platform } from "react-native";

export const customerTheme = {
  colors: {
    background: "#FFF9F5",
    surface: "#FFFFFF",
    surfaceMuted: "#FFF1E8",
    primary: "#F4511E",
    primaryDark: "#C7350C",
    primarySoft: "#FFE2D5",
    secondary: "#173F35",
    text: "#1E2421",
    textMuted: "#6E7772",
    border: "#EDE7E2",
    success: "#18864B",
    successSoft: "#E2F6EA",
    warning: "#D97706",
    danger: "#C9362B"
  },
  radius: { small: 10, medium: 16, large: 24, pill: 999 },
  shadow: Platform.select({
    web: { boxShadow: "0 12px 36px rgba(40, 30, 20, 0.08)" },
    default: {
      elevation: 4,
      shadowColor: "#3B2C24",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.1,
      shadowRadius: 12
    }
  })
} as const;
