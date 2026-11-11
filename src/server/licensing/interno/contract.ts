// O contrato da API interna do Emissor (docs/32 §11.2, "API interna"; o texto de fio em docs/api-interna.md do
// bunker-licensing): o que a nossa escola pede ao Emissor por venda (emitir e desfazer) e pelo comprador logado (listar
// as Licencas, informar o titular com o aceite dos termos, gerar a Chave de ativacao e revogar). Base `/interno/v1`,
// `Authorization: Bearer <credencial>` e o cabecalho `X-Pedido`. Erros: `{ erro, mensagem }`.
//
// Modulo puro (sem "server-only", sem banco e sem rede): o cliente HTTP, o simulador e os testes leem daqui. Toda
// resposta do Emissor passa por um destes schemas antes de chegar a tela ou a fila: o que nao segue o formato vira
// `resposta_invalida`, nunca um dado meio lido.

import { z } from "zod";

/** As plataformas de venda, como o Emissor as chama (os mesmos codigos de src/server/payments/types.ts). */
export const INTERNAL_PLATFORMS = ["hotmart", "ticto", "kiwify"] as const;
export type InternalPlatform = (typeof INTERNAL_PLATFORMS)[number];

/** Por que a venda foi desfeita (o motivo do contrato). */
export const UNDO_REASONS = ["reembolso", "chargeback", "cancelamento"] as const;
export type UndoReason = (typeof UNDO_REASONS)[number];

/** O numero de uma Licenca no Emissor (o mesmo `lic_` do protocolo das Instalacoes). */
export const LICENSE_ID_PATTERN = /^lic_[0-9a-z]{8,40}$/;
/** O identificador da conta na nossa area (o id do Supabase Auth). */
export const AREA_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Os codigos que o Emissor e o cliente devolvem (produto_desconhecido, sem_resposta...). */
export const ERROR_CODE_PATTERN = /^[a-z_]{1,40}$/;

const iso = z.iso.datetime({ offset: true });
const isoOrNull = z.union([iso, z.null()]);
const code = z.string().regex(ERROR_CODE_PATTERN);
const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---- Pedidos ---------------------------------------------------------------------------------------------

/** POST /vendas: a venda paga de um produto marcado como Bunker Members. Idempotente por plataforma, transacao e produto. */
export const saleRequestSchema = z.object({
  plataforma: z.enum(INTERNAL_PLATFORMS),
  transacao: shortText(200),
  produto: shortText(120),
  comprador: z.object({
    areaUserId: z.string().regex(AREA_USER_ID_PATTERN),
    email: z.email().max(320),
    nome: z.string().trim().max(200).nullable()
  }),
  compradoEm: isoOrNull,
  garantiaAte: isoOrNull,
  quantidade: z.number().int().min(1).max(100).optional()
});
export type SaleRequest = z.infer<typeof saleRequestSchema>;

/** POST /vendas/desfazer: o reembolso, o chargeback ou o cancelamento daquela venda. */
export const undoRequestSchema = z.object({
  plataforma: z.enum(INTERNAL_PLATFORMS),
  transacao: shortText(200),
  produto: shortText(120),
  motivo: z.enum(UNDO_REASONS),
  em: iso
});
export type UndoRequest = z.infer<typeof undoRequestSchema>;

/** PUT /clientes/{areaUserId}/titular: o titular da Licenca e o aceite da versao dos termos. */
export type HolderRequest = {
  nome: string;
  /** Só os digitos do CPF (11) ou do CNPJ (14). */
  documento: string;
  email2: string;
  aceiteTermos: { versao: string };
};

/** POST /licencas/{id}/chave. `confirmarTroca` e obrigatorio quando ja ha Instalacao ativa ou Chave sem uso. */
export type KeyRequest = { areaUserId: string; confirmarTroca?: boolean };

/** POST /licencas/{id}/revogar. */
export type RevokeRequest = { areaUserId: string };

// ---- Respostas ------------------------------------------------------------------------------------------

