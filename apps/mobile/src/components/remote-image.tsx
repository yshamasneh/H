import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Image, type ImageProps, type ImageSourcePropType } from "react-native";

const missingProductImage = require("../../assets/products/missing-products.jpg") as ImageSourcePropType;

type RemoteImageProps = Omit<ImageProps, "source" | "onError"> & {
  uri?: string | null;
  fallbackSource?: ImageSourcePropType;
  /**
   * Rendered instead of an image when the URL is absent or fails to load. Use it where the
   * placeholder is not a picture (the cart's emoji tile); without it the bundled placeholder
   * image is used.
   */
  fallback?: ReactNode;
};

/** Renders an offline-safe fallback for an absent URL and after any remote loading failure. */
export function RemoteImage({ uri, fallbackSource = missingProductImage, fallback, ...props }: RemoteImageProps) {
  const normalizedUri = uri?.trim() || null;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [normalizedUri]);

  if (fallback !== undefined && (!normalizedUri || failed)) return <>{fallback}</>;

  return (
    <Image
      {...props}
      onError={() => setFailed(true)}
      source={!normalizedUri || failed ? fallbackSource : { uri: normalizedUri }}
    />
  );
}

export { missingProductImage };
