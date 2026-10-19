#!/usr/bin/env bash
# Instala o Mautic do stack sem passar pelo instalador web (que aceitaria o primeiro visitante como
# administrador): cria o esquema no MySQL e a conta do administrador com os valores do .env.
#   sh infra/mautic/scripts/install.sh
# Idempotente: se o Mautic ja esta instalado, nao faz nada. O compose precisa estar no ar (up -d).
# Rodou com `sh` (dash no Ubuntu)? Volta para o bash: os scripts usam pipefail, arrays e BASH_SOURCE.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

. "$(dirname -- "$0")/_env.sh"

require_env_file
site_url=$(require_env_value MAUTIC_PUBLIC_URL)
db_name=$(env_value MAUTIC_DB_DATABASE mautic)
db_user=$(env_value MAUTIC_DB_USER mautic)
db_pass=$(require_env_value MAUTIC_DB_PASSWORD)
admin_user=$(env_value MAUTIC_ADMIN_USERNAME bunker707)
admin_email=$(require_env_value MAUTIC_ADMIN_EMAIL)
admin_pass=$(require_env_value MAUTIC_ADMIN_PASSWORD)

wait_healthy mautic-db 180
wait_healthy mautic 300

# O console fica em /var/www/html/bin; a imagem trabalha em /var/www/html/docroot.
console() { compose exec -T -u www-data -w /var/www/html mautic php bin/console "$@"; }

# Sempre (instalado ou nao): o TrustMiddleware do Mautic so le trusted_proxies de config/local.php e
# config/parameters_local.php, nao do MAUTIC_CONFIG_PARAMETERS. Sem isso o Mautic ve o IP do Caddy e trata
# a requisicao como http (formularios com action http://). O arquivo fica no volume config (entra no backup).
compose exec -T -u www-data mautic php -r '$p = json_decode(getenv("MAUTIC_CONFIG_PARAMETERS"), true); file_put_contents("/var/www/html/config/parameters_local.php", "<?php\n\$parameters = ".var_export(["trusted_proxies" => $p["trusted_proxies"]], true).";\n");'

# Os bind mounts de media/files e media/images escondem os .htaccess da imagem (anexos sem listagem nem
# script): copiados de volta da imagem a cada execucao.
img=$(compose images -q mautic | head -n1)
for d in files images; do
    docker run --rm --entrypoint cat "$img" "/var/www/html/docroot/media/$d/.htaccess" 2>/dev/null \
        | compose exec -T -u www-data mautic sh -c "cat > /var/www/html/docroot/media/$d/.htaccess" \
        || warn "nao copiei media/$d/.htaccess da imagem"
done

installed() {
    compose exec -T mautic php -r "include('/var/www/html/config/local.php'); exit(!empty(\$parameters['db_driver']) && !empty(\$parameters['site_url']) ? 0 : 1);" >/dev/null 2>&1
}

if installed; then
    log "Mautic ja instalado em $site_url (config/local.php com banco e site_url)."
    exit 0
fi

log "Instalando o Mautic em $site_url (admin: $admin_user <$admin_email>)..."
# Como www-data (dono dos volumes). A senha do banco vai so no argumento do processo filho, nao em log.
console mautic:install --force --no-interaction \
    --db_driver pdo_mysql --db_host mautic-db --db_port 3306 \
    --db_name "$db_name" --db_user "$db_user" --db_password "$db_pass" --db_backup_tables=false \
    --admin_firstname Bunker --admin_lastname 707 \
    --admin_username "$admin_user" --admin_email "$admin_email" --admin_password "$admin_pass" \
    "$site_url"
console cache:clear --no-interaction >/dev/null
installed || die "A instalacao terminou mas config/local.php continua sem banco/site_url. Veja: docker compose logs mautic"
log "Mautic instalado. Login em $site_url/s/login com $admin_user (senha MAUTIC_ADMIN_PASSWORD do .env)."
log "O cron e o worker ja destravam sozinhos (eles esperam a instalacao). Conferir em 1 min: docker compose ps"
