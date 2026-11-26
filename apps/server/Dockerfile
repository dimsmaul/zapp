FROM rust:1.93.1-bookworm AS build
WORKDIR /app
COPY zapp/apps/server/Cargo.toml zapp/apps/server/Cargo.lock ./
COPY zapp/apps/server/src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim
COPY --from=build /app/target/release/zapp-backend /usr/local/bin/zapp-backend
ENV ZAPP_BIND_ADDR=0.0.0.0:8080
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/zapp-backend"]
