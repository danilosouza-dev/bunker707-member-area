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
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NODE_ENV=production \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

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
