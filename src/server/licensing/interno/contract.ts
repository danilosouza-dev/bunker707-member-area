// O contrato da API interna do Emissor, v1 (docs/32 §11.2, "API interna"; o texto de fio e docs/api-interna.md do
// bunker-licensing, lido em 11/11/2026): o que a nossa escola pede ao Emissor por venda (aplicar e desfazer) e pelo
// comprador logado (listar as Licencas, informar o titular com o aceite dos termos, gerar a Chave de ativacao e revogar).
// Base `/interno/v1`, `Authorization: Bearer <credencial>` e o cabecalho `X-Pedido` em todo pedido. Erros:
// `{ erro, mensagem }`, as vezes com campos a mais.
//
// Regra do contrato (de la): campo pode ser acrescentado, nunca renomeado nem tirado. Por isso aqui o que o Emissor manda
// a mais e ignorado, e o que falta e opcional so onde o contrato diz que pode faltar.
//
// Modulo puro (sem "server-only", sem banco e sem rede): o cliente HTTP, o simulador, a fila e os testes leem daqui. Toda
// resposta passa por um destes schemas antes de chegar a tela ou a fila: fora do formato vira `resposta_invalida`.

import { z } from "zod";

/** Por que a venda foi desfeita (o motivo do contrato; o cancelamento e tratado como o reembolso). */
export const UNDO_REASONS = ["reembolso", "chargeback", "cancelamento"] as const;
export type UndoReason = (typeof UNDO_REASONS)[number];

/** O numero de uma Licenca no Emissor. */
export const LICENSE_ID_PATTERN = /^lic_[0-9a-z]{8,40}$/;
/** A conta na nossa area (o auth.users.id): o formato que o Emissor aceita. */
export const AREA_USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** O cabecalho X-Pedido: de 1 a 100 caracteres. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
/** Os codigos de erro (do Emissor e do cliente). */
export const ERROR_CODE_PATTERN = /^[a-z_]{1,40}$/;
/** A data de calendario do contrato (validade, prazoComecaEm): AAAA-MM-DD no horario de Brasilia. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const iso = z.iso.datetime({ offset: true });
const isoOrNull = z.union([iso, z.null()]);
const calendarDateOrNull = z.union([z.string().regex(CALENDAR_DATE_PATTERN), z.null()]);
const code = z.string().regex(ERROR_CODE_PATTERN);

// ---- Pedidos ---------------------------------------------------------------------------------------------

/** POST /vendas: a venda aprovada. Idempotente pela venda (plataforma, transacao e produto). */
export const saleRequestSchema = z.object({
  plataforma: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  transacao: z.string().min(1).max(128),
  produto: z.string().min(1).max(128),
  comprador: z.object({
    areaUserId: z.string().regex(AREA_USER_ID_PATTERN),
    email: z.email().max(320),
    nome: z.string().trim().max(200).nullable()
  }),
  compradoEm: iso,
  garantiaAte: isoOrNull,
  quantidade: z.number().int().min(1).max(20).optional(),
  /** So para Ano adicional, troca e modulo: a Licenca em que aplicar (do mesmo cliente). */
  licenca: z.string().regex(LICENSE_ID_PATTERN).optional()
});
export type SaleRequest = z.infer<typeof saleRequestSchema>;

/** POST /vendas/desfazer: o reembolso, o chargeback ou o cancelamento daquela venda. Idempotente pela venda. */
export const undoRequestSchema = z.object({
  plataforma: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  transacao: z.string().min(1).max(128),
  produto: z.string().min(1).max(128),
  motivo: z.enum(UNDO_REASONS),
  em: iso
});
export type UndoRequest = z.infer<typeof undoRequestSchema>;

/** PUT /clientes/{areaUserId}/titular. */
export type HolderRequest = {
  /** O nome ou a razao social (1 a 160). */
  nome: string;
  /** CPF (11 digitos) ou CNPJ (14, tambem o alfanumerico), sem pontuacao. */
  documento: string;
  /** Diferente do e-mail do cliente. */
  email2: string;
  /** A versao dos termos que o comprador aceitou agora (1 a 32). */
  aceiteTermos: { versao: string };
};

/** POST /licencas/{id}/chave. `confirmarTroca` e obrigatorio com Instalacao no ar ou Chave esperando uso. */
export type KeyRequest = { areaUserId: string; confirmarTroca?: boolean };

/** POST /licencas/{id}/revogar. */
export type RevokeRequest = { areaUserId: string };

// ---- Respostas ------------------------------------------------------------------------------------------

/** A Licenca resumida (venda e desfazer). */
export const licenseSummarySchema = z.object({
  id: z.string().regex(LICENSE_ID_PATTERN),
  tipo: z.enum(["anual", "vitalicia"]),
  validade: calendarDateOrNull.optional().default(null),
  situacao: code,
  prazoComecaEm: calendarDateOrNull.optional().default(null)
});
export type LicenseSummary = z.infer<typeof licenseSummarySchema>;

