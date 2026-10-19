#!/usr/bin/env bash
# Teste de carga da area de membros: alunos virtuais navegando ao mesmo tempo pelo dominio publico (pela
# Cloudflare, como um aluno de verdade), com um aluno e um curso de teste criados so para isso e APAGADOS no
# fim, mesmo com erro ou cancelamento (trap; o passo final do workflow fecha a 22).
#   bash infra/cloud/carga.sh
# Opcoes: VUS (100 alunos ao mesmo tempo), DURACAO (3m no pico, depois de 1 min subindo), PAUSA_MIN e
# PAUSA_MAX (1 e 4 s entre uma pagina e outra: "navegando rapido"). Cada aluno abre home, curso, aula e
# minhas compras, em ciclo. O resultado: tempos por pagina (mediana, p95, maximo), erros e a CPU e a memoria
# do servidor durante o teste. O aluno de teste usa senha derivada do HCLOUD_TOKEN (nunca impressa).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN; install_hcloud; deploy_key

VUS="${VUS:-100}"; DURACAO="${DURACAO:-3m}"; PAUSA_MIN="${PAUSA_MIN:-1}"; PAUSA_MAX="${PAUSA_MAX:-4}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.8.2@sha256:bd6ae8607c0a05d0dc0dc3f5753c464b0929baf083ef0f20b7eed845a3d9e6b4}"
EMAIL="carga@bunker707.test"
[[ "$VUS" =~ ^[0-9]+$ ]] && [ "$VUS" -ge 1 ] && [ "$VUS" -le 500 ] || die "VUS entre 1 e 500: $VUS"
[[ "$DURACAO" =~ ^[0-9]+[sm]$ ]] || die "DURACAO como 90s ou 3m: $DURACAO"
[[ "$PAUSA_MIN" =~ ^[0-9]+$ && "$PAUSA_MAX" =~ ^[0-9]+$ ]] && [ "$PAUSA_MIN" -le "$PAUSA_MAX" ] || die "PAUSA_MIN e PAUSA_MAX em segundos inteiros, MIN <= MAX."

ip=$(server_ip4 "$MEMBROS_NAME"); target="$DEPLOY_USER@$ip"
envf="$REMOTE_DIR/infra/compose/.env"
api="http://127.0.0.1:8000"
psql_remote="cd '$REMOTE_DIR' && docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q"

senha="$WORK_DIR/carga-senha"
node "$CLOUD_DIR/deploy-key.mjs" --secret --info bunker707-carga-v1 --out "$senha" 2>/dev/null
mask "$(cat "$senha")"

# Apaga o aluno e o curso de teste (inicio, para sobra de uma rodada interrompida, e fim, pelo trap).
limpar() {
    local auth_curl uid
    auth_curl=$(remote_auth_curl "$envf")
    rsh "$target" "$psql_remote -c \"delete from public.entitlements where source_event_id like 'carga:%'; delete from public.content_items where id like 'carga-%';\"" >/dev/null || warn "nao apaguei o curso de teste (ids carga-*)"
    uid=$(rsh "$target" "$auth_curl '$api/auth/v1/admin/users?page=1&per_page=1000' | jq -r '.users[]? | select(.email==\"$EMAIL\") | .id' | head -n1") || true
    if [ -n "$uid" ]; then
        rsh "$target" "$auth_curl -X DELETE '$api/auth/v1/admin/users/$uid'" >/dev/null && echo "  aluno de teste apagado" || warn "nao apaguei o aluno de teste $EMAIL ($uid)"
    fi
}

fw_open_ssh "$MEMBROS_NAME"; wait_ssh "$target"
# Depois do fw_open_ssh: o trap dele fecha a 22; este limpa antes de fechar.
trap 'rc=$?; set +e; log "Limpando os dados de teste"; limpar; rm -f "$senha" "$WORK_DIR/carga-usuario.json"; fw_close_all || rc=1; exit $rc' EXIT

log "Dados de teste: aluno $EMAIL e curso carga-curso (2 modulos, 6 aulas)"
limpar
umask 077
python3 -I - "$EMAIL" "$senha" > "$WORK_DIR/carga-usuario.json" <<'PY'
import json, sys
print(json.dumps({"email": sys.argv[1], "password": open(sys.argv[2]).read().strip(), "email_confirm": True,
                  "user_metadata": {"full_name": "Aluno do Teste de Carga"}}))
