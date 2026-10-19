# Origem dos arquivos do Supabase self-hosted

Os arquivos abaixo vem de `docker/` do repositorio [supabase/supabase](https://github.com/supabase/supabase/tree/master/docker) e sao copiados sem alteracao. A `docker-compose.yml` desta pasta e nossa (portas em 127.0.0.1, sem Logflare/Vector, app e Caddy; desde 19/10/2026 Studio e meta no perfil `studio`, fora por padrao, e o gateway sem esperar o Studio), mas as imagens e as variaveis seguem o compose oficial. Unico desvio nos arquivos vendidos (19/10/2026): em `volumes/api/envoy/cds.yaml` o cluster `rest` usa `tcp_health_check` no lugar do `GET /`, que no PostgREST monta o OpenAPI com consultas ao catalogo (~150 ms de banco a cada 5 s, e risco de 503 com o banco ocupado); o `update.sh` baixa o original, entao reaplicar (o teste `infra-compose` acusa).

- Referencia copiada: commit `7425d4930528` de 2026-10-17 (lista de imagens de 2026-10-16 em `docker/versions.md`).
- Arquivos vendidos: `volumes/api/envoy/*`, `volumes/db/*.sql`, `volumes/functions/*`, `volumes/pooler/pooler.exs`.
- Para atualizar: `infra/scripts/update.sh --check` compara as imagens com o upstream e `--apply` reescreve as tags e os arquivos vendidos (docs/20, "Atualizar o stack").
