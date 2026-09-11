// The marker bitmaps a map currently needs, as the `images` prop of MapLibre's <Images>.
// Baked lazily: callers `ensure` the keys their features will reference, and the map's own
// `onImageMissing` covers anything that slipped through (a race between a new feature and
// the next ensure). Keys never leave the set; the universe is a few hundred (operator, line)
// pairs per tone.
import { useCallback, useMemo, useRef, useState } from "react";
import type { ImagesProps } from "@maplibre/maplibre-react-native";
import { bakeMarker } from "../lib/markerImages";

type Images = ImagesProps["images"];

export function useMarkerImages() {
  const [images, setImages] = useState<Images>({});
  const have = useRef<Images>({});

  const ensure = useCallback((keys: Iterable<string>) => {
    let added: Images | null = null;
    for (const k of keys) {
      if (k in have.current) continue;
      let img;
      try {
        img = bakeMarker(k);
      } catch (e) {
        // Skia unavailable (a build without the module): leave the key to onImageMissing and
        // keep the map alive rather than failing the whole flush.
        if (__DEV__) console.warn("[ovlive] marker bake failed", k, String(e));
        return;
      }
      if (!img) continue;
      added ??= {};
      added[k] = { source: { uri: img.uri, width: img.width, height: img.height } };
    }
    if (added) {
      have.current = { ...have.current, ...added };
      setImages(have.current);
    }
  }, []);

  const onImageMissing = useCallback<NonNullable<ImagesProps["onImageMissing"]>>(
    (e) => {
      ensure([e.nativeEvent.image]);
    },
    [ensure],
  );

  // Stable identity: LiveMap keys its stream effect on this, and a fresh object per render
  // would tear the socket down every time the fleet moves.
  return useMemo(() => ({ images, ensure, onImageMissing }), [images, ensure, onImageMissing]);
}