/** A Instalacao da Licenca: o endereco e o ultimo contato (a conferencia diaria). */
const installationSchema = z.object({
  endereco: z.string().trim().min(1).max(253),
  ultimoContato: isoOrNull.optional().default(null),
  versao: z.string().trim().max(64).nullable().optional().default(null)
});

/** Um modulo ligado: a chave e, quando vem, o nome que a tela mostra. */
const moduleSchema = z.union([
  z.string().trim().min(1).max(80),
  z.object({ chave: z.string().trim().min(1).max(80), nome: z.string().trim().min(1).max(120).optional() })
]);

/** Um endereco que a tela abre (o Renovar): so https. */
const httpsLink = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });

export const customerLicenseSchema = z.object({
  id: z.string().regex(LICENSE_ID_PATTERN),
  tipo: z.enum(["anual", "vitalicia"]),
  validade: isoOrNull.optional().default(null),
  situacao: code,
  instalacao: installationSchema.nullable().optional().default(null),
  chave: z.object({ estado: code, geradaEm: isoOrNull.optional().default(null) }),
  modulos: z.array(moduleSchema).max(32).optional().default([]),
  trocasEm12Meses: z.number().int().min(0).max(10_000).optional().default(0),
  // O link que nao e https e descartado sozinho: a tela so nao mostra o Renovar (nunca a Licenca inteira some por isso).
  links: z
    .object({ renovar: httpsLink.nullable().optional().catch(null) })
    .optional()
    .default({ renovar: null })
});
export type CustomerLicense = z.infer<typeof customerLicenseSchema>;

export const holderSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  /** O Emissor pode devolver o documento mascarado (***.456.789-**); a tela mostra como veio. */
  documento: z.string().trim().min(1).max(40),
  email2: z.string().trim().max(320).nullable().optional().default(null)
});
export type Holder = z.infer<typeof holderSchema>;

export const termsAcceptanceSchema = z.object({ versao: z.string().trim().min(1).max(80), em: isoOrNull.optional().default(null) });
export type TermsAcceptance = z.infer<typeof termsAcceptanceSchema>;

/** GET /clientes/{areaUserId}/licencas. */
export const customerLicensesSchema = z.object({
  licencas: z.array(customerLicenseSchema).max(200),
  titular: holderSchema.nullable().optional().default(null),
  termosAceitos: termsAcceptanceSchema.nullable().optional().default(null)
});
export type CustomerLicenses = z.infer<typeof customerLicensesSchema>;

/** POST /licencas/{id}/chave: a Chave de ativacao, uma vez so. */
export const issuedKeySchema = z.object({
  chave: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{7,119}$/),
  validaAte: isoOrNull.optional().default(null)
});
export type IssuedKey = z.infer<typeof issuedKeySchema>;

/** PUT /clientes/{areaUserId}/titular: o titular gravado (as vezes sem corpo: vale o que foi pedido). */
export const savedHolderSchema = z
  .object({ titular: holderSchema.nullable().optional(), termosAceitos: termsAcceptanceSchema.nullable().optional() })
  .optional()
  .default({});

/** POST /vendas e /vendas/desfazer: o que o Emissor contar da venda (a Licenca emitida, se disse). Tudo opcional. */
export const saleReceiptSchema = z
  .object({
    licenca: z.string().regex(LICENSE_ID_PATTERN).optional(),
    licencas: z.array(z.string().regex(LICENSE_ID_PATTERN)).max(100).optional(),
    situacao: code.optional()
  })
  .optional()
  .default({});
export type SaleReceipt = z.infer<typeof saleReceiptSchema>;

/** O corpo de toda recusa: `{ erro, mensagem }`. */
export const errorBodySchema = z.object({
  erro: code,
  mensagem: z.string().max(1000).optional(),
  esperarSegundos: z.number().int().min(0).max(86_400).optional()
});

// ---- Os erros ---------------------------------------------------------------------------------------------

