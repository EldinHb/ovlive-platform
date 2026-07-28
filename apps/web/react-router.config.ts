import type { Config } from "@react-router/dev/config";

// SPA mode: no server rendering, ships a static client bundle.
export default {
  ssr: false,
} satisfies Config;
