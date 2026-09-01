// Importing the submodule directly (not the package barrel, which
// re-exports all ~18 icon families) keeps every other family's font file —
// several megabytes, none of it used — out of the bundle.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { iconSize, isRTL } from "./tokens";
import { useTheme } from "./theme-context";

type GlyphName = ComponentProps<typeof Ionicons>["name"];

/**
 * One icon family (Ionicons) for the whole customer surface, so stroke weight
 * and visual language never mix. Each entry's `outline` is the inactive/
 * default glyph and `filled` (when the glyph has one) is used only for the
 * active/selected state — this is how "active differs clearly from inactive"
 * and "orange only for active" are enforced structurally rather than by
 * per-screen convention.
 */
const registry = {
  home: { outline: "home-outline", filled: "home" },
  browse: { outline: "grid-outline", filled: "grid" },
  cart: { outline: "cart-outline", filled: "cart" },
  orders: { outline: "receipt-outline", filled: "receipt" },
  account: { outline: "person-outline", filled: "person" },
  settings: { outline: "settings-outline", filled: "settings" },
  notifications: { outline: "notifications-outline", filled: "notifications" },
  search: { outline: "search-outline" },
  filter: { outline: "options-outline" },
  back: { outline: "arrow-back-outline" },
  forward: { outline: "arrow-forward-outline" },
  chevronBack: { outline: "chevron-back-outline" },
  chevronForward: { outline: "chevron-forward-outline" },
  add: { outline: "add" },
  remove: { outline: "remove" },
  close: { outline: "close" },
  location: { outline: "location-outline", filled: "location" },
  store: { outline: "storefront-outline", filled: "storefront" },
  bag: { outline: "bag-outline", filled: "bag" },
  star: { outline: "star-outline", filled: "star" },
  checkCircle: { outline: "checkmark-circle-outline", filled: "checkmark-circle" },
  checkmark: { outline: "checkmark" },
  alertCircle: { outline: "alert-circle-outline", filled: "alert-circle" },
  closeCircle: { outline: "close-circle-outline", filled: "close-circle" },
  bicycle: { outline: "bicycle-outline", filled: "bicycle" },
  logout: { outline: "log-out-outline" },
  info: { outline: "information-circle-outline", filled: "information-circle" },
  document: { outline: "document-text-outline", filled: "document-text" },
  trash: { outline: "trash-outline", filled: "trash" },
  time: { outline: "time-outline", filled: "time" },
  fastFood: { outline: "fast-food-outline", filled: "fast-food" },
  basket: { outline: "basket-outline", filled: "basket" },
  cube: { outline: "cube-outline", filled: "cube" },
  language: { outline: "language-outline" },
  chatbox: { outline: "chatbox-ellipses-outline" },
  shield: { outline: "shield-checkmark-outline" },
  card: { outline: "card-outline", filled: "card" },
  pin: { outline: "pin-outline", filled: "pin" },
  contrast: { outline: "contrast-outline", filled: "contrast" }
} satisfies Record<string, { outline: GlyphName; filled?: GlyphName }>;

export type IconName = keyof typeof registry;

export function Icon(props: {
  name: IconName;
  active?: boolean;
  size?: keyof typeof iconSize;
  color?: string;
}) {
  const { colors } = useTheme();
  const def: { outline: GlyphName; filled?: GlyphName } = registry[props.name];
  const glyph = props.active && def.filled ? def.filled : def.outline;
  return <Ionicons color={props.color ?? colors.text} name={glyph} size={iconSize[props.size ?? "md"]} />;
}

/** The one back-chevron glyph, already resolved for the current direction. */
export function backIconName(): IconName {
  return isRTL() ? "forward" : "back";
}

export function disclosureIconName(): IconName {
  return isRTL() ? "chevronBack" : "chevronForward";
}