/** Um endereco que a tela abre (o Renovar): so https, sem usuario nem senha. Fora disso, descartado (null). */
const httpsLinkOrNull = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  })
  .nullable()
  .optional()
  .catch(null);

/** A Licenca completa (a lista de Minhas licencas). */
export const customerLicenseSchema = licenseSummarySchema.extend({
  origem: z.string().max(40).optional(),
  instalacao: z
    .object({
      endereco: z.string().trim().min(1).max(253),
      ultimoContato: isoOrNull.optional().default(null),
      versao: z.string().max(64).nullable().optional().default(null),
      pacote: z.string().max(64).nullable().optional().default(null),
      ativadaEm: isoOrNull.optional().default(null)
    })
    .nullable()
    .optional()
    .default(null),
  chave: z.object({
    /** aguardando_uso, em_uso ou nenhuma (o que vier de novo passa como veio, e a tela trata como nenhuma). */
    estado: code,
    geradaEm: isoOrNull.optional().default(null),
    final: z.string().max(16).nullable().optional().default(null),
    validaAte: isoOrNull.optional().default(null),
    reservadaPara: z.string().max(253).nullable().optional().default(null)
  }),
  modulos: z
    .array(z.object({ chave: z.string().trim().min(1).max(80), nome: z.string().trim().min(1).max(120).optional() }))
    .max(32)
    .optional()
    .default([]),
  trocasEm12Meses: z.number().int().min(0).max(100_000).optional().default(0),
  links: z
    .object({ renovar: httpsLinkOrNull, loja: httpsLinkOrNull })
    .optional()
    .default({ loja: null, renovar: null })
});
export type CustomerLicense = z.infer<typeof customerLicenseSchema>;

export const holderSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  /** Sem pontuacao (o CPF, o CNPJ ou o CNPJ alfanumerico). */
  documento: z.string().trim().min(1).max(40),
  tipoDocumento: z.string().max(10).optional(),
  email: z.string().max(320).nullable().optional().default(null),
  email2: z.string().max(320).nullable().optional().default(null)
});
export type Holder = z.infer<typeof holderSchema>;

export const termsAcceptanceSchema = z.object({ versao: z.string().trim().min(1).max(80), em: isoOrNull.optional().default(null) });
export type TermsAcceptance = z.infer<typeof termsAcceptanceSchema>;

/** GET /clientes/{areaUserId}/licencas (o cliente que o Emissor nao conhece recebe tudo vazio). */
export const customerLicensesSchema = z.object({
  licencas: z.array(customerLicenseSchema).max(500),
  titular: holderSchema.nullable().optional().default(null),
  termosAceitos: termsAcceptanceSchema.nullable().optional().default(null)
});
export type CustomerLicenses = z.infer<typeof customerLicensesSchema>;

const cutInstallation = z.object({ endereco: z.string().max(253) }).nullable().optional().default(null);

/** POST /licencas/{id}/chave: a Chave de ativacao, uma vez so. */
export const issuedKeySchema = z.object({
  chave: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{7,119}$/),
  validaAte: isoOrNull.optional().default(null),
  final: z.string().max(16).nullable().optional().default(null),
  instalacaoDesligada: cutInstallation,
  chavesCanceladas: z.number().int().min(0).max(1000).optional().default(0),
  trocasEm12Meses: z.number().int().min(0).max(100_000).optional().default(0)
});
export type IssuedKey = z.infer<typeof issuedKeySchema>;

/** POST /licencas/{id}/revogar. */
export const revokeReceiptSchema = z.object({
  chavesCanceladas: z.number().int().min(0).max(1000).optional().default(0),
  instalacaoDesligada: cutInstallation,
  trocasEm12Meses: z.number().int().min(0).max(100_000).optional().default(0)
});
export type RevokeReceipt = z.infer<typeof revokeReceiptSchema>;

/** PUT /clientes/{areaUserId}/titular: o titular e o aceite gravados, como no GET. */
export const savedHolderSchema = z.object({
  titular: holderSchema.nullable().optional().default(null),
  termosAceitos: termsAcceptanceSchema.nullable().optional().default(null)
});
export type SavedHolder = z.infer<typeof savedHolderSchema>;

/** POST /vendas: as Licencas criadas ou a Licenca em que a compra caiu. `aplicada: false` = o desfazer chegou antes. */
export const saleReceiptSchema = z.object({
  licencas: z.array(licenseSummarySchema).max(100).optional().default([]),
  aplicada: z.boolean().optional().default(true),
  desfeita: z.boolean().optional(),
  repetida: z.boolean().optional()
});
export type SaleReceipt = z.infer<typeof saleReceiptSchema>;

/** POST /vendas/desfazer. `vendaConhecida: false` = o Emissor nao tinha a venda (e guardou a marca). */
export const undoReceiptSchema = z.object({
  licencas: z.array(licenseSummarySchema).max(100).optional().default([]),
  desfeita: z.boolean().optional().default(true),
  vendaConhecida: z.boolean().optional().default(true),
  repetida: z.boolean().optional()
});
export type UndoReceipt = z.infer<typeof undoReceiptSchema>;

