#!/usr/bin/env bash
# Plano: que servidores a conta consegue criar hoje, com preco, e a escolha mais barata por papel.
#   bash infra/cloud/plan.sh            (precisa so de HCLOUD_TOKEN; nao cria nada)
# Papel "membros" (app + Supabase): MEMBROS_MIN_RAM_GB (8). Papel "marketing" (Mautic): MARKETING_MIN_RAM_GB (4).
# Forcar um tipo: MEMBROS_TYPE=cx33 MARKETING_TYPE=cx23. Grava a escolha em $GITHUB_OUTPUT quando existir.

. "$(dirname -- "$0")/lib.sh"
need HCLOUD_TOKEN
install_hcloud

hzj server-type list > "$WORK_DIR/server-types.json"
hzj location list > "$WORK_DIR/locations.json" 2>/dev/null || echo '[]' > "$WORK_DIR/locations.json"
python3 -I - "$WORK_DIR/server-types.json" "$LOCATION" "$FALLBACK_LOCATIONS" \
    "${MEMBROS_MIN_RAM_GB:-8}" "${MARKETING_MIN_RAM_GB:-4}" "${MEMBROS_TYPE:-}" "${MARKETING_TYPE:-}" "${SKIP_MARKETING:-}" <<'PY'
import json, os, sys
types = json.load(open(sys.argv[1]))
preferred, fallbacks = sys.argv[2], sys.argv[3].split()
min_ram = {"membros": float(sys.argv[4]), "marketing": float(sys.argv[5])}
forced = {"membros": sys.argv[6], "marketing": sys.argv[7]}
skip_marketing = sys.argv[8] not in ("", "0", "false")
locations = [preferred] + [l for l in fallbacks if l != preferred]

def price_at(t, loc):
    for p in t.get("prices", []):
        if p.get("location") == loc:
            m = p.get("price_monthly", {})
            try:
                return float(m.get("net") or m.get("gross"))
            except (TypeError, ValueError):
                return None
    return None

def available_at(t, loc):
    # A API nova traz a disponibilidade por location dentro do tipo; sem o campo, assume-se possivel e o
    # provision tenta criar (a API recusa com resource_unavailable e o script passa ao proximo).
    for key in ("locations", "availability"):
        for entry in t.get(key, []) or []:
            name = entry.get("name") if isinstance(entry, dict) else entry
            if name == loc and isinstance(entry, dict):
                for k, v in entry.items():
                    if "avail" in k and isinstance(v, bool):
                        return v
    return None

rows = []
for t in types:
    if t.get("deprecated") or t.get("architecture") not in ("x86", None):
        continue
    for loc in locations:
        price = price_at(t, loc)
        if price is None:
            continue
        rows.append((t["name"], loc, t.get("cores"), t.get("memory"), t.get("disk"), t.get("cpu_type"), price, available_at(t, loc)))

print(f"{'tipo':8} {'local':6} {'vcpu':>4} {'ram':>5} {'disco':>6} {'cpu':9} {'EUR/mes':>8} disponivel")
for name, loc, cores, mem, disk, cpu, price, avail in sorted(rows, key=lambda r: (r[6], r[0], r[1])):
    print(f"{name:8} {loc:6} {cores:>4} {mem:>5} {disk:>6} {str(cpu):9} {price:>8.2f} {'?' if avail is None else ('sim' if avail else 'nao')}")

choice = {}
for role in (["membros"] if skip_marketing else ["membros", "marketing"]):
    candidates = [r for r in rows if r[3] >= min_ram[role] and r[7] is not False and (not forced[role] or r[0] == forced[role])]
    candidates.sort(key=lambda r: (r[6], locations.index(r[1])))
    if not candidates:
        print(f"\nNenhum tipo com >= {min_ram[role]} GB para '{role}'" + (f" (forcado: {forced[role]})" if forced[role] else ""))
        sys.exit(1)
    best = candidates[0]
    choice[role] = best
    print(f"\n{role}: {best[0]} em {best[1]} ({best[2]} vCPU, {best[3]} GB, {best[4]} GB disco) por EUR {best[6]:.2f}/mes (+ IPv4)")
total = sum(c[6] for c in choice.values())
print(f"\nTotal estimado dos servidores: EUR {total:.2f}/mes sem IVA, mais IPv4 (EUR 0,50 cada) e Storage Box bx11 (EUR 3,20).")
if skip_marketing:
    print("SKIP_MARKETING: o Mautic vai no mesmo servidor do app (infra/mautic/compose.colocado.yml).")
out = os.environ.get("GITHUB_OUTPUT")
if out:
    with open(out, "a") as fh:
        for role, c in choice.items():
            fh.write(f"{role}_type={c[0]}\n{role}_location={c[1]}\n")
with open(os.path.join(os.path.dirname(sys.argv[1]), "plan.env"), "w") as fh:
    for role, c in choice.items():
        fh.write(f"{role.upper()}_TYPE={c[0]}\n{role.upper()}_LOCATION={c[1]}\n")
PY
echo
echo "Storage Box (backup):"
hzj storage-box-type list 2>/dev/null | jq -r '.[] | "  \(.name): \(.size/1024/1024/1024|floor) GB, EUR \(.prices[0].price_monthly.net // .prices[0].price_monthly.gross // "?")/mes"' 2>/dev/null || echo "  (lista de tipos indisponivel por aqui; bx11 = 1 TB)"
