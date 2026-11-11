import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeatureKey } from "@/server/licensing/features";
import { communicationMediaJob } from "./communication-media-job";
import { communicationsJob } from "./communications-job";
import { emailOutboxJob } from "./email-outbox-job";
import { heldSalesJob } from "./held-sales-job";
import { licenseCheckInJob } from "./license-check-in-job";
import { licenseSalesJob } from "./license-sales-job";
import { webinarOfferConversionsJob } from "./webinar-offer-conversions-job";
import { webinarRecordingsJob } from "./webinar-recordings-job";
import { webinarRemindersJob } from "./webinar-reminders-job";
import { webinarSessionsJob } from "./webinar-sessions-job";
import { webinarSimulationSummariesJob } from "./webinar-simulation-summaries-job";

// Ponto de extensao dos jobs leves executados pelo tick de minuto.
//
// Quem chama: pg_cron agenda `public.enqueue_jobs_tick()` a cada minuto, que dispara
// `POST /api/jobs/tick` via pg_net. A rota percorre `jobRegistry` em ordem e grava uma
// linha em `public.job_runs` para o tick e outra para cada job executado.
//
// Regras para registrar um job aqui:
// - `name` unico, em kebab-case, sem espacos e diferente de "tick" (reservado);
// - `run` e chamado a cada minuto: o proprio job decide se ha trabalho (ex.: busca
//   linhas vencidas) e retorna rapido quando nao ha;
// - idempotente: o mesmo minuto pode ser entregue duas vezes, e um tick pode cair;
// - curto: o tick inteiro tem orcamento de `JOBS_TICK_BUDGET_MS`; respeite `ctx.signal`
//   e processe em lotes pequenos;
// - trabalho pesado (importacoes, transcricoes, recomputos de `student_facts`, envios em
//   massa) nao pertence ao tick: vai para a fila de jobs (Inngest/Trigger.dev) ou para
//   um agendamento noturno proprio;
// - lancar erro marca o job como `failed` em `job_runs` sem interromper os demais.
//
// Exemplo:
//
//   import { sendDueReminders } from "@/server/communications/reminders";
//
//   export const jobRegistry: readonly Job[] = [
//     emailOutboxJob,
//     { name: "lembretes-de-webinario", run: (ctx) => sendDueReminders(ctx) }
//   ];
//
// Jobs registrados hoje, nesta ordem:
// - `email-outbox` (fila de e-mails transacionais, src/server/jobs/email-outbox-job.ts);
// - `comunicacao` (notificacoes do sino agendadas e quem ve cada pop-up, src/server/jobs/communications-job.ts).
//   Excecao registrada em docs/09 e docs/04: as linhas do sino sao minusculas, gravadas em lotes de 500,
//   com teto por rodada e retomaveis; envio em massa de e-mail/push continua fora do tick;
// - `webinar-sessions` (as sessoes gravadas das lives pelo relogio: abre as que chegaram na hora com o roteiro e o
//   "Comecou agora", encerra as que passaram da duracao do video congelando a presenca e cria o replay do webinario,
//   src/server/jobs/webinar-sessions-job.ts; docs/30 §1.6 e §6.6). Vem antes dos lembretes: a sessao que o tick nao
//   abriu a tempo e encerrada aqui com a curva, nao pelo encerramento automatico de la. Sem trabalho, uma consulta;
// - `webinar-simulation-summaries` (fase 4b: congela a Simulacao das sessoes gravadas encerradas, uma vez, com a semente;
//   src/server/jobs/webinar-simulation-summaries-job.ts; docs/30 §3.5 e §4.3). Logo depois das sessoes: a que encerrou
//   neste minuto congela aqui. Sem trabalho, uma consulta;
// - `webinar-reminders` (lembretes de 24 h e 1 h das lives para quem garantiu vaga, pelo sino e pela fila de e-mail,
//   e a sessao que encerra sozinha 2 h depois do fim previsto, src/server/jobs/webinar-reminders-job.ts; docs/30 §2.7).
//   Sem trabalho, uma consulta de sessoes e nada mais;
// - `webinar-recordings` (o gravador por hora e as gravacoes da Live ao vivo: pede a maquina 30 min antes da live com
//   "Gravar automaticamente", consulta a Bunny ate a gravacao ficar pronta e cria o replay, devolve a maquina, avisa no
//   sino a maquina ligada ha mais de 6 h e apaga na Bunny a gravacao vencida uma vez por hora,
//   src/server/jobs/webinar-recordings-job.ts; docs/30 §4.5 e §6.7). Vem depois dos lembretes: a sessao encerrada
//   sozinha la ja conta para devolver a maquina aqui. Sem o token do GitHub nem a chave da Bunny, so o aviso de 6 h roda;
// - `webinar-offer-conversions` (fase 4b: liga as vendas do webhook aos cliques da Oferta em ate 7 dias, M7, pela RPC
//   webinar_offer_conversions, em lote; src/server/jobs/webinar-offer-conversions-job.ts; docs/30 §4.2). Nunca cria
//   venda nem acesso. Sem trabalho, uma chamada;
// - `licenca-conferencia` (a licenca desta Instalacao, docs/32 §11.3; src/server/jobs/license-check-in-job.ts). No
//   modo "off" (a nossa escola hoje, a dev, a Vercel e os testes) nao faz nada nem le o banco. No "enforce": uma
//   leitura e uma gravacao em license_state por minuto (a ultima hora vista) e a conferencia com o Emissor uma vez
//   por dia, ou de hora em hora quando falha, com tempo limite de 10 s. Fica no fim, antes da limpeza: nao atrasa os
//   envios, e a rodada que ficar sem tempo so atrasa a ultima hora vista, o que nunca limita ninguem;
// - `vendas-guardadas` (as vendas que chegaram com a licenca barrando o acesso novo, docs/32 §2.2 e §11.3;
//   src/server/jobs/held-sales-job.ts). No modo "off" nao faz nada nem le o banco. No "enforce": uma consulta por
//   minuto; com venda guardada e a licenca permitindo de novo, libera em ordem, com reivindicacao por venda (duas rodadas
//   nunca liberam a mesma). Logo depois da conferencia da licenca, para a licenca regularizada nesta rodada ja liberar;
// - `licencas-vendas` (a venda do Bunker Members que vira Licenca, docs/32 §11.10; src/server/jobs/license-sales-job.ts).
//   Sem a API interna do Emissor configurada (a copia do comprador, a dev sem o simulador) nao faz nada nem le o banco.
//   Com ela (a nossa escola): uma consulta por minuto a fila license_requests e ate 10 pedidos por rodada ao Emissor, na
//   ordem, com reivindicacao por linha e nova tentativa com espera. Fica no fim, antes da limpeza: o Emissor lento so
//   atrasa a propria fila;
// - `comunicacao-limpeza-de-arquivos` (arquivos da Comunicacao sem uso ha 30 dias saem do Storage,
//   src/server/jobs/communication-media-job.ts). Roda a cada minuto, mas so trabalha uma vez por dia (06:53 UTC),
//   com ate 500 arquivos por rodada; fica por ultimo para usar so o que sobra do tick.
//
// As cinco tarefas dos Webinarios (`webinar-*`) declaram `feature: WEBINARS_FEATURE`: sem o modulo na licenca, o
// agendador as pula (docs/32 §11.8). No modo "off" todo modulo esta ligado e todas rodam, como antes. A lista continua
// uma constante montada sem ler o banco.

export type JobContext = {
  // Cliente administrativo do Supabase (service role); usar somente no servidor.
  supabase: SupabaseClient;
  // Abortado quando o orcamento do tick acaba.
  signal: AbortSignal;
  // Instante de inicio do tick, compartilhado por todos os jobs do mesmo minuto.
  tickStartedAt: Date;
  // Linha de `job_runs` do tick e do job atual, para correlacionar registros.
  tickRunId: string;
  runId: string;
};

export type Job = {
  name: string;
  /**
   * Modulo (feature) da licenca de que a tarefa faz parte (docs/32 §11.8). Sem o modulo ligado, o agendador
   * (run-tick.ts) nem chama a tarefa: nada roda e nenhuma linha vai para job_runs. Sem o campo, a tarefa e do nucleo.
   */
  feature?: FeatureKey;
  run(ctx: JobContext): Promise<void>;
};

export const jobRegistry: readonly Job[] = [emailOutboxJob, communicationsJob, webinarSessionsJob, webinarSimulationSummariesJob, webinarRemindersJob, webinarRecordingsJob, webinarOfferConversionsJob, licenseCheckInJob, heldSalesJob, licenseSalesJob, communicationMediaJob];
