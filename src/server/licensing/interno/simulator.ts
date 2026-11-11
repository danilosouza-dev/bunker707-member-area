// O simulador da API interna do Emissor, em memoria (docs/32 §11.2, "Ambientes": a `dev` e os testes falam com um
// simulador). Segue o contrato v1 (contract.ts; docs/api-interna.md do bunker-licensing): a venda idempotente, o desfazer
// que chega antes da venda e a impede, a lista do comprador com as Licencas completas, o titular com o aceite dos termos,
// a Chave de ativacao uma vez so (com a troca confirmada que corta a Chave esperando e a Instalacao no ar) e o revogar.
// Nao simula o Ano adicional com atraso, a carencia, a garantia nem os limites de pedidos: so o que as telas e a fila usam.
//
// Onde roda: nos testes, e no `next dev` ou na previa da Vercel com EMISSOR_INTERNO_SIMULADOR=on e sem a configuracao de
// verdade (config.ts). Nunca na producao nem na copia do comprador. O estado fica na memoria do processo: na Vercel cada
// instancia tem o seu, entao serve para olhar as telas, nao para um ensaio de verdade.
//
// Modulo puro: nada de banco nem rede. A Chave sorteada so existe na resposta (o simulador guarda o resumo, como o Emissor).

import { createHash, randomBytes } from "node:crypto";
import type {
  CustomerLicense,
  HolderRequest,
  InternalEmissorClient,
  InternalFailure,
  InternalFailureDetails,
  LicenseSummary,
  SaleRequest,
  UndoRequest
} from "./contract";
import { documentKindOf, normalizeDocument } from "./holder";

/** O que cada codigo de produto e no simulador (no Emissor de verdade, o mapa de produtos da tela Planos). */
export type SimulatedProductKind = "licenca_anual" | "licenca_vitalicia" | "ano_adicional" | { modulo: string; nome: string };

export type InternalEmissorSimulatorOptions = {
  /** O mapa dos codigos de produto. */
  products?: Record<string, SimulatedProductKind>;
  /** O que vale para um codigo fora do mapa: null = produto_desconhecido (os testes); a Licenca anual na `dev`. */
  defaultKind?: SimulatedProductKind | null;
  /** O relogio (os testes passam o deles). */
  now?: () => Date;
  /** O endereco do botao Renovar (com o numero da Licenca no fim). */
  renewBaseUrl?: string;
};

type SimLicense = {
  id: string;
  owner: string;
  saleKey: string;
  kind: "anual" | "vitalicia";
  /** O inicio do prazo da anual (a primeira ativacao), ou null enquanto nao comecou. */
  startedAt: Date | null;
  boughtAt: Date;
  status: "ativa" | "suspensa" | "revogada";
  installation: { host: string; lastContact: Date | null; activatedAt: Date } | null;
  /** A Chave esperando uso (so o resumo e o final). */
  pendingKey: { digest: string; issuedAt: Date; final: string; validUntil: Date } | null;
  /** A Chave que ativou a Instalacao no ar. */
  usedKey: { issuedAt: Date; final: string } | null;
  modules: { chave: string; nome: string }[];
  cuts: Date[];
};

type SimCustomer = {
  email: string;
  name: string | null;
  holder: { nome: string; documento: string; email2: string } | null;
  terms: { versao: string; em: Date } | null;
};

/** O que os testes olham por dentro do simulador (nunca a Chave: so o resumo dela, como o Emissor guarda). */
export type SimulatorInspection = {
  sales: { key: string; licenseIds: string[]; undone: string | null }[];
  licenses: SimLicense[];
  requests: { method: string; path: string; requestId: string }[];
};

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DAY_MS = 24 * 60 * 60 * 1000;
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;

function failure(error: string, status: number, message: string | null = null, details?: InternalFailureDetails): InternalFailure {
  return details ? { details, error, message, ok: false, status } : { error, message, ok: false, status };
}

