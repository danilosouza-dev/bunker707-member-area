variable "hcloud_token" {
  description = "Token da API da Hetzner Cloud (projeto da Bunker707), com permissao de leitura e escrita. Nunca commitar."
  type        = string
  sensitive   = true
}

variable "name" {
  description = "Nome do servidor e prefixo dos recursos."
  type        = string
  default     = "bunker707-prod"
}

variable "environment" {
  description = "Etiqueta de ambiente nos recursos."
  type        = string
  default     = "producao"
}

variable "server_type" {
  description = "Tipo do servidor (8 GB): cx33 quando houver estoque; cpx32 (AMD compartilhado) ou ccx13 (dedicado) como alternativas."
  type        = string
  default     = "cpx32"
}

variable "location" {
  description = "Datacenter: fsn1 (Falkenstein), nbg1 (Nuremberg) ou hel1 (Helsinki)."
  type        = string
  default     = "fsn1"
}

variable "ssh_public_key" {
  description = "Chave SSH publica do produtor (ssh-ed25519 ...)."
  type        = string
}

variable "admin_ip" {
  description = "IP (ou CIDR) do produtor, unico com acesso SSH."
  type        = string
}

variable "ssh_port" {
  description = "Porta do SSH (igual a SSH_PORT do bootstrap.sh)."
  type        = number
  default     = 22
}

variable "deploy_user" {
  description = "Usuario sem privilegio que opera o stack."
  type        = string
  default     = "deploy"
}

variable "data_volume_gb" {
  description = "Tamanho do volume de dados em GB; 0 = sem volume (usa o disco do servidor)."
  type        = number
  default     = 0
}
