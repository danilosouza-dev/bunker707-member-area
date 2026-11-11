// A cerimonia das chaves do Emissor (docs/32 §10 e D41; docs/20 §8C.8), DENTRO da imagem do Emissor publicada no GHCR.
//
// A imagem do Emissor nao leva o bin/chaves.ts (o Dockerfile do bunker-licensing o deixa de fora de proposito), mas leva
// o codigo que ele usa: src/keys.ts (a chave Ed25519, cifrada com senha em PKCS#8 AES-256) e src/signing.ts (o
// certificado da chave de emissao no formato BKL1). Este arquivo faz o que o `bin/chaves.ts raiz` e o `emissao` fazem,
// com aquele mesmo codigo: o certificado sai exatamente como o Emissor e o Verificador do produto o conferem. A etapa
// cerimonia-licencas (infra/cloud/licencas.sh) o roda no runner do GitHub, num container sem rede, so leitura e sem
// privilegio:
//   docker run --rm -i --network none --read-only --user node -e ... -v <este arquivo>:/cerimonia/cerimonia.mjs:ro \
//       <imagem do Emissor> node /cerimonia/cerimonia.mjs
//
// Entrada (variaveis de ambiente, nunca argumento; a etapa as passa por `-e NOME`, sem o valor na linha de comando):
//   CERIMONIA_ACAO          completa: as duas raizes e a chave de emissao; emissao: so uma chave de emissao nova,
//                           assinada pela raiz que chega cifrada pela entrada (a troca da chave de emissao)
//   CERIMONIA_RID           o rid da raiz que assina (e, na completa, o da raiz nova)
//   CERIMONIA_RID_RESERVA   (completa) o rid da raiz de reserva
//   CERIMONIA_KID           o kid da chave de emissao nova
//   CERIMONIA_DIAS          quantos dias o certificado da emissao vale (1 a 1100; o produto recusa mais)
//   BUNKER_SENHA_RAIZ       a senha que cifra as raizes (derivada do HCLOUD_TOKEN pela etapa)
//   BUNKER_SENHA_EMISSAO    a senha que cifra a chave de emissao (sorteada pela etapa)
//   CERIMONIA_MODULOS       (testes) a pasta com keys e signing; padrao /app/src, o codigo do Emissor na imagem
//   CERIMONIA_EXTENSAO      (testes) a extensao dos dois arquivos; padrao .ts
// Saida: um JSON so, na saida padrao, que a etapa grava num arquivo 0600 e nunca no log:
//   {"raizes":[{"rid","publicKey","pem"}],"emissao":{"kid","rid","pem","certificado":{kid,rid,certificate}}}
// As chaves privadas so saem cifradas (o pem e sempre ENCRYPTED PRIVATE KEY). Erro: uma linha em portugues e codigo 1.

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message) {
  process.stderr.write(`ERRO: ${message}\n`);
  process.exit(1);
}

function id(name) {
  const value = process.env[name] ?? "";
  if (!ID.test(value)) fail(`${name} precisa ser letras minusculas, numeros e hifen (ate 64).`);
  return value;
}

function secret(name) {
  const value = process.env[name] ?? "";
  if (value.length < 16) fail(`${name} precisa ter pelo menos 16 caracteres.`);
  return value;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const base = process.env.CERIMONIA_MODULOS || "/app/src";
const ext = process.env.CERIMONIA_EXTENSAO || ".ts";
let keys;
let signing;
try {
  keys = await import(`${base}/keys${ext}`);
  signing = await import(`${base}/signing${ext}`);
} catch (error) {
  fail(`nao achei o codigo das chaves do Emissor em ${base} (keys${ext} e signing${ext}): ${error instanceof Error ? error.message : String(error)}`);
}
const { exportEncryptedPrivateKey, generateSigningKey, importEncryptedPrivateKey } = keys;
const { LICENSE_FORMAT_VERSION, publicKeyText, signCertificate } = signing;
for (const [nome, valor] of Object.entries({ exportEncryptedPrivateKey, generateSigningKey, importEncryptedPrivateKey, publicKeyText, signCertificate })) {
  if (typeof valor !== "function") fail(`o codigo do Emissor nao tem ${nome}: a imagem mudou e a cerimonia precisa acompanhar.`);
}

const acao = process.env.CERIMONIA_ACAO;
if (acao !== "completa" && acao !== "emissao") fail("CERIMONIA_ACAO precisa ser completa ou emissao.");
const rid = id("CERIMONIA_RID");
const kid = id("CERIMONIA_KID");
const days = Number(process.env.CERIMONIA_DIAS ?? "");
if (!Number.isInteger(days) || days < 1 || days > 1100) fail("CERIMONIA_DIAS precisa ser um numero inteiro de 1 a 1100.");
const rootPassphrase = secret("BUNKER_SENHA_RAIZ");
const emissionPassphrase = secret("BUNKER_SENHA_EMISSAO");

const raizes = [];
let root;
if (acao === "completa") {
  const reserva = id("CERIMONIA_RID_RESERVA");
  if (reserva === rid) fail("a raiz de reserva precisa de outro rid.");
  root = generateSigningKey();
  const backup = generateSigningKey();
  raizes.push({ rid, publicKey: publicKeyText(root), pem: exportEncryptedPrivateKey(root, rootPassphrase) });
  raizes.push({ rid: reserva, publicKey: publicKeyText(backup), pem: exportEncryptedPrivateKey(backup, rootPassphrase) });
} else {
  const pem = await readStdin();
  try {
    root = importEncryptedPrivateKey(pem, rootPassphrase);
  } catch {
    fail("a raiz que chegou pela entrada nao abre com a senha derivada do HCLOUD_TOKEN (o token mudou desde a cerimonia?).");
  }
}

const emission = generateSigningKey();
const start = new Date();
const certificate = signCertificate(root, {
  v: LICENSE_FORMAT_VERSION,
  use: "license",
  kid,
  rid,
  publicKey: publicKeyText(emission),
  notBefore: start.toISOString(),
  notAfter: new Date(start.getTime() + days * DAY_MS).toISOString()
});

process.stdout.write(`${JSON.stringify({
  raizes,
  emissao: {
    kid,
    rid,
    pem: exportEncryptedPrivateKey(emission, emissionPassphrase),
    certificado: { kid, rid, certificate: { segment: certificate.segment, signature: certificate.signature } }
  }
})}\n`);
