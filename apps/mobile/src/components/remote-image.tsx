import { useEffect, useState } from "react";
import { Image, type ImageProps, type ImageSourcePropType } from "react-native";

const missingProductImage = require("../../assets/products/missingProducts.jpg") as ImageSourcePropType;

type RemoteImageProps = Omit<ImageProps, "source" | "onError"> & {
  uri?: string | null;
  fallbackSource?: ImageSourcePropType;
};

export function displayableImageUri(uri: string | null | undefined): string | null {
  const value = uri?.trim();
  if (!value || /\s/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return ["https:", "http:", "file:", "content:", "blob:"].includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

/** Renders an offline-safe fallback for an absent URL and after any remote loading failure. */
export function RemoteImage({ uri, fallbackSource = missingProductImage, ...props }: RemoteImageProps) {
  const normalizedUri = displayableImageUri(uri);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [normalizedUri]);

  return (
    <Image
      {...props}
      onError={normalizedUri && !failed ? () => setFailed(true) : undefined}
      source={!normalizedUri || failed ? fallbackSource : { uri: normalizedUri }}
    />
  );
}

export { missingProductImage };
