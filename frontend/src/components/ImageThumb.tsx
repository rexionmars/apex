import { useEffect, useState } from "react";
import { api, type Image } from "@/lib/api";

// Thumbnail that loads the file from disk via the bridge (ImageDataURL).
export function ImageThumb({ image }: { image: Image }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let alive = true;
    api
      .imageDataURL(image.rgbPath)
      .then((url) => alive && setSrc(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [image.rgbPath]);

  return (
    <div className="aspect-square overflow-hidden rounded border border-border bg-secondary/40">
      {src ? (
        <img src={src} className="h-full w-full object-cover" title={image.view || image.source} />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
          …
        </div>
      )}
    </div>
  );
}
