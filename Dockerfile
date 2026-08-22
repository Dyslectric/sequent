# syntax=docker/dockerfile:1

# The build stage runs on the builder's own architecture even when the image
# targets another. Its output is static files that are byte-identical either
# way, so there is nothing to gain from emulating a Node build — only time to
# lose. Only the nginx layer below is genuinely per-architecture.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run test && npm run build

# Precompress instead of gzipping on every request: the bundle is ~3.3 MB and
# never changes once built, so paying for compression once at build time is
# strictly better than paying for it per visitor.
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \
      -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' \) \
      -exec gzip -9 -k {} \;

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
