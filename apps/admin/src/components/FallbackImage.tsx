import { useEffect, useState, type ImgHTMLAttributes } from "react";
import missingProductImage from "../assets/missingProducts.jpg";
import { resolveImageSource } from "../image-source";

export function FallbackImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const normalized = resolveImageSource(typeof src === "string" ? src : null, false, "");
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [normalized]);
  return <img {...props} alt={props.alt ?? ""} onError={normalized && !failed ? () => setFailed(true) : undefined} src={resolveImageSource(normalized, failed, missingProductImage)} />;
}
