import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "maplibre-gl/dist/maplibre-gl.css";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <title>OVLive — Realtime NL transit</title>
        <Meta />
        <Links />
        {/* Deployment config, rewritten by the container entrypoint. Must be a plain
            blocking script in <head> so window.__OVLIVE_CONFIG__ exists before the bundle
            evaluates app/lib/config.ts. */}
        <script src="/config.js" />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
