// O simulador da API interna do Emissor, em memoria (docs/32 §11.2, "Ambientes": a `dev` e os testes falam com um
// simulador). Segue o mesmo contrato do cliente HTTP (contract.ts): a venda idempotente, o desfazer, a lista do comprador,
// o titular com o aceite dos termos, a Chave de ativacao uma vez so (com a confirmacao da troca) e o revogar.
//
// Onde roda: nos testes, e no `next dev` ou na previa da Vercel com EMISSOR_INTERNO_SIMULADOR=on e sem a configuracao de
// verdade (config.ts). Nunca na producao nem na copia do comprador. O estado fica na memoria do processo: na Vercel cada
// instancia tem o seu, entao serve para olhar as telas, nao para um ensaio de verdade.
//
// Modulo puro: nada de banco nem rede. A Chave sorteada so existe na resposta (o simulador guarda o resumo dela, como o
// Emissor).

import { createHash, randomBytes } from "node:crypto";
import {
  customerLicensesSchema,
  type CustomerLicense,
  type HolderRequest,
  type InternalEmissorClient,
  type InternalFailure,
  type SaleRequest,
  type UndoRequest
} from "./contract";
import { documentKindOf } from "./holder";

/** O que cada codigo de produto e no simulador (no Emissor de verdade, a tabela product_map). */
export type SimulatedProductKind = "anual" | "vitalicia" | "ano_adicional" | { modulo: string; nome: string };

