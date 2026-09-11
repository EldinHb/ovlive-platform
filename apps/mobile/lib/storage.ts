// Synchronous key-value store, the mobile counterpart of the web's localStorage calls in
// apps/web/app/lib/config.ts. MMKV is synchronous, which is the point: the settings hooks keep
// the web's `useState(() => getSaved…())` shape, so there is no flash of defaults on launch
// while an async store hydrates. Same key names as the web, so the two stay comparable.
import { createMMKV } from "react-native-mmkv";

const kv = createMMKV({ id: "ovlive" });

export function getItem(key: string): string | null {
  try {
    return kv.getString(key) ?? null;
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string) {
  try {
    kv.set(key, value);
  } catch {}
}

export function removeItem(key: string) {
  try {
    kv.remove(key);
  } catch {}
}
