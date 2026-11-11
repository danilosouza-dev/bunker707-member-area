// O produto vendido nao sobe com o Node carregando arquivo antes dele (docs/32 §7.1, medida 7, e §11.3).
//
// O comprador e dono do compose e pode mandar o Node carregar um arquivo dele antes do produto, pela variavel
// NODE_OPTIONS ou pela linha de comando do conteiner (--require, --import, --loader...). Esse arquivo troca a
// conferencia da assinatura sem tocar na imagem: a revisao de 11/11/2026 fez isso com seis linhas e uma licenca forjada
// passou. Aqui o modo "enforce" confere, na subida, a linha de comando e o NODE_OPTIONS com que o processo nasceu, lidos
// direto de /proc/self/cmdline e /proc/self/environ: o process.env e o process.execArgv o proprio arquivo carregado
// antes consegue limpar. Opcoes de memoria (--max-old-space-size e as outras) continuam aceitas. No modo "off" nada
// daqui roda.
//
// E um obstaculo, nao uma trava: quem altera a imagem, troca o arquivo de entrada do conteiner ou carrega uma biblioteca
// nativa passa por ele. Por isso a assinatura tambem e conferida por codigo embutido no produto (artifact.ts).
//
// Quem chama: src/instrumentation.ts na subida do servidor e, para o caso de a subida ter sido pulada (o NEXT_PHASE de
// build no compose pula o register() do Next), a situacao de cada pedido no servidor de verdade (current-state.ts).
// Sem "server-only" e sem "@/": os testes carregam direto.

import { readFileSync } from "node:fs";
import { licensingMode, type LicensingMode } from "./build-config";

/**
 * As opcoes do Node que carregam ou executam codigo antes do produto, ou abrem o depurador (com ele, qualquer um troca
 * a conferencia em execucao). `name` vale como a opcao exata ou com `=valor`; com `family`, vale para toda opcao que
 * comeca com ele (--inspect-brk, --inspect-port, --env-file-if-exists...).
 */
const FORBIDDEN_OPTIONS: ReadonlyArray<{ name: string; family?: true }> = Object.freeze([
  { name: "-r" },
  { name: "--require" },
  { name: "--import" },
  { name: "--loader" },
  { name: "--experimental-loader" },
  { name: "--inspect", family: true },
  { name: "--debug", family: true },
  // Executar texto em vez do arquivo do produto: `node -e "require('/x/p.cjs'); require('./server.js')"`.
  { name: "-e" },
  { name: "--eval" },
  { name: "-p" },
  { name: "--print" },
  // Arquivos que trazem um NODE_OPTIONS ou opcoes do Node que o /proc nao mostra.
  { name: "--env-file", family: true },
  { name: "--experimental-config-file" },
  { name: "--experimental-default-config-file" },
  // Subir de um retrato da memoria, que pode trazer codigo trocado.
  { name: "--snapshot-blob" },
  { name: "--build-snapshot" }
]);

export type NodeStartProblem = {
  /** Onde a opcao apareceu: na linha de comando do processo ou no NODE_OPTIONS com que ele nasceu. */
  where: "linha_de_comando" | "NODE_OPTIONS";
  /** O nome da opcao (nunca o valor: o caminho do arquivo nao vai para o log). */
  option: string;
};

export type NodeStartCheck = { ok: true } | { ok: false; unreadable: boolean; problems: NodeStartProblem[] };

/** O nome da opcao proibida que este pedaco da linha de comando liga; null se nao liga nenhuma. */
export function forbiddenNodeOption(token: string): string | null {
  for (const option of FORBIDDEN_OPTIONS) {
    if (token === option.name || token.startsWith(`${option.name}=`) || (option.family === true && token.startsWith(option.name))) {
      return option.name;
    }
  }

  return null;
}

/** Separa o NODE_OPTIONS como o Node separa: por espaco, com aspas duplas e a barra invertida para escapar. */
export function splitNodeOptions(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "\\" && index + 1 < value.length) {
      current += value[index + 1];
      started = true;
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(char) && !quoted) {
      if (started) {
        tokens.push(current);
      }

      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }

  if (started) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * As opcoes proibidas na linha de comando (os argumentos separados por NUL, como /proc/self/cmdline os guarda; o
 * primeiro e o executavel) e no NODE_OPTIONS do ambiente com que o processo nasceu (KEY=VALOR separados por NUL, como
 * /proc/self/environ). Toda a linha conta, inclusive depois do arquivo de entrada: o produto nao recebe argumentos.
 */
