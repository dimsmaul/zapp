FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY zapp/apps/web/package.json zapp/apps/web/bun.lock ./
RUN bun install --frozen-lockfile
COPY zapp/apps/web/ ./
RUN bun run build

FROM nginx:stable-alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
