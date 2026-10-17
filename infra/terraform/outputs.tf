output "ipv4" {
  description = "IPv4 publico do servidor (registro A na Cloudflare, proxied)."
  value       = hcloud_server.app.ipv4_address
}

output "ipv6" {
  description = "IPv6 publico do servidor (registro AAAA na Cloudflare, proxied)."
  value       = hcloud_server.app.ipv6_address
}

output "firewall_id" {
  description = "Firewall aplicado ao servidor (o mesmo que infra/scripts/hetzner-firewall.sh mantem)."
  value       = hcloud_firewall.principal.id
}

output "volume_device" {
  description = "Dispositivo do volume de dados, quando criado."
  value       = length(hcloud_volume.dados) > 0 ? hcloud_volume.dados[0].linux_device : null
}
