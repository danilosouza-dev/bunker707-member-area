# Servidor, firewall e volume da Bunker707 na Hetzner Cloud, como codigo. OPCIONAL e NAO APLICADO:
# `terraform plan` mostra o que seria criado; `terraform apply` so com o ok do produtor no chat (custa
# dinheiro). O mesmo resultado pode ser obtido no painel + infra/scripts/hetzner-firewall.sh; este arquivo
# existe para a infraestrutura ficar registrada e reproduzivel (docs/20-runbook-hetzner.md, "Criar o servidor").

terraform {
  required_version = ">= 1.9"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.70"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# Faixas da Cloudflare, lidas na hora do plan (as mesmas de infra/scripts/cloudflare-ips.sh).
data "http" "cloudflare_ipv4" {
  url = "https://www.cloudflare.com/ips-v4"
}

data "http" "cloudflare_ipv6" {
  url = "https://www.cloudflare.com/ips-v6"
}

locals {
  cloudflare_ipv4 = [for linha in split("\n", chomp(data.http.cloudflare_ipv4.response_body)) : trimspace(linha) if trimspace(linha) != ""]
  cloudflare_ipv6 = [for linha in split("\n", chomp(data.http.cloudflare_ipv6.response_body)) : trimspace(linha) if trimspace(linha) != ""]
  admin_cidr      = can(regex("/", var.admin_ip)) ? var.admin_ip : (can(regex(":", var.admin_ip)) ? "${var.admin_ip}/128" : "${var.admin_ip}/32")
  labels = {
    app      = "bunker707"
    ambiente = var.environment
  }
}

resource "hcloud_ssh_key" "produtor" {
  name       = "${var.name}-produtor"
  public_key = var.ssh_public_key
  labels     = local.labels
}

# Borda da Hetzner (antes do ufw): SSH so do produtor, web so pela Cloudflare, ping para o monitor.
resource "hcloud_firewall" "principal" {
  name   = "${var.name}-fw"
  labels = local.labels

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = tostring(var.ssh_port)
    source_ips  = [local.admin_cidr]
    description = "SSH so do produtor"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = local.cloudflare_ipv4
    description = "HTTP so da Cloudflare (v4)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = local.cloudflare_ipv6
    description = "HTTP so da Cloudflare (v6)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = local.cloudflare_ipv4
    description = "HTTPS so da Cloudflare (v4)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = local.cloudflare_ipv6
    description = "HTTPS so da Cloudflare (v6)"
  }

  rule {
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "ping do monitor"
  }
}

resource "hcloud_server" "app" {
  name         = var.name
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.produtor.id]
  firewall_ids = [hcloud_firewall.principal.id]
  labels       = local.labels

  # Backups da Hetzner custam 20% do servidor; o plano e snapshot manual antes de mudancas grandes e o
  # backup proprio (restic -> Storage Box). Troque para true se preferir pagar a conveniencia.
  backups = false

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # So cria o usuario deploy com a chave; o resto e o infra/scripts/bootstrap.sh.
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    deploy_user    = var.deploy_user
    ssh_public_key = var.ssh_public_key
  })

  lifecycle {
    # Um `terraform destroy` distraido nao pode apagar o banco de producao.
    prevent_destroy = true
  }
}

# Volume separado para dados (opcional, var.data_volume_gb > 0): sobrevive a recriacao do servidor e cresce
# sem trocar de maquina. Montado em /mnt/HC_Volume_<id>; o runbook explica como apontar volumes/ para ele.
resource "hcloud_volume" "dados" {
  count     = var.data_volume_gb > 0 ? 1 : 0
  name      = "${var.name}-dados"
  size      = var.data_volume_gb
  server_id = hcloud_server.app.id
  automount = true
  format    = "ext4"
  labels    = local.labels
}
