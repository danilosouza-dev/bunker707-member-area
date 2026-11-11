# syntax=docker/dockerfile:1
#
# Imagem do app Bunker707 (Next.js em modo standalone), usada na Hetzner e no ensaio local
# (infra/compose/docker-compose.yml). Passo a passo em docs/20-runbook-hetzner.md.
#
#   docker build -t bunker707-app --build-arg NEXT_PUBLIC_SUPABASE_URL=https://api.exemplo.com.br \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... .
#
# As variaveis NEXT_PUBLIC_* entram no JavaScript do navegador na hora do build, por isso sao ARG e nao
# variaveis de runtime. Sao valores publicos (endereco e chave publicavel): nenhum segredo entra na
# imagem, que e publicada no ghcr.io pelo workflow .github/workflows/build-image.yml.
#
# A imagem vendida (docs/32 §11.3) e gerada com a licenca exigida, gravada no codigo do servidor pelo next.config.ts:
#   --build-arg BUNKER_LICENSING_MODE=enforce \
#   --build-arg BUNKER_LICENSING_ROOTS='[{"rid":"...","publicKey":"..."}]' \
#   --build-arg BUNKER_LICENSING_EMISSOR_URL=https://...
# Sem elas, a imagem sai "off" (a nossa escola). Modo digitado errado, ou "enforce" sem raizes validas ou sem o Emissor
# em https, para o build. As tres ficam so no estagio do build: a imagem que roda nao as recebe, e trocar a variavel no
# conteiner depois nao muda nada.
#
# O pacote de uma escola do lote fundador (.github/workflows/pacote-escola.yml; docs/20 §9D.6) grava tambem o endereco
# dela no codigo: --build-arg NEXT_PUBLIC_SITE_URL=https://alunos.escola.com.br. Sem ele, a variavel sai do ambiente
# antes do build (o Next nunca grava o endereco vazio) e a producao continua lendo o endereco ao rodar.

ARG NODE_IMAGE=node:24.11.1-alpine3.22

# ---- dependencias (com devDependencies: o build precisa de TypeScript e Tailwind) -------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts pula o `prepare` do husky (hooks de git nao existem na imagem).
RUN npm ci --ignore-scripts

# ---- build --------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ARG APP_VERSION=dev
ARG BUNKER_LICENSING_MODE
ARG BUNKER_LICENSING_ROOTS
ARG BUNKER_LICENSING_EMISSOR_URL
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NODE_ENV=production \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    APP_VERSION=${APP_VERSION} \
    BUNKER_LICENSING_MODE="${BUNKER_LICENSING_MODE}" \
    BUNKER_LICENSING_ROOTS="${BUNKER_LICENSING_ROOTS}" \
    BUNKER_LICENSING_EMISSOR_URL="${BUNKER_LICENSING_EMISSOR_URL}"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN if [ -z "${NEXT_PUBLIC_SITE_URL:-}" ]; then unset NEXT_PUBLIC_SITE_URL; fi; npm run build

# ---- runtime: so o servidor standalone, estaticos e public, rodando como usuario sem privilegio ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# Mesma rota que o monitor externo usa (src/app/api/health/route.ts). So o processo: nao depende do banco.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.js"]