export function nodeStartProblems(cmdline: string, environ: string): NodeStartProblem[] {
  const problems: NodeStartProblem[] = [];
  const seen = new Set<string>();
  const add = (where: NodeStartProblem["where"], option: string | null) => {
    if (option !== null && !seen.has(`${where}:${option}`)) {
      seen.add(`${where}:${option}`);
      problems.push({ where, option });
    }
  };

  for (const argument of cmdline.split("\0").slice(1)) {
    add("linha_de_comando", forbiddenNodeOption(argument));
  }

  for (const entry of environ.split("\0")) {
    if (entry.startsWith("NODE_OPTIONS=")) {
      for (const token of splitNodeOptions(entry.slice("NODE_OPTIONS=".length))) {
        add("NODE_OPTIONS", forbiddenNodeOption(token));
      }
    }
  }

  return problems;
}

export type NodeStartReader = (path: string) => string;

const readProcFile: NodeStartReader = (path) => readFileSync(path, "latin1");

/**
 * Le /proc/self/cmdline e /proc/self/environ e confere. Sem conseguir ler (outro sistema, /proc escondido, ou alguem
 * fazendo a leitura falhar de proposito), fecha: no modo "enforce" o produto so roda no Linux do conteiner.
 */
export function readNodeStartCheck(read: NodeStartReader = readProcFile): NodeStartCheck {
  let cmdline: string;
  let environ: string;

  try {
    cmdline = String(read("/proc/self/cmdline"));
    environ = String(read("/proc/self/environ"));
  } catch {
    return { ok: false, unreadable: true, problems: [] };
  }

  if (cmdline.length === 0) {
    return { ok: false, unreadable: true, problems: [] };
  }

  const problems = nodeStartProblems(cmdline, environ);
  return problems.length === 0 ? { ok: true } : { ok: false, unreadable: false, problems };
}

/** A frase do log para quem opera o servidor: o que foi achado e o que fazer. Nunca leva o valor das opcoes. */
export function nodeStartRefusalMessage(check: Extract<NodeStartCheck, { ok: false }>): string {
  if (check.unreadable) {
    return "[licenca] A Area Bunker nao sobe: nao foi possivel ler /proc/self/cmdline e /proc/self/environ. O produto roda so no conteiner Linux da instalacao.";
  }

  const found = check.problems.map((problem) => (problem.where === "NODE_OPTIONS" ? `${problem.option} (no NODE_OPTIONS)` : problem.option)).join(", ");
  return (
    `[licenca] A Area Bunker nao sobe com o Node carregando arquivo antes do produto, executando texto ou com o depurador aberto: ${found}. ` +
    "Tire essa opcao do NODE_OPTIONS e do comando do conteiner (compose) e suba de novo. Opcoes de memoria, como --max-old-space-size, continuam aceitas."
  );
}

/** O produto foi recusado na subida (o processo ja saiu, ou devia ter saido). */
export class NodeStartRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeStartRefusedError";
  }
}

export type RefuseNodeStartOptions = {
  /** O modo da licenca (padrao: o do build). So o "enforce" confere. */
  mode?: LicensingMode;
  /** Quem le os arquivos do /proc (os testes passam o deles; sem ele, a conferencia fica na memoria do processo). */
  read?: NodeStartReader;
  log?: (message: string) => void;
  exit?: (code: number) => void;
};

let processCheck: NodeStartCheck | null = null;

/**
 * No modo "enforce", recusa subir quando o Node nasceu com uma opcao proibida: escreve o motivo no log, sai com codigo
 * 1 e, se a saida tiver sido trocada, lanca. A leitura do /proc acontece uma vez por processo (a da subida); as chamadas
 * seguintes so conferem a memoria. No modo "off" nao le nada.
 */
export function refuseUnsafeNodeStart(options: RefuseNodeStartOptions = {}): void {
  if ((options.mode ?? licensingMode()) !== "enforce") {
    return;
  }

  const check = options.read ? readNodeStartCheck(options.read) : (processCheck ??= readNodeStartCheck());

  if (check.ok) {
    return;
  }

  const message = nodeStartRefusalMessage(check);
  (options.log ?? console.error)(message);
  (options.exit ?? process.exit)(1);
  throw new NodeStartRefusedError(message);
}