/**
 * Os codigos do proprio cliente, alem dos do Emissor (que chegam como ele mandou, se seguem o formato):
 * - nao_configurado: este servidor nao tem a API interna (a copia do comprador, a `dev` sem o simulador);
 * - sem_resposta: sem rede, DNS, certificado ou tempo esgotado;
 * - resposta_invalida: respondeu fora do formato;
 * - recusado: recusou sem um codigo que se leia;
 * - erro_inesperado: defeito deste lado.
 */
export const CLIENT_ERROR_CODES = ["nao_configurado", "sem_resposta", "resposta_invalida", "recusado", "erro_inesperado"] as const;

/**
 * Os codigos do Emissor que esta versao conhece pelo nome (os outros chegam como vieram e tem uma frase generica).
 * produto_desconhecido: o codigo do produto nao esta no mapa do Emissor (422); confirmacao_necessaria: gerar a Chave
 * tiraria a de agora de uso e o comprador nao confirmou (409); titular_necessario e termos_necessarios: falta o titular
 * ou o aceite da versao dos termos.
 */
export const KNOWN_EMISSOR_ERROR_CODES = [
  "pedido_invalido",
  "credencial_invalida",
  "nao_encontrado",
  "produto_desconhecido",
  "confirmacao_necessaria",
  "titular_necessario",
  "termos_necessarios",
  "titular_invalido",
  "documento_invalido",
  "email2_invalido",
  "licenca_indisponivel",
  "limite_de_pedidos",
  "indisponivel",
  "erro_interno"
] as const;

export type InternalFailure = {
  ok: false;
  /** O codigo (do Emissor ou do cliente), sempre no formato ^[a-z_]{1,40}$. */
  error: string;
  /** O status HTTP da recusa (null quando nem houve resposta). */
  status: number | null;
  /** A frase do Emissor, so para a lista da equipe (nunca para a tela do comprador, que tem as nossas). */
  message: string | null;
  retryAfterSeconds?: number;
};

export type InternalResult<T> = { ok: true; data: T } | InternalFailure;

/** As recusas que provam que o Emissor nao gravou a venda (ele respondeu e recusou). As outras deixam a duvida. */
export const REFUSED_WITHOUT_RECORDING = new Set<string>([
  "produto_desconhecido",
  "pedido_invalido",
  "credencial_invalida",
  "limite_de_pedidos",
  "nao_configurado"
]);

export type CallOptions = {
  /** O valor do cabecalho X-Pedido: o id da linha da fila (estavel entre tentativas) ou um sorteado por pedido. */
  requestId: string;
  signal?: AbortSignal;
};

/** O que a nossa area pede ao Emissor. Toda implementacao devolve o resultado tipado e nunca lanca. */
export type InternalEmissorClient = {
  registerSale(body: SaleRequest, options: CallOptions): Promise<InternalResult<SaleReceipt>>;
  undoSale(body: UndoRequest, options: CallOptions): Promise<InternalResult<SaleReceipt>>;
  listLicenses(areaUserId: string, options: CallOptions): Promise<InternalResult<CustomerLicenses>>;
  saveHolder(areaUserId: string, body: HolderRequest, options: CallOptions): Promise<InternalResult<z.infer<typeof savedHolderSchema>>>;
  issueKey(licenseId: string, body: KeyRequest, options: CallOptions): Promise<InternalResult<IssuedKey>>;
  revokeKey(licenseId: string, body: RevokeRequest, options: CallOptions): Promise<InternalResult<SaleReceipt>>;
};

const NOT_CONFIGURED: InternalFailure = Object.freeze({ ok: false, error: "nao_configurado", status: null, message: null });

/** O cliente sem API interna: nenhum pedido sai, toda chamada responde "nao_configurado". */
export const notConfiguredInternalEmissor: InternalEmissorClient = Object.freeze({
  async registerSale() {
    return NOT_CONFIGURED;
  },
  async undoSale() {
    return NOT_CONFIGURED;
  },
  async listLicenses() {
    return NOT_CONFIGURED;
  },
  async saveHolder() {
    return NOT_CONFIGURED;
  },
  async issueKey() {
    return NOT_CONFIGURED;
  },
  async revokeKey() {
    return NOT_CONFIGURED;
  }
});
