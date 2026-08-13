FROM golang:1.26-bookworm AS builder

ARG CLIPROXY_COMMIT=09da52ad509e2c18e7b9540db3b98c2214c280aa

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone https://github.com/router-for-me/CLIProxyAPI.git . \
  && git checkout "${CLIPROXY_COMMIT}"

COPY pinned-bunker-auth.patch /tmp/pinned-bunker-auth.patch
RUN git apply --check /tmp/pinned-bunker-auth.patch \
  && git apply /tmp/pinned-bunker-auth.patch \
  && go mod download \
  && CGO_ENABLED=1 GOOS=linux go build \
    -buildvcs=false \
    -ldflags="-s -w -X 'main.Version=bunker-ai-lb' -X 'main.Commit=${CLIPROXY_COMMIT}'" \
    -o /out/bunker-ai-gateway ./cmd/server/

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 bunker \
  && mkdir -p /app /data/auth \
  && chown -R bunker:bunker /app /data

COPY --from=builder /out/bunker-ai-gateway /app/bunker-ai-gateway
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod 0555 /app/bunker-ai-gateway /app/entrypoint.sh

USER bunker
WORKDIR /app
VOLUME ["/data/auth"]
EXPOSE 8317

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent --output /dev/null --header "Authorization: Bearer ${BUNKER_AI_GATEWAY_API_KEY}" "http://127.0.0.1:8317/v1/models" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
