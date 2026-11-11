import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { assinarLicenca, licencaBase } from "./licenca-de-teste.mjs";

// Um Emissor falso, local, que segue o contrato de fio do Emissor de verdade (bunker-licensing, docs/protocolo.md): as
// rotas POST /v1/preflight, /v1/activate, /v1/check-in e /v1/deactivate, JSON com Content-Type, os campos e os formatos
// de cada pedido, os códigos de erro com o status HTTP de cada um, a Chave de uso único (repetível no mesmo endereço), o
// segredo e a sequência por Instalação, o nonce do pedido DENTRO da licença assinada, a ordem assinada da desativada e
// o limite de duas mudanças por ano. Assina com o dublê de tests/support/licenca-de-teste.mjs (o produto nunca assina).
//
// O teste controla: `emissor.proximas` (respostas forçadas para os próximos pedidos, de qualquer rota ou só da rota em
// `caminho`: status, corpo, cabeçalhos, texto cru, atraso ou nunca responder), `emissor.portas` (o que a conferência inicial diz das portas 80 e 443),
// `emissor.agora` (a hora do Emissor, que anda um segundo por licença assinada) e `emissor.pedidos` (o que chegou).

const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const INSTANCE_ID = /^[A-Za-z0-9_-]{16,64}$/;
const INSTALLATION_ID = /^inst_[0-9a-z]{8,40}$/;
const SECRET = /^bks_[A-Za-z0-9_-]{43}$/;
const SEQUENCE = /^[A-Za-z0-9_-]{16,64}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const DIA = 24 * 60 * 60 * 1000;

const STATUS_DO_ERRO = {
  pedido_invalido: 400,
  tipo_de_conteudo: 415,
  pedido_grande_demais: 413,
  nao_encontrado: 404,
  metodo_nao_permitido: 405,
  chave_invalida: 400,
  chave_vencida: 410,
  chave_usada: 410,
  chave_de_outro_endereco: 409,
  licenca_indisponivel: 403,
  vaga_em_uso: 409,
  endereco_em_uso: 409,
  endereco_ja_largado: 409,
  limite_de_mudancas: 409,
  credencial_invalida: 401,
  limite_de_pedidos: 429,
  indisponivel: 503,
  erro_interno: 500
};

export function statusDoErro(codigo) {
  return STATUS_DO_ERRO[codigo];
}

/** A Chave no formato do Emissor: BKA- e seis grupos de cinco. */
export function chaveDeAtivacao() {
  const simbolos = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const grupos = Array.from({ length: 6 }, () => Array.from(randomBytes(5), (byte) => simbolos[byte % 32]).join(""));
  return `BKA-${grupos.join("-")}`;
}

const sorteio = (bytes) => randomBytes(bytes).toString("base64url");
const idSorteado = (prefixo) => `${prefixo}_${randomBytes(10).toString("hex")}`;

class Recusa extends Error {
  constructor(codigo, extra = {}) {
    super(codigo);
    this.codigo = codigo;
    this.extra = extra;
  }
}

function exigir(condicao, campo) {
  if (!condicao) {
    throw new Recusa("pedido_invalido", { fields: [campo] });
  }
}

/**
 * Sobe o Emissor falso em 127.0.0.1, numa porta livre. `emissao` é a chave de emissão do dublê; `licencas` são as
 * Licenças que existem ({ id: { holder, plan, features, observeUntil, status } }); `chaves` liga cada Chave à Licença.
 */