/** A Chave no formato do Emissor: BKA- e seis grupos de cinco simbolos do base32 de Crockford. */
function newKey(): string {
  const bytes = randomBytes(30);
  const characters = Array.from(bytes, (byte) => CROCKFORD[byte % 32]);
  const groups = Array.from({ length: 6 }, (_, index) => characters.slice(index * 5, index * 5 + 5).join(""));
  return `BKA-${groups.join("-")}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** A data de calendario (AAAA-MM-DD) no horario de Brasilia. */
function brasiliaDay(date: Date): string {
  return new Date(date.getTime() - BRASILIA_OFFSET_MS).toISOString().slice(0, 10);
}

export type InternalEmissorSimulator = InternalEmissorClient & {
  /** Para os testes e a `dev`: a Chave esperando vira uma Instalacao no endereco (como se o instalador ativasse). */
  simulateActivation(licenseId: string, host: string): boolean;
  /** Para os testes: o estado por dentro. */
  inspect(): SimulatorInspection;
};

export function createInternalEmissorSimulator(options: InternalEmissorSimulatorOptions = {}): InternalEmissorSimulator {
  const products = options.products ?? {};
  const defaultKind = options.defaultKind === undefined ? null : options.defaultKind;
  const now = options.now ?? (() => new Date());
  const renewBase = options.renewBaseUrl ?? "https://pagamento.exemplo.test/bunker-members/renovar";
  const sales = new Map<string, { licenseIds: string[]; undone: string | null }>();
  const licenses = new Map<string, SimLicense>();
  const customers = new Map<string, SimCustomer>();
  const requests: SimulatorInspection["requests"] = [];
  let sequence = 0;

  const note = (method: string, path: string, requestId: string) => requests.push({ method, path, requestId });
  const nextLicenseId = () => `lic_sim${String((sequence += 1)).padStart(8, "0")}`;
  const licensesOf = (owner: string) => [...licenses.values()].filter((license) => license.owner === owner);

  function startOf(license: SimLicense): Date {
    return license.startedAt ?? new Date(license.boughtAt.getTime() + 30 * DAY_MS);
  }

  function summaryOf(license: SimLicense): LicenseSummary {
    const annual = license.kind === "anual";

    return {
      id: license.id,
      prazoComecaEm: annual && !license.startedAt ? brasiliaDay(startOf(license)) : null,
      situacao: license.status,
      tipo: license.kind,
      validade: annual ? brasiliaDay(new Date(addMonths(startOf(license), 12).getTime() - DAY_MS)) : null
    };
  }

  function fullOf(license: SimLicense): CustomerLicense {
    const pending = license.pendingKey && license.pendingKey.validUntil.getTime() > now().getTime() ? license.pendingKey : null;
    const estado = pending ? "aguardando_uso" : license.installation ? "em_uso" : "nenhuma";
    const key = pending ?? (license.installation ? license.usedKey : null);

    return {
      ...summaryOf(license),
      chave: {
        estado,
        final: key?.final ?? null,
        geradaEm: key?.issuedAt.toISOString() ?? null,
        reservadaPara: null,
        validaAte: pending ? pending.validUntil.toISOString() : null
      },
      instalacao: license.installation
        ? {
            ativadaEm: license.installation.activatedAt.toISOString(),
            endereco: license.installation.host,
            pacote: null,
            ultimoContato: license.installation.lastContact?.toISOString() ?? null,
            versao: null
          }
        : null,
      links: { loja: null, renovar: license.kind === "anual" && license.status !== "revogada" ? `${renewBase}/${license.id}` : null },
      modulos: license.modules.map((module) => ({ chave: module.chave, nome: module.nome })),
      origem: "venda",
      trocasEm12Meses: license.cuts.filter((date) => now().getTime() - date.getTime() < 365 * DAY_MS).length
    };
  }

  function ownLicense(licenseId: string, areaUserId: string): SimLicense | null {
    const license = licenses.get(licenseId);
    return license && license.owner === areaUserId ? license : null;
  }

  /** Corta a Chave esperando e a Instalacao no ar (a troca confirmada e o revogar). */
  function cut(license: SimLicense): { chavesCanceladas: number; instalacaoDesligada: { endereco: string } | null } {
    const canceled = license.pendingKey ? 1 : 0;
    const installation = license.installation ? { endereco: license.installation.host } : null;

    if (canceled || installation) {
      license.cuts.push(now());
    }

    license.pendingKey = null;
    license.installation = null;
    license.usedKey = null;

    return { chavesCanceladas: canceled, instalacaoDesligada: installation };
  }

  function applySale(body: SaleRequest): string[] | InternalFailure {
    const kind = products[body.produto] ?? defaultKind;

    if (!kind) {
      return failure("produto_desconhecido", 422, `O produto ${body.produto} não está no mapa de produtos.`);
    }

    const owner = body.comprador.areaUserId;
    const saleKey = `${body.plataforma}:${body.transacao}:${body.produto}`;
    const boughtAt = new Date(Math.min(Date.parse(body.compradoEm), now().getTime()));

    if (kind === "licenca_anual" || kind === "licenca_vitalicia") {
      return Array.from({ length: body.quantidade ?? 1 }, () => {
        const id = nextLicenseId();
        licenses.set(id, {
          boughtAt,
          cuts: [],
          id,
          installation: null,
          kind: kind === "licenca_anual" ? "anual" : "vitalicia",
          modules: [],
          owner,
          pendingKey: null,
          saleKey,
          startedAt: null,
          status: "ativa",
          usedKey: null
        });
        return id;
      });
    }

    if ((body.quantidade ?? 1) > 1) {
      return failure("quantidade_invalida", 422, "Mais de uma unidade de um produto que não é Licença.");
    }

    const candidates = licensesOf(owner).filter((license) => license.status === "ativa" && (kind !== "ano_adicional" || license.kind === "anual"));
    const target = body.licenca ? candidates.find((license) => license.id === body.licenca) : candidates.length === 1 ? candidates[0] : undefined;

    if (!target) {
      return candidates.length > 1 && !body.licenca
        ? failure("licenca_ambigua", 422, "O cliente tem mais de uma Licença que serve.")
        : failure("sem_licenca_para_aplicar", 422, "Nenhuma Licença do cliente serve para esta compra.", { motivo: "nenhuma_licenca" });
    }

    if (kind === "ano_adicional") {
      target.startedAt = addMonths(startOf(target), 12);
    } else if (!target.modules.some((module) => module.chave === kind.modulo)) {
      target.modules.push({ chave: kind.modulo, nome: kind.nome });
    }

    return [target.id];
  }

  const simulator: InternalEmissorSimulator = {
    async registerSale(body, call) {
      note("POST", "/vendas", call.requestId);
      const saleKey = `${body.plataforma}:${body.transacao}:${body.produto}`;
      const existing = sales.get(saleKey);

      if (existing?.undone) {
        return { data: { aplicada: false, desfeita: true, licencas: [] }, ok: true };
      }

      if (existing) {
        return { data: { aplicada: true, licencas: existing.licenseIds.map((id) => summaryOf(licenses.get(id) as SimLicense)), repetida: true }, ok: true };
      }

      const applied = applySale(body);

      if (!Array.isArray(applied)) {
        return applied;
      }

      const customer = customers.get(body.comprador.areaUserId);
      customers.set(body.comprador.areaUserId, {
        email: body.comprador.email,
        holder: customer?.holder ?? null,
        name: body.comprador.nome ?? customer?.name ?? null,
        terms: customer?.terms ?? null
      });
      sales.set(saleKey, { licenseIds: applied, undone: null });

      return { data: { aplicada: true, licencas: applied.map((id) => summaryOf(licenses.get(id) as SimLicense)) }, ok: true };
    },

    async undoSale(body: UndoRequest, call) {
      note("POST", "/vendas/desfazer", call.requestId);
      const saleKey = `${body.plataforma}:${body.transacao}:${body.produto}`;
      const sale = sales.get(saleKey);

      if (!sale) {
        // O desfazer que chega antes da venda: a marca impede a venda depois.
        sales.set(saleKey, { licenseIds: [], undone: body.motivo });
        return { data: { desfeita: true, licencas: [], vendaConhecida: false }, ok: true };
      }

      const repeated = sale.undone !== null;

      if (!repeated) {
        sale.undone = body.motivo;

        for (const id of sale.licenseIds) {
          const license = licenses.get(id);

          if (license && license.saleKey === saleKey) {
            license.status = "revogada";
            license.pendingKey = null;
          }
        }
      }

      return {
        data: {
          desfeita: true,
          licencas: sale.licenseIds.map((id) => summaryOf(licenses.get(id) as SimLicense)),
          vendaConhecida: true,
          ...(repeated ? { repetida: true } : {})
        },
        ok: true
      };
    },

    async listLicenses(areaUserId, call) {
      note("GET", `/clientes/${areaUserId}/licencas`, call.requestId);
      const customer = customers.get(areaUserId);

      return {
        data: {
          licencas: licensesOf(areaUserId).map(fullOf),
          termosAceitos: customer?.terms ? { em: customer.terms.em.toISOString(), versao: customer.terms.versao } : null,
          titular: customer?.holder
            ? {
                documento: customer.holder.documento,
                email: customer.email,
                email2: customer.holder.email2,
                nome: customer.holder.nome,
                tipoDocumento: customer.holder.documento.length === 11 ? "cpf" : "cnpj"
              }
            : null
        },
        ok: true
      };
    },

    async saveHolder(areaUserId, body: HolderRequest, call) {
      note("PUT", `/clientes/${areaUserId}/titular`, call.requestId);
      const customer = customers.get(areaUserId);

      if (!customer) {
        return failure("cliente_desconhecido", 404, "Nenhuma venda deste cliente chegou ao Emissor.");
      }

      if (!body.nome.trim() || body.nome.trim().length > 160) {
        return failure("pedido_invalido", 400, "Nome fora do formato.", { campos: ["nome"] });
      }

      if (!documentKindOf(body.documento)) {
        return failure("pedido_invalido", 400, "Documento inválido.", { campos: ["documento"] });
      }

      if (body.email2.trim().toLowerCase() === customer.email.trim().toLowerCase()) {
        return failure("pedido_invalido", 400, "O segundo e-mail precisa ser diferente.", { campos: ["email2"] });
      }

      customer.holder = { documento: normalizeDocument(body.documento), email2: body.email2, nome: body.nome.trim() };
      customer.terms = { em: now(), versao: body.aceiteTermos.versao };

      return {
        data: {
          termosAceitos: { em: customer.terms.em.toISOString(), versao: customer.terms.versao },
          titular: {
            documento: customer.holder.documento,
            email: customer.email,
            email2: customer.holder.email2,
            nome: customer.holder.nome,
            tipoDocumento: customer.holder.documento.length === 11 ? "cpf" : "cnpj"
          }
        },
        ok: true
      };
    },

    async issueKey(licenseId, body, call) {
      note("POST", `/licencas/${licenseId}/chave`, call.requestId);
      const license = ownLicense(licenseId, body.areaUserId);

      if (!license) {
        return failure("licenca_nao_encontrada", 404, "Licença não encontrada.");
      }

      if (license.status !== "ativa") {
        return failure("licenca_indisponivel", 403, "Licença suspensa ou revogada.");
      }

      const customer = customers.get(body.areaUserId);
      const missing = [...(customer?.holder ? [] : ["titular"]), ...(customer?.terms ? [] : ["termos"])];

      if (missing.length > 0) {
        return failure("titular_pendente", 409, "Falta o titular ou o aceite dos termos.", { falta: missing });
      }

      const pending = license.pendingKey && license.pendingKey.validUntil.getTime() > now().getTime() ? license.pendingKey : null;

      if ((pending || license.installation) && body.confirmarTroca !== true) {
        return failure("troca_nao_confirmada", 409, "A troca precisa ser confirmada.", {
          chaveAguardandoUso: pending ? { final: pending.final, geradaEm: pending.issuedAt.toISOString() } : null,
          instalacao: license.installation
            ? { endereco: license.installation.host, ultimoContato: license.installation.lastContact?.toISOString() ?? null }
            : null
        });
      }

      const cutNow = cut(license);
      const key = newKey();
      const final = key.slice(-4);
      const validUntil = new Date(now().getTime() + DAY_MS);
      license.pendingKey = { digest: createHash("sha256").update(key).digest("hex"), final, issuedAt: now(), validUntil };

      return {
        data: {
          chave: key,
          chavesCanceladas: cutNow.chavesCanceladas,
          final,
          instalacaoDesligada: cutNow.instalacaoDesligada,
          trocasEm12Meses: fullOf(license).trocasEm12Meses,
          validaAte: validUntil.toISOString()
        },
        ok: true
      };
    },

    async revokeKey(licenseId, body, call) {
      note("POST", `/licencas/${licenseId}/revogar`, call.requestId);
      const license = ownLicense(licenseId, body.areaUserId);

      if (!license) {
        return failure("licenca_nao_encontrada", 404, "Licença não encontrada.");
      }

      const cutNow = cut(license);

      return { data: { ...cutNow, trocasEm12Meses: fullOf(license).trocasEm12Meses }, ok: true };
    },

    simulateActivation(licenseId, host) {
      const license = licenses.get(licenseId);

      if (!license || !license.pendingKey || license.pendingKey.validUntil.getTime() <= now().getTime()) {
        return false;
      }

      license.usedKey = { final: license.pendingKey.final, issuedAt: license.pendingKey.issuedAt };
      license.pendingKey = null;
      license.installation = { activatedAt: now(), host, lastContact: now() };
      license.startedAt ??= now();
      return true;
    },

    inspect() {
      return {
        licenses: [...licenses.values()].map((license) => structuredClone(license)),
        requests: [...requests],
        sales: [...sales.entries()].map(([key, sale]) => ({ key, licenseIds: [...sale.licenseIds], undone: sale.undone }))
      };
    }
  };

  return simulator;
}