/** O corpo de toda recusa: `{ erro, mensagem }` e, conforme o erro, campos a mais (os que a tela usa). */
export const errorBodySchema = z.object({
  erro: code,
  mensagem: z.string().max(2000).optional(),
  campos: z.array(z.string().max(40)).max(20).optional().catch(undefined),
  falta: z.array(z.string().max(40)).max(10).optional().catch(undefined),
  instalacao: z
    .object({ endereco: z.string().max(253), ultimoContato: isoOrNull.optional().default(null) })
    .nullable()
    .optional()
    .catch(undefined),
  chaveAguardandoUso: z
    .object({ geradaEm: isoOrNull.optional().default(null), final: z.string().max(16).nullable().optional().default(null) })
    .nullable()
    .optional()
    .catch(undefined),
  motivo: code.optional().catch(undefined),
  tenteDeNovoEm: z.number().int().min(0).max(86_400).optional().catch(undefined)
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

/** Os codigos do Emissor (docs/api-interna.md, "Erros"). */
export const EMISSOR_INTERNAL_ERROR_CODES = [
  "pedido_invalido",
  "credencial_invalida",
  "licenca_indisponivel",
  "nao_encontrado",
  "licenca_nao_encontrada",
  "cliente_desconhecido",
  "metodo_nao_permitido",
  "troca_nao_confirmada",
  "titular_pendente",
  "venda_de_outro_cliente",
  "pedido_grande_demais",
  "tipo_de_conteudo",
  "produto_desconhecido",
  "quantidade_invalida",
  "sem_licenca_para_aplicar",
  "licenca_ambigua",
  "validade_acima_do_limite",
  "limite_de_pedidos",
  "erro_interno",
  "indisponivel"
] as const;

/** O que a recusa trouxe a mais e a tela usa (o campo errado, o que falta, o que a troca vai cortar). */
export type InternalFailureDetails = {
  campos?: string[];
  falta?: string[];
  instalacao?: { endereco: string; ultimoContato: string | null } | null;
  chaveAguardandoUso?: { geradaEm: string | null; final: string | null } | null;
  motivo?: string;
};

export type InternalFailure = {
  ok: false;
  /** O codigo (do Emissor ou do cliente), sempre no formato ^[a-z_]{1,40}$. */
  error: string;
  /** O status HTTP da recusa (null quando nem houve resposta). */
  status: number | null;
  /** A frase do Emissor, so para a lista da equipe (a tela do comprador usa as nossas). */
  message: string | null;
  retryAfterSeconds?: number;
  details?: InternalFailureDetails;
};

export type InternalResult<T> = { ok: true; data: T } | InternalFailure;

/**
 * As recusas que provam que o Emissor nao aplicou a venda (ele respondeu, e recusou antes de gravar). Sem resposta,
 * resposta fora do formato e erro do lado dele deixam a duvida.
 */
export const REFUSED_WITHOUT_RECORDING = new Set<string>([
  "pedido_invalido",
  "credencial_invalida",
  "nao_encontrado",
  "metodo_nao_permitido",
  "pedido_grande_demais",
  "tipo_de_conteudo",
  "produto_desconhecido",
  "quantidade_invalida",
  "sem_licenca_para_aplicar",
  "licenca_ambigua",
  "validade_acima_do_limite",
  "venda_de_outro_cliente",
  "limite_de_pedidos",
  "nao_configurado"
]);

export type CallOptions = {
  /** O X-Pedido: o id do item da fila (o mesmo em todas as tentativas) ou um sorteado por pedido. */
  requestId: string;
  signal?: AbortSignal;
  /** O tempo limite deste pedido (padrao: o do cliente). */
  timeoutMs?: number;
};

/** O que a nossa area pede ao Emissor. Toda implementacao devolve o resultado tipado e nunca lanca. */
export type InternalEmissorClient = {
  registerSale(body: SaleRequest, options: CallOptions): Promise<InternalResult<SaleReceipt>>;
  undoSale(body: UndoRequest, options: CallOptions): Promise<InternalResult<UndoReceipt>>;
  listLicenses(areaUserId: string, options: CallOptions): Promise<InternalResult<CustomerLicenses>>;
  saveHolder(areaUserId: string, body: HolderRequest, options: CallOptions): Promise<InternalResult<SavedHolder>>;
  issueKey(licenseId: string, body: KeyRequest, options: CallOptions): Promise<InternalResult<IssuedKey>>;
  revokeKey(licenseId: string, body: RevokeRequest, options: CallOptions): Promise<InternalResult<RevokeReceipt>>;
};

const NOT_CONFIGURED: InternalFailure = Object.freeze({ error: "nao_configurado", message: null, ok: false, status: null });

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
