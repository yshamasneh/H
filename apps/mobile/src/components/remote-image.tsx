import { useEffect, useState } from "react";
import { Image, type ImageProps, type ImageSourcePropType } from "react-native";

const missingProductImage = require("../../assets/products/missing-products.jpg") as ImageSourcePropType;

type RemoteImageProps = Omit<ImageProps, "source" | "onError"> & {
  uri?: string | null;
  fallbackSource?: ImageSourcePropType;
};

/** Renders an offline-safe fallback for an absent URL and after any remote loading failure. */
export function RemoteImage({ uri, fallbackSource = missingProductImage, ...props }: RemoteImageProps) {
  const normalizedUri = uri?.trim() || null;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [normalizedUri]);

  return (
    <Image
      {...props}
      onError={() => setFailed(true)}
      source={!normalizedUri || failed ? fallbackSource : { uri: normalizedUri }}
    />
  );
}

export { missingProductImage };
