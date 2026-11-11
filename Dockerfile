# syntax=docker/dockerfile:1
# KEKE game: one image with the game server and the built client on one port (design doc §16).
#   docker build -t keke .
#   docker run --rm -p 2567:2567 keke
# Then open http://localhost:2567. See "Hosting online (VPS)" in README.md.

ARG NODE_IMAGE=node:22-bookworm-slim

# --- build: full install, then build every workspace -------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Manifests first so the dependency layer is cached until package*.json changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# Optional: behind a TLS-intercepting proxy, pass its CA with
#   docker build --secret id=npm_ca,src=/path/to/ca.pem .
# It is only mounted while npm runs and never ends up in the image.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.json ./
COPY maps maps
COPY packages packages
# Client to packages/client/dist; server bundle to packages/server/dist, with maps/*.tmj copied to
# packages/server/dist/maps (scripts/build.mjs), so the runtime stage needs no repo-level maps/.
RUN npm run build \
 && test -f packages/client/dist/index.html \
 && ls packages/server/dist/maps/*.tmj

# --- runtime: production dependencies of the server only, plus the two build outputs -----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=2567
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# The server bundle inlines @keke/shared but loads its npm packages (Colyseus, Express, zod) from
# node_modules, so install the server workspace's production dependencies and nothing else.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --workspace @keke/server --no-audit --no-fund \
 && npm cache clean --force
# Same layout as the repo: the server finds the client at ../../client/dist and the maps at ./maps.
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
# KEKE_DEBUG and KEKE_CONFIG are deliberately not set: debug room messages stay off
# (GET /healthz answers {"ok":true,"debug":false}). Never pass KEKE_DEBUG=1 to a public server.
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "packages/server/dist/index.js"]
