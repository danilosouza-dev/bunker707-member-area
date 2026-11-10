# bunker-licensing (Emissor)

O nosso serviço que emite e confere licenças do produto licenciado (`docs/32-produto-licenciado.md`, §10 e §11.2).
Nunca vai na imagem do comprador: o `.dockerignore` da raiz tira `services/`, e a guarda
`tests/licenca-sem-emissor.guard.test.mjs` falha se código de assinatura entrar em `src/`.

## O que já existe (10/11/2026)

- `src/signing.ts`: assina o certificado da chave de emissão (com a raiz) e a licença (com a chave de emissão),
  no formato `BKL1` que o Verificador do produto confere (`src/server/licensing/artifact.ts`).
- `src/keys.ts`: gera chaves Ed25519 e as guarda só cifradas (PKCS#8 com AES-256 e senha de 16 ou mais caracteres).
- `bin/chaves.ts`: a ferramenta da cerimônia das chaves (abaixo).
- O vetor fixo `tests/fixtures/licenca-vetor.json` e `tests/emissor-assinatura.test.mjs` prendem o Emissor e o
  Verificador ao mesmo formato: se um dos lados mudar, o teste fica vermelho.

Ainda não existe: o servidor HTTP (`/v1/activate`, `/v1/check-in`...), o banco próprio, o Painel de licenças e
a fila de pedidos da nossa área. São as próximas peças da fase 1 (`docs/32` §12).

## Cerimônia das chaves (fase 0)

Num computador fora de qualquer servidor, de preferência sem internet. As senhas vão por variável de ambiente,
nunca por argumento. Nenhum arquivo existente é sobrescrito, e os arquivos gravados só o dono lê (0600).

```bash
cd services/bunker-licensing
BUNKER_SENHA_RAIZ='...' node bin/chaves.ts raiz --rid raiz-2026 --saida raiz-2026.pem
BUNKER_SENHA_RAIZ='...' node bin/chaves.ts raiz --rid raiz-reserva --saida raiz-reserva.pem
BUNKER_SENHA_RAIZ='...' BUNKER_SENHA_EMISSAO='...' node bin/chaves.ts emissao --raiz raiz-2026.pem --rid raiz-2026 --kid emissao-2026-11 --dias 400 --saida emissao-2026-11.pem
```

- As duas raízes imprimem `{rid, publicKey}`: as duas vão juntas, como lista JSON, para `BUNKER_LICENSING_ROOTS`
  no build da imagem vendida (com `BUNKER_LICENSING_MODE=enforce`). São públicas.
- Os arquivos das raízes e as senhas delas ficam fora de servidor, em dois lugares, e uma cópia com o depositário
  da continuidade (`docs/32` A23).
- A emissão imprime o certificado assinado pela raiz (público, vai para a configuração do Emissor); o arquivo
  `emissao-*.pem` e a senha dele vão para os segredos do Emissor. Trocar a chave de emissão é rodar `emissao` de
  novo com outro `--kid`: as licenças já emitidas continuam valendo.
