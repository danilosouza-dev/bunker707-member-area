// Chave SSH de deploy derivada do token da Hetzner (HKDF-SHA256 -> Ed25519), em formato OpenSSH.
//
//   node infra/cloud/deploy-key.mjs [--out ~/.ssh/bunker707_deploy] [--print-public]
//
// Por que derivar em vez de guardar: a sessao do Claude na nuvem e descartavel (nada sobrevive entre
// sessoes alem dos segredos do ambiente), e quem tem HCLOUD_TOKEN ja controla o servidor por inteiro
// (pode recria-lo, apaga-lo ou abrir o console). Derivar a chave do token nao cria exposicao nova e
// dispensa guardar mais um segredo. A mesma chave nasce igual em toda sessao enquanto o token for o mesmo;
// se o token for trocado, a chave nova precisa entrar no authorized_keys do servidor antes (docs/20).
// A chave publica pode ser mostrada; a privada nunca sai de ~/.ssh (chmod 600) e nao e impressa.

import { createHash, createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
let outPath = join(homedir(), ".ssh", "bunker707_deploy");
let printPublic = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out") { i += 1; outPath = args[i]; }
  else if (args[i] === "--print-public") printPublic = true;
  else if (args[i] === "-h" || args[i] === "--help") { console.log("uso: node infra/cloud/deploy-key.mjs [--out <arquivo>] [--print-public]"); process.exit(0); }
  else { console.error(`opcao desconhecida: ${args[i]}`); process.exit(2); }
}

const token = (process.env.HCLOUD_TOKEN ?? "").trim();
if (token.length < 32) {
  console.error("HCLOUD_TOKEN ausente ou curto demais (segredo do ambiente da sessao; docs/20, 'Sessao na nuvem').");
  process.exit(1);
}

// ---- derivacao -------------------------------------------------------------------------------
const seed = Buffer.from(hkdfSync("sha256", token, "bunker707-deploy-key-v1", "ssh-ed25519", 32));
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
const pub = spki.subarray(spki.length - 32);

// ---- formato OpenSSH (openssh-key-v1, sem cifra) ------------------------------------------------
const str = (buf) => { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); const len = Buffer.alloc(4); len.writeUInt32BE(b.length); return Buffer.concat([len, b]); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const comment = "bunker707-deploy";
const wirePublic = Buffer.concat([str("ssh-ed25519"), str(pub)]);
const checkint = createHash("sha256").update(seed).digest().readUInt32BE(0);
let priv = Buffer.concat([u32(checkint), u32(checkint), str("ssh-ed25519"), str(pub), str(Buffer.concat([seed, pub])), str(comment)]);
const pad = [];
for (let i = 1; priv.length % 8 !== 0; i += 1) { pad.push(i); priv = Buffer.concat([priv, Buffer.from([i])]); }
const blob = Buffer.concat([Buffer.from("openssh-key-v1\0"), str("none"), str("none"), str(""), u32(1), str(wirePublic), str(priv)]);
const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${blob.toString("base64").replace(/(.{70})/g, "$1\n").replace(/\n?$/, "\n")}-----END OPENSSH PRIVATE KEY-----\n`;
const publicLine = `ssh-ed25519 ${wirePublic.toString("base64")} ${comment}\n`;

mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, pem, { mode: 0o600 });
chmodSync(outPath, 0o600);
writeFileSync(`${outPath}.pub`, publicLine, { mode: 0o644 });
const fingerprint = createHash("sha256").update(wirePublic).digest("base64").replace(/=+$/, "");
if (printPublic) process.stdout.write(publicLine);
else console.error(`Chave de deploy em ${outPath} (SHA256:${fingerprint})${existsSync(outPath) ? "" : " (falhou?)"}`);
