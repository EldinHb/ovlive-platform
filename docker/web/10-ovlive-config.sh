#!/bin/sh
# Runs from nginx's own entrypoint (/docker-entrypoint.d/*.sh) before nginx starts.
set -eu

# The SPA reads window.__OVLIVE_CONFIG__ before it boots (apps/web/app/lib/config.ts).
# Writing it here is what makes the published image deployment-agnostic: Vite inlines
# VITE_API_BASE at build time, so baking it in would mean one image per environment.
#
# API_BASE empty (the default) means "same origin" — this nginx proxies /v1 to the backend
# itself, so the browser never issues a cross-origin request and CORS/WS origin never come
# into play. Set it only when the API is published on a different hostname.
cat > /usr/share/nginx/html/config.js <<EOF
window.__OVLIVE_CONFIG__ = { apiBase: "${API_BASE:-}" };
EOF

# Explicit shell-format argument, not a bare envsubst: nginx's config is full of \$variables
# ($host, $http_upgrade, …) that must reach nginx unexpanded.
# shellcheck disable=SC2016  # the single quotes are the point: envsubst wants the literal name
envsubst '${API_UPSTREAM}' \
    < /etc/nginx/ovlive.conf.template \
    > /etc/nginx/conf.d/default.conf
