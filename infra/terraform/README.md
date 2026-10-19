# Terraform (opcional, nao aplicado)

**Nota de 18/10/2026: o caminho ativo e `infra/cloud/`**, operado pelo workflow `Infra (Hetzner)` (`.github/workflows/infra.yml`), que cria os dois servidores, firewalls, Storage Box e DNS pela API com a CLI `hcloud` e idempotencia propria, sem estado para guardar (docs/20, secao 4A). Esta pasta fica como referencia do mesmo desenho em Terraform e nao e usada pelo workflow; se um dia for aplicada, usar um `name` diferente de `bunker707-membros` e `bunker707-marketing`: o firewall segue o mesmo padrao `<nome>-fw` nos dois caminhos e os nomes colidiriam.

Servidor Ubuntu 24.04, firewall e volume da Bunker707 na Hetzner Cloud, como codigo. Nada aqui foi aplicado: criar servidor custa dinheiro e depende do ok do produtor e de um token da API que so ele cria.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # preencha token, chave SSH e IP
terraform init
terraform plan                                  # mostra o que seria criado; nao cria nada
# terraform apply                               # so depois do ok no chat
```

Depois do `apply`: `terraform output ipv4`, registros na Cloudflare e `infra/scripts/bootstrap.sh` no servidor (docs/20-runbook-hetzner.md). O estado (`terraform.tfstate`) fica fora do git; quando o ambiente existir, guarde-o num backend remoto ou no Storage Box.
