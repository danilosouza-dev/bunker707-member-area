import { aplicaFiltros, gravacaoRow, perfis as perfisPadrao, scriptedDb, sessaoRow, webinarRow } from "./webinarios-banco-falso.mjs";

// O banco falso dos CSVs e dos blocos da fase 4 do relatorio (docs/30 §3.4, §3.5 e §3.7; docs/18 §2.5): so leitura,
// como o relatorio e as exportacoes. Cada consulta (from ou rpc) e anotada (tabela, operacao, colunas e filtros) e a
// resposta sai das listas em memoria com os filtros do PostgREST aplicados (eq, in, is, gte, lt, or de session_id).
// As RPCs devolvem o que o teste passou: `relatorio` (webinar_report), `presentes` (webinar_attendees, uma lista ou
// um objeto por sessao) e `painel` (webinar_panel; lista ou funcao dos argumentos). `ofertas`, `variantes` e `exibicoes`
// sao a Oferta montada e o que cada sessao mostrou (o recorte "Com oferta" / "Variante" do painel). `semMigracao` imita o banco sem uma
// parte da fase 4: "ofertas" (webinar_offer_clicks e as colunas da Simulacao, 202610300003) e "assistente"
// (answer_source e assistant_settings, 202610300004) respondem como o PostgREST sem o objeto (PGRST205 / 42703).
// `falha` derruba qualquer leitura de uma tabela com um erro comum. Nada aqui e importado por src/.

const COLUNAS_DA_SIMULACAO = /simulated_count_rule|simulation_summary/;
const COLUNAS_DO_ASSISTENTE = /answer_source|assistant_settings/;

export function bancoDoExportar({
  cliques = [],
  exibicoes = [],
  enquetes = [],
  equipe = [],
  eventos = [],
  falha = null,
  gravacoes = [gravacaoRow()],
  mensagens = [],
  ofertas = [],
  opcoes = [],
  painel = [],
  perfis = perfisPadrao,
  perguntas = [],
  presentes = [],
  relatorio = [],
  respostas = [],
  roteiro = [],
  semMigracao = [],
  sessoes = [sessaoRow()],
  transcricoes = [],
  vagas = [],
  variantes = [],
  webinars = [webinarRow()]
} = {}) {
  const sem = new Set(semMigracao);

  return scriptedDb((query) => {
    const single = query.filters.some(([method]) => method === "maybeSingle" || method === "single");
    const colunas = typeof query.payload === "string" ? query.payload : "";
    const le = (rows) => {
      const achadas = aplicaFiltros(rows, query.filters);
      return { data: single ? (achadas[0] ?? null) : achadas, error: null };
    };
    const semObjeto = (code, message) => ({ data: null, error: { code, message } });

    if (falha === query.table) {
      return semObjeto("57014", "canceling statement due to statement timeout");
    }
    if (sem.has("ofertas") && query.table.startsWith("webinar_offer")) {
      return semObjeto("PGRST205", `Could not find the table 'public.${query.table}' in the schema cache`);
    }
    if (sem.has("ofertas") && COLUNAS_DA_SIMULACAO.test(colunas)) {
      return semObjeto("42703", "column webinar_sessions.simulated_count_rule does not exist");
    }
    if (sem.has("assistente") && COLUNAS_DO_ASSISTENTE.test(colunas)) {
      return semObjeto("42703", `column ${query.table}.answer_source does not exist`);
    }

    switch (`${query.table}:${query.op}`) {
      case "webinars:select":
        return le(webinars);
      case "webinar_sessions:select":
        return le([...sessoes].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      case "webinar_recordings:select":
        return le(gravacoes);
      case "webinar_registrations:select":
        return le(vagas);
      case "admin_roles:select":
        return { data: equipe.map((user_id) => ({ user_id })), error: null };
      case "profiles:select":
        return le(perfis);
      case "student_events:select":
        return le(eventos);
      case "webinar_polls:select":
        return le(enquetes);
      case "webinar_poll_options:select":
        return le(opcoes);
      case "webinar_poll_answers:select":
        return le(respostas);
      case "webinar_questions:select":
        return le(perguntas);
      case "webinar_chat_script_items:select":
        return le(roteiro);
      case "webinar_chat_messages:select":
        return le(mensagens);
      case "webinar_offer_clicks:select":
        return le(cliques);
      case "webinar_offers:select":
        return le(ofertas);
      case "webinar_offer_variants:select":
        return le(variantes);
      case "webinar_offer_displays:select":
        return le(exibicoes);
      case "webinar_recording_transcripts:select":
        return le(transcricoes);
      case "admin_audit_log:insert":
        return { data: null, error: null };
      case "webinar_report:rpc":
        return { data: typeof relatorio === "function" ? relatorio(query.args) : relatorio, error: null };
      case "webinar_attendees:rpc":
        return { data: Array.isArray(presentes) ? presentes : (presentes[query.args.p_session_id] ?? []), error: null };
      case "webinar_panel:rpc":
        return { data: typeof painel === "function" ? painel(query.args) : painel, error: null };
      default:
        return { data: null, error: null };
    }
  });
}

/** As consultas a uma tabela (ou RPC) que o codigo fez. */
export const consultas = (db, tabela) => db.queries.filter((query) => query.table === tabela);

/** O CSV em linhas e celulas (sem o BOM, separador ";", aspas do RFC 4180), como o Excel le. */
export function lerCsv(texto) {
  const corpo = texto.replace(/^﻿/, "");
  const linhas = [];
  let linha = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < corpo.length; i += 1) {
    const c = corpo[i];
    if (aspas) {
      if (c === '"' && corpo[i + 1] === '"') {
        celula += '"';
        i += 1;
      } else if (c === '"') {
        aspas = false;
      } else {
        celula += c;
      }
    } else if (c === '"') {
      aspas = true;
    } else if (c === ";") {
      linha.push(celula);
      celula = "";
    } else if (c === "\n") {
      linha.push(celula.replace(/\r$/, ""));
      linhas.push(linha);
      linha = [];
      celula = "";
    } else {
      celula += c;
    }
  }
  if (celula || linha.length) {
    linha.push(celula);
    linhas.push(linha);
  }
  return linhas;
}
