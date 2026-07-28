// Runtime configuration, read by app/lib/config.ts before the app boots.
//
// This file is a placeholder for local development: the production nginx image overwrites it
// on every container start (docker/web/10-ovlive-config.sh), which is what lets one published
// image serve any deployment without a rebuild. Leaving apiBase unset here makes the dev SPA
// fall back to VITE_API_BASE / http://127.0.0.1:8080.
window.__OVLIVE_CONFIG__ = {};