export type InternalEmissorSimulatorOptions = {
  /** O mapa dos codigos de produto. */
  products?: Record<string, SimulatedProductKind>;
  /** O que vale para um codigo fora do mapa: null = produto_desconhecido (os testes); "anual" na `dev`. */
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
  validUntil: Date | null;
  status: "em_dia" | "revogada";
  installation: { host: string; lastContact: Date | null } | null;
  key: { state: "nenhuma" | "nao_usada" | "em_uso" | "revogada"; issuedAt: Date | null; digest: string | null };
  modules: { chave: string; nome: string }[];
  changes: Date[];
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

function failure(error: string, status: number, message: string | null = null): InternalFailure {
  return { error, message, ok: false, status };
}

function newKey(): string {
  const bytes = randomBytes(35);
  const characters = Array.from(bytes, (byte) => CROCKFORD[byte % 32]);
  const groups = Array.from({ length: 7 }, (_, index) => characters.slice(index * 5, index * 5 + 5).join(""));
  return `BKA-${groups.join("-")}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export type InternalEmissorSimulator = InternalEmissorClient & {
  /** Para os testes e a `dev`: a Chave nao usada vira uma Instalacao num endereco (como se o instalador tivesse ativado). */
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

  function viewOf(license: SimLicense): CustomerLicense {
    const kind = license.kind;
    const expired = kind === "anual" && license.validUntil !== null && license.validUntil.getTime() < now().getTime();

    return {
      chave: { estado: license.key.state, geradaEm: license.key.issuedAt?.toISOString() ?? null },
      id: license.id,
      instalacao: license.installation
        ? { endereco: license.installation.host, ultimoContato: license.installation.lastContact?.toISOString() ?? null, versao: null }
        : null,
      links: { renovar: kind === "anual" && license.status !== "revogada" ? `${renewBase}?licenca=${license.id}` : null },
      modulos: license.modules.map((module) => ({ chave: module.chave, nome: module.nome })),
      situacao: license.status === "revogada" ? "revogada" : expired ? "vencida" : "em_dia",
      tipo: kind,
      trocasEm12Meses: license.changes.filter((date) => now().getTime() - date.getTime() < 365 * DAY_MS).length,
      validade: kind === "anual" ? (license.validUntil?.toISOString() ?? null) : null
    };
  }

  function ownLicense(licenseId: string, areaUserId: string): SimLicense | null {
    const license = licenses.get(licenseId);
    return license && license.owner === areaUserId ? license : null;
  }

  function applySale(body: SaleRequest): { licenseIds: string[] } | InternalFailure {
    const kind = products[body.produto] ?? defaultKind;

    if (!kind) {
      return failure("produto_desconhecido", 422, `O produto ${body.produto} não está no mapa do Emissor.`);
    }

    const owner = body.comprador.areaUserId;
    const saleKey = `${body.plataforma}:${body.transacao}:${body.produto}`;
    const customer = customers.get(owner) ?? { email: body.comprador.email, holder: null, name: body.comprador.nome, terms: null };
    customers.set(owner, { ...customer, email: body.comprador.email, name: body.comprador.nome ?? customer.name });
    const boughtAt = body.compradoEm ? new Date(body.compradoEm) : now();

    if (kind === "anual" || kind === "vitalicia") {
      const quantity = body.quantidade ?? 1;
      const ids: string[] = [];

      for (let index = 0; index < quantity; index += 1) {
        const id = nextLicenseId();
        licenses.set(id, {
          changes: [],
          id,
          installation: null,
          key: { digest: null, issuedAt: null, state: "nenhuma" },
          kind,
          modules: [],
          owner,
          saleKey,
          status: "em_dia",
          validUntil: kind === "anual" ? addMonths(boughtAt, 12) : null
        });
        ids.push(id);
      }

      return { licenseIds: ids };
    }

    const target = licensesOf(owner)
      .filter((license) => license.status !== "revogada" && (kind !== "ano_adicional" || license.kind === "anual"))
      .sort((a, b) => (a.validUntil?.getTime() ?? Infinity) - (b.validUntil?.getTime() ?? Infinity))[0];

    if (!target) {
      return failure("licenca_indisponivel", 409, "Nenhuma Licença do comprador para aplicar a compra.");
    }

    if (kind === "ano_adicional") {
      target.validUntil = addMonths(target.validUntil ?? boughtAt, 12);
    } else if (!target.modules.some((module) => module.chave === kind.modulo)) {
      target.modules.push({ chave: kind.modulo, nome: kind.nome });
    }

    return { licenseIds: [target.id] };
  }

  const simulator: InternalEmissorSimulator = {
    async registerSale(body, call) {
      note("POST", "/vendas", call.requestId);
      const saleKey = `${body.plataforma}:${body.transacao}:${body.produto}`;
      const existing = sales.get(saleKey);

      if (existing) {
        return { data: { licencas: existing.licenseIds }, ok: true };
      }

      const applied = applySale(body);

      if ("ok" in applied) {
        return applied;
      }

      sales.set(saleKey, { licenseIds: applied.licenseIds, undone: null });
      return { data: { licencas: applied.licenseIds }, ok: true };
    },

    async undoSale(body: UndoRequest, call) {
      note("POST", "/vendas/desfazer", call.requestId);
      const saleKey = `${body.plataforma}:${body.transacao}:${body.produto}`;
      const sale = sales.get(saleKey);

      if (!sale) {
        return { data: {}, ok: true };
      }

      if (!sale.undone) {
        sale.undone = body.motivo;

        for (const id of sale.licenseIds) {
          const license = licenses.get(id);

          if (license && license.saleKey === saleKey) {
            license.status = "revogada";
            license.key = { ...license.key, digest: null, state: license.key.state === "nenhuma" ? "nenhuma" : "revogada" };
          }
        }
      }

      return { data: { licencas: sale.licenseIds, situacao: "revogada" }, ok: true };
    },

    async listLicenses(areaUserId, call) {
      note("GET", `/clientes/${areaUserId}/licencas`, call.requestId);
      const customer = customers.get(areaUserId);
      const data = customerLicensesSchema.parse({
        licencas: licensesOf(areaUserId).map(viewOf),
        termosAceitos: customer?.terms ? { em: customer.terms.em.toISOString(), versao: customer.terms.versao } : null,
        titular: customer?.holder ? { documento: maskDocument(customer.holder.documento), email2: customer.holder.email2, nome: customer.holder.nome } : null
      });

      return { data, ok: true };
    },

    async saveHolder(areaUserId, body: HolderRequest, call) {
      note("PUT", `/clientes/${areaUserId}/titular`, call.requestId);
      const customer = customers.get(areaUserId);

      if (!customer) {
        return failure("nao_encontrado", 404, "Cliente sem compra.");
      }

      if (!documentKindOf(body.documento)) {
        return failure("documento_invalido", 422, "Documento inválido.");
      }

      if (body.email2.trim().toLowerCase() === customer.email.trim().toLowerCase()) {
        return failure("email2_invalido", 422, "O segundo e-mail precisa ser diferente.");
      }

      customer.holder = { documento: body.documento, email2: body.email2, nome: body.nome };
      customer.terms = { em: now(), versao: body.aceiteTermos.versao };

      return { data: {}, ok: true };
    },

    async issueKey(licenseId, body, call) {
      note("POST", `/licencas/${licenseId}/chave`, call.requestId);
      const license = ownLicense(licenseId, body.areaUserId);

      if (!license) {
        return failure("nao_encontrado", 404, "Licença não encontrada.");
      }

      const customer = customers.get(body.areaUserId);

      if (!customer?.holder) {
        return failure("titular_necessario", 409, "Informe o titular antes da primeira chave.");
      }

      if (!customer.terms) {
        return failure("termos_necessarios", 409, "Aceite os termos antes da chave.");
      }

      if (license.status === "revogada") {
        return failure("licenca_indisponivel", 409, "Licença revogada.");
      }

      const inUse = license.installation !== null || license.key.state === "nao_usada";

      if (inUse && body.confirmarTroca !== true) {
        return failure("confirmacao_necessaria", 409, "A chave de agora para de funcionar; confirme a troca.");
      }

      if (inUse) {
        license.changes.push(now());
        license.installation = null;
      }

      const key = newKey();
      license.key = { digest: createHash("sha256").update(key).digest("hex"), issuedAt: now(), state: "nao_usada" };

      return { data: { chave: key, validaAte: new Date(now().getTime() + DAY_MS).toISOString() }, ok: true };
    },

    async revokeKey(licenseId, body, call) {
      note("POST", `/licencas/${licenseId}/revogar`, call.requestId);
      const license = ownLicense(licenseId, body.areaUserId);

      if (!license) {
        return failure("nao_encontrado", 404, "Licença não encontrada.");
      }

      if (license.key.state === "nenhuma" || license.key.state === "revogada") {
        return { data: {}, ok: true };
      }

      license.key = { ...license.key, digest: null, state: "revogada" };
      license.installation = null;
      license.changes.push(now());

      return { data: {}, ok: true };
    },

    simulateActivation(licenseId, host) {
      const license = licenses.get(licenseId);

      if (!license || license.key.state !== "nao_usada") {
        return false;
      }

      license.key = { ...license.key, digest: null, state: "em_uso" };
      license.installation = { host, lastContact: now() };
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

/** O documento como o Emissor devolve na lista: so os ultimos digitos a mostra. */
function maskDocument(digits: string): string {
  return digits.length === 14 ? `**.***.***/****-${digits.slice(12)}` : `***.***.***-${digits.slice(9)}`;
}
