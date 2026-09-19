import { useEffect, useState, type ImgHTMLAttributes } from "react";
import missingProductImage from "../assets/missing-products.jpg";
import { resolveImageSource } from "../image-source";

export function FallbackImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const normalized = typeof src === "string" && src.trim() ? src : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [normalized]);
  return <img {...props} alt={props.alt ?? ""} onError={() => setFailed(true)} src={resolveImageSource(normalized, failed, missingProductImage)} />;
}
