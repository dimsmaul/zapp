FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY apps/web/package.json apps/web/bun.lock ./
RUN bun install --frozen-lockfile
COPY apps/web/ ./
ARG VITE_ZAPP_VERSION=dev
ENV VITE_ZAPP_VERSION=$VITE_ZAPP_VERSION
RUN bun run build

FROM nginx:stable-alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