export async function subirEmissorFalso({ emissao, agora = new Date("2026-11-11T12:00:00.000Z"), links } = {}) {
  const estado = {
    agora: agora.getTime(),
    portas: { ipPublic: false, ports: null },
    pedidos: [],
    proximas: [],
    licencas: new Map(),
    chaves: new Map(),
    instalacoes: new Map(),
    mudancas: new Map(),
    pendentes: new Set()
  };

  function assinar(instalacao, nonce, extra = {}) {
    const licenca = estado.licencas.get(instalacao.licenseId);
    const emitidaEm = new Date(estado.agora);
    estado.agora += 1_000;
    const desativada = instalacao.status !== "active";
    const corpo = licencaBase({
      licenseId: instalacao.licenseId,
      holder: licenca.holder ?? { name: "Escola de Teste Ltda" },
      installation: { id: instalacao.id, host: instalacao.host },
      issuedAt: emitidaEm.toISOString(),
      expiresAt: new Date(emitidaEm.getTime() + 30 * DIA).toISOString(),
      plan: licenca.plan ?? { kind: "annual", validUntil: "2027-11-10T23:59:59-03:00", steps: [] },
      features: licenca.features ?? [{ key: "webinars" }],
      statusSteps: desativada ? [{ degree: "escola_congelada", from: emitidaEm.toISOString(), reason: "desativada" }] : (licenca.statusSteps ?? []),
      delivery: "online",
      ...(licenca.observeUntil ? { observeUntil: licenca.observeUntil } : {}),
      ...(links ? { links } : {}),
      ...(nonce ? { nonce } : {}),
      ...extra
    });
    return assinarLicenca(emissao, corpo);
  }

  function chaveDoPedido(texto) {
    exigir(typeof texto === "string" && texto.length >= 1 && texto.length <= 80, "activationKey");
    const canonica = texto.toUpperCase().replace(/[\s-]/g, "");
    const chave = [...estado.chaves.entries()].find(([valor]) => valor.replace(/-/g, "") === canonica);

    if (!chave) {
      throw new Recusa("chave_invalida");
    }

    return chave[1];
  }

  function hostDoPedido(host) {
    const normalizado = typeof host === "string" ? host.trim().toLowerCase().replace(/\.$/, "") : "";
    exigir(HOST.test(normalizado), "host");
    return normalizado;
  }

  function vaga(chave, host) {
    const licenca = estado.licencas.get(chave.licenseId);

    if (!licenca || licenca.status === "revoked" || licenca.status === "suspended") {
      throw new Recusa("licenca_indisponivel");
    }

    if (chave.usedAt && !(chave.installationId && estado.instalacoes.get(chave.installationId)?.host === host)) {
      throw new Recusa("chave_usada");
    }

    const ativa = [...estado.instalacoes.values()].find((item) => item.licenseId === chave.licenseId && item.status === "active");

    if (ativa && ativa.host !== host) {
      throw new Recusa("vaga_em_uso", { host: ativa.host });
    }

    return ativa ?? null;
  }

  function autenticar(corpo) {
    exigir(typeof corpo.installationId === "string" && INSTALLATION_ID.test(corpo.installationId), "installationId");
    exigir(typeof corpo.secret === "string" && SECRET.test(corpo.secret), "secret");
    const instalacao = estado.instalacoes.get(corpo.installationId);

    if (!instalacao || instalacao.secret !== corpo.secret) {
      throw new Recusa("credencial_invalida");
    }

    return instalacao;
  }

  const rotas = {
    "/v1/preflight": (corpo) => {
      const chave = chaveDoPedido(corpo.activationKey);
      const host = hostDoPedido(corpo.host);
      exigir(corpo.instanceId === undefined || INSTANCE_ID.test(corpo.instanceId), "instanceId");
      const ativa = vaga(chave, host);
      const passou = estado.portas.ipPublic && estado.portas.ports?.["80"] === "aberta" && estado.portas.ports?.["443"] === "aberta";
      return {
        ok: Boolean(passou),
        slot: ativa ? "mesmo_endereco" : "livre",
        ip: "127.0.0.1",
        ipPublic: estado.portas.ipPublic,
        ports: estado.portas.ports,
        reservedUntil: passou ? new Date(estado.agora + 7 * DIA).toISOString() : null
      };
    },
    "/v1/activate": (corpo) => {
      const chave = chaveDoPedido(corpo.activationKey);
      const host = hostDoPedido(corpo.host);
      exigir(typeof corpo.instanceId === "string" && INSTANCE_ID.test(corpo.instanceId), "instanceId");
      exigir(typeof corpo.nonce === "string" && NONCE.test(corpo.nonce), "nonce");
      const ativa = vaga(chave, host);
      const segredo = `bks_${sorteio(32)}`;
      const sequencia = sorteio(16);
      const instalacao = ativa ?? { id: idSorteado("inst"), licenseId: chave.licenseId, host, status: "active" };
      Object.assign(instalacao, { secret: segredo, sequence: sequencia, instanceId: corpo.instanceId, versions: corpo.versions ?? null });
      estado.instalacoes.set(instalacao.id, instalacao);
      chave.usedAt ??= estado.agora;
      chave.installationId = instalacao.id;
      return { installationId: instalacao.id, secret: segredo, sequence: sequencia, license: assinar(instalacao, corpo.nonce) };
    },
    "/v1/check-in": (corpo) => {
      const instalacao = autenticar(corpo);
      hostDoPedido(corpo.host);
      exigir(typeof corpo.nonce === "string" && NONCE.test(corpo.nonce), "nonce");
      exigir(corpo.sequence === undefined || SEQUENCE.test(corpo.sequence), "sequence");
      exigir(corpo.licenseId === undefined || /^lic_[0-9a-z]{8,40}$/.test(corpo.licenseId), "licenseId");

      if (corpo.licenseId !== undefined && corpo.licenseId !== instalacao.licenseId) {
        throw new Recusa("credencial_invalida");
      }

      if (instalacao.status !== "active") {
        return { license: assinar(instalacao, corpo.nonce), sequence: instalacao.sequence };
      }

      instalacao.sequenciaApresentada = corpo.sequence ?? null;
      instalacao.sequence = sorteio(16);
      return { license: assinar(instalacao, corpo.nonce), sequence: instalacao.sequence };
    },
    "/v1/deactivate": (corpo) => {
      const instalacao = autenticar(corpo);
      exigir(corpo.nonce === undefined || NONCE.test(corpo.nonce), "nonce");

      if (instalacao.status === "active") {
        const feitas = estado.mudancas.get(instalacao.licenseId) ?? 0;

        if (feitas >= 2) {
          throw new Recusa("limite_de_mudancas", { changes: feitas });
        }

        estado.mudancas.set(instalacao.licenseId, feitas + 1);
        instalacao.status = "deactivated";
      }

      return { license: assinar(instalacao, corpo.nonce) };
    }
  };

  function enviar(resposta, status, corpo, cabecalhos = {}) {
    const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    resposta.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cabecalhos });
    resposta.end(texto);
  }

  const servidor = createServer(async (pedido, resposta) => {
    const pedacos = [];

    for await (const pedaco of pedido) {
      pedacos.push(pedaco);
    }

    const caminho = new URL(pedido.url ?? "/", "http://emissor.invalid").pathname;
    const texto = Buffer.concat(pedacos).toString("utf8");
    let corpo = null;

    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = null;
    }

    estado.pedidos.push({ caminho, metodo: pedido.method, tipo: pedido.headers["content-type"] ?? null, corpo });
    // A primeira resposta forçada que serve a esta rota (sem `caminho`, serve a qualquer uma).
    const indice = estado.proximas.findIndex((item) => !item.caminho || item.caminho === caminho);
    const forcada = indice === -1 ? null : estado.proximas.splice(indice, 1)[0];

    if (forcada) {
      if (forcada.nuncaResponde) {
        estado.pendentes.add(resposta);
        return;
      }

      if (forcada.atrasoMs) {
        await new Promise((resolve) => setTimeout(resolve, forcada.atrasoMs));
      }

      if (typeof forcada.responder === "function") {
        const feita = forcada.responder({ caminho, corpo, assinar: (instalacao, nonce, extra) => assinar(instalacao, nonce, extra), estado });
        enviar(resposta, feita.status ?? 200, feita.cru ?? feita.corpo, feita.cabecalhos);
        return;
      }

      enviar(resposta, forcada.status ?? 200, forcada.cru ?? forcada.corpo, forcada.cabecalhos);
      return;
    }

    try {
      if (!/^application\/json\s*(;|$)/i.test(String(pedido.headers["content-type"] ?? ""))) {
        throw new Recusa("tipo_de_conteudo");
      }

      const rota = Object.hasOwn(rotas, caminho) ? rotas[caminho] : null;

      if (!rota) {
        throw new Recusa("nao_encontrado");
      }

      if (pedido.method !== "POST") {
        throw new Recusa("metodo_nao_permitido");
      }

      exigir(corpo && typeof corpo === "object", "(corpo)");
      enviar(resposta, 200, rota(corpo));
    } catch (erro) {
      if (erro instanceof Recusa) {
        enviar(resposta, STATUS_DO_ERRO[erro.codigo], { error: erro.codigo, message: "recusado pelo Emissor falso", ...erro.extra });
        return;
      }

      enviar(resposta, 500, { error: "erro_interno", message: String(erro) });
    }
  });

  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));

  return {
    estado,
    base: `http://127.0.0.1:${servidor.address().port}`,
    get pedidos() {
      return estado.pedidos;
    },
    get proximas() {
      return estado.proximas;
    },
    set portas(valor) {
      estado.portas = valor;
    },
    /** Cria uma Licença e uma Chave de ativação para ela. */
    novaLicenca(id = idSorteado("lic"), dados = {}) {
      estado.licencas.set(id, { status: "active", ...dados });
      const chave = chaveDeAtivacao();
      estado.chaves.set(chave, { licenseId: id, usedAt: null, installationId: null });
      return { licenseId: id, chave };
    },
    /** Outra Chave para a mesma Licença (a reinstalação no mesmo endereço). */
    novaChave(licenseId) {
      const chave = chaveDeAtivacao();
      estado.chaves.set(chave, { licenseId, usedAt: null, installationId: null });
      return chave;
    },
    instalacao(id) {
      return estado.instalacoes.get(id);
    },
    async fechar() {
      for (const resposta of estado.pendentes) {
        resposta.destroy();
      }

      servidor.closeAllConnections();
      await new Promise((resolve) => servidor.close(resolve));
    }
  };
}
