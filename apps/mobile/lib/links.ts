// Every URL the app builds. Vehicle ids contain `:`, so they are always percent-encoded.
//
// Shared links are *web* URLs on purpose: a recipient without the app lands on the web map,
// and one with it is taken into the app through the universal-link claim on the same host.
import { WEB_ORIGIN } from "./config";

/** The map with this vehicle selected — what the panel shares. */
export function vehicleShareUrl(id: string): string {
  return `${WEB_ORIGIN}/?v=${encodeURIComponent(id)}`;
}

/** The vehicle's own page — what the detail screen shares. */
export function vehiclePageUrl(id: string): string {
  return `${WEB_ORIGIN}/vehicle/${encodeURIComponent(id)}`;
}
