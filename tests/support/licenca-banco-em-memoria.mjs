// Banco em memória com a interface LicenseStateDb de src/server/licensing/store.ts (docs/32 §11.3): uma linha,
// gravada só com a versão lida, como o adaptador do Supabase (store-db.ts) faz contra o banco de verdade
// (tests/integration/licenca-guardada.test.mjs). Datas são copiadas como Date (a inválida continua inválida).
//
// - `linha`: uma cópia da linha agora (null se não existe);
// - `chamadas`: "read" e "write", na ordem, para provar quem leu e quem gravou;
// - `mexer(patch)`: grava por fora, como outra rodada do tick ou alguém no banco (soma a versão);
// - `antesDeGravar`: chamado dentro de write, antes de conferir a versão (para simular outra gravação no meio).

const copia = (valor) => (valor === null ? null : structuredClone(valor));

export function bancoDaLicenca(vazio, inicial = null, opcoes = {}) {
  let linha = inicial ? { ...vazio, version: 1, ...inicial } : null;
  const chamadas = [];

  const banco = {
    chamadas,
    get linha() {
      return copia(linha);
    },
    mexer(patch) {
      linha = { ...(linha ?? vazio), ...patch, version: (linha?.version ?? 0) + 1 };
    },
    async read() {
      chamadas.push("read");
      return copia(linha);
    },
    async write(patch, versaoLida) {
      chamadas.push("write");
      await opcoes.antesDeGravar?.(banco);

      if (versaoLida === null) {
        if (linha) {
          return null;
        }

        linha = { ...vazio, ...copia(patch), version: 1 };
        return copia(linha);
      }

      if (!linha || linha.version !== versaoLida) {
        return null;
      }

      linha = { ...linha, ...copia(patch), version: versaoLida + 1 };
      return copia(linha);
    }
  };

  return banco;
}

/** Um banco que falha o teste se alguém tentar criá-lo, ler ou gravar (a guarda do modo "off"). */
export function bancoProibido(motivo = "o modo off nunca toca no banco") {
  return () => {
    throw new Error(`Banco criado: ${motivo}.`);
  };
}