PY
auth_curl=$(remote_auth_curl "$envf")
uid=$(rsh "$target" "umask 077; f=\$(mktemp); cat > \"\$f\"; $auth_curl -X POST '$api/auth/v1/admin/users' -H 'Content-Type: application/json' --data-binary @\"\$f\" | jq -r '.id'; rm -f \"\$f\"" < "$WORK_DIR/carga-usuario.json")
rm -f "$WORK_DIR/carga-usuario.json"
[[ "$uid" =~ ^[0-9a-f-]{36}$ ]] || die "O Auth nao criou o aluno de teste."
rsh "$target" "$psql_remote -v uid=$uid" < "$CLOUD_DIR/carga-dados.sql"
echo "  aluno $uid com acesso ao curso de teste"

publishable=$(get_env "$target" "$envf" SUPABASE_PUBLISHABLE_KEY)
api_publica=$(get_env "$target" "$envf" SUPABASE_PUBLIC_URL)

log "Medindo o servidor durante o teste (a cada 15 s)"
rsh "$target" "for i in \$(seq 400); do echo \"== \$(date -u +%H:%M:%S) carga \$(cut -d' ' -f1-3 /proc/loadavg) | mem livre \$(free -m | awk '/Mem:/{print \$7}') MB\"; docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}} {{.Name}}' | sort -rn | head -n 5; sleep 15; done" > "$WORK_DIR/carga-servidor.txt" 2>&1 &
medidor=$!

log "k6: $VUS alunos, 1 min subindo, $DURACAO no pico, pausa de $PAUSA_MIN a $PAUSA_MAX s entre paginas"
set +e
docker run --rm -i --network host -v "$CLOUD_DIR:/carga:ro" -v "$WORK_DIR:/saida" \
    -e BASE_URL="https://$APP_DOMAIN" -e API_URL="$api_publica" -e PUBLISHABLE_KEY="$publishable" \
    -e EMAIL="$EMAIL" -e SENHA_ARQUIVO=/saida/carga-senha -e VUS="$VUS" -e DURACAO="$DURACAO" \
    -e PAUSA_MIN="$PAUSA_MIN" -e PAUSA_MAX="$PAUSA_MAX" -u "$(id -u)" \
    "$K6_IMAGE" run --quiet --summary-export /saida/carga-resumo.json /carga/carga.js
k6_rc=$?
set -e
kill "$medidor" 2>/dev/null || true

log "Servidor durante o teste (carga = load average de 1, 5 e 15 min; 2 vCPU)"
grep -E '^==' "$WORK_DIR/carga-servidor.txt" | sed 's/^/  /'
echo "  pico de CPU por container:"
grep -vE '^==' "$WORK_DIR/carga-servidor.txt" | awk '{gsub("%","",$1); if ($1+0 > max[$NF]) max[$NF]=$1+0} END {for (c in max) printf "    %-36s %5.1f%%\n", c, max[c]}' | sort -k2 -rn | head -n 8

log "Resumo"
python3 -I - "$WORK_DIR/carga-resumo.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))["metrics"]
def trend(name):
    v = m.get(name) or {}
    return f"mediana {v.get('med', 0):7.0f} ms | p95 {v.get('p(95)', 0):7.0f} ms | max {v.get('max', 0):7.0f} ms" if v else "sem dados"
for pagina in ("home", "curso", "aula", "compras"):
    print(f"  {pagina:8} {trend('pagina_' + pagina)}")
req = m.get("http_reqs", {}); fail = m.get("http_req_failed", {}); sem = m.get("sem_sessao", {})
print(f"  pedidos: {req.get('count', 0):.0f} ({req.get('rate', 0):.1f}/s) | falhas: {100 * fail.get('value', fail.get('rate', 0)):.2f}% | caiu no login: {sem.get('count', 0):.0f}")
PY
[ "$k6_rc" = "0" ] || die "k6 terminou com $k6_rc (limite de tempo ou de erros estourado; veja o resumo acima)."
