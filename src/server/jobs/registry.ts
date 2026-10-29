import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { communicationMediaJob } from "./communication-media-job";
import { communicationsJob } from "./communications-job";
import { emailOutboxJob } from "./email-outbox-job";
import { webinarRemindersJob } from "./webinar-reminders-job";
import { webinarSessionsJob } from "./webinar-sessions-job";

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
// - `webinar-reminders` (lembretes de 24 h e 1 h das lives para quem garantiu vaga, pelo sino e pela fila de e-mail,
//   e a sessao que encerra sozinha 2 h depois do fim previsto, src/server/jobs/webinar-reminders-job.ts; docs/30 §2.7).
//   Sem trabalho, uma consulta de sessoes e nada mais;
// - `comunicacao-limpeza-de-arquivos` (arquivos da Comunicacao sem uso ha 30 dias saem do Storage,
//   src/server/jobs/communication-media-job.ts). Roda a cada minuto, mas so trabalha uma vez por dia (06:53 UTC),
//   com ate 500 arquivos por rodada; fica por ultimo para usar so o que sobra do tick.

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
  run(ctx: JobContext): Promise<void>;
};

export const jobRegistry: readonly Job[] = [emailOutboxJob, communicationsJob, webinarSessionsJob, webinarRemindersJob, communicationMediaJob];
