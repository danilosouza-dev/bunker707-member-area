alter table public.tv_sessions
  add column if not exists playback_rate numeric(4,2) not null default 1,
  add column if not exists available_playback_rates numeric(4,2)[] not null default array[1.00]::numeric(4,2)[];

alter table public.tv_sessions
  drop constraint if exists tv_sessions_playback_rate_check,
  add constraint tv_sessions_playback_rate_check check (
    playback_rate in (0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00)
  ),
  drop constraint if exists tv_sessions_available_playback_rates_check,
  add constraint tv_sessions_available_playback_rates_check check (
    cardinality(available_playback_rates) between 1 and 8
    and available_playback_rates <@ array[0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00]::numeric(4,2)[]
  );

comment on column public.tv_sessions.playback_rate is
  'Velocidade efetiva confirmada pelo player receptor da TV.';

comment on column public.tv_sessions.available_playback_rates is
  'Velocidades aceitas pelo player receptor atual, usadas pelo controle remoto.';
