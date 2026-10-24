import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  KeyRound,
  LibraryBig,
  LifeBuoy,
  Mail,
  MessageCircle,
  Settings,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberPage, MemberPageHeader, MemberSection } from "@/components/member/ui/member-page";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { MEMBER_SUPPORT_FAQ, type MemberSupportChannel, type MemberSupportChannelKind } from "@/lib/member-support";

// Suporte: canais que a escola configurou (link de ajuda da tela de entrar + canais fixos), perguntas
// frequentes e atalhos. Sem formulario nesta fase (nao ha caixa de entrada no admin para responder).
// As perguntas usam <details> nativo: abrem e fecham sem JavaScript. O atalho da equipe para o admin e
// um <a> comum (carregamento inteiro): o microfone so e liberado num documento carregado em /admin.

const channelIcons: Record<MemberSupportChannelKind, LucideIcon> = {
  email: Mail,
  help_center: LifeBuoy,
  whatsapp: MessageCircle
};

function SupportChannelCard({ channel }: { channel: MemberSupportChannel }) {
  const Icon = channelIcons[channel.kind];
  const ActionIcon = channel.opensNewTab ? ArrowUpRight : ArrowRight;

  return (
    <a
      aria-label={`${channel.actionLabel}: ${channel.display}${channel.opensNewTab ? " (abre em nova aba)" : ""}`}
      className="group flex min-w-0 flex-col rounded-[12px] border border-white/[0.08] bg-[#181818] p-5 outline-none transition-[background-color,border-color,box-shadow] duration-200 hover:border-white/20 hover:bg-[#1d1d1d] hover:shadow-[0_18px_48px_rgba(0,0,0,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      href={channel.href}
      {...(channel.opensNewTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}
    >
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-[var(--accent)]/12 text-red-300 ring-1 ring-[var(--accent)]/25">
          <Icon className="size-5" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-bold text-white">{channel.label}</span>
          <span className="block truncate text-sm text-zinc-300">{channel.display}</span>
        </span>
      </span>
      <span className="mt-3 text-[13px] leading-5 text-zinc-500">{channel.description}</span>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
        {channel.actionLabel}
        <ActionIcon aria-hidden="true" className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </span>
    </a>
  );
}

function ShortcutLink({ description, href, icon: Icon, label }: { description: string; href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      className="group flex min-w-0 items-center gap-3 rounded-[12px] border border-white/[0.08] bg-[#181818] px-4 py-3.5 outline-none transition-colors duration-200 hover:border-white/20 hover:bg-[#1d1d1d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      href={href}
    >
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-zinc-200">
        <Icon className="size-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block truncate text-xs text-zinc-500">{description}</span>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-white motion-reduce:transition-none" />
    </Link>
  );
}

export function SupportView({
  accessPreviewMode,
  canUseAccessPreview,
  channels,
  email
}: {
  accessPreviewMode?: AccessPreviewMode;
  canUseAccessPreview: boolean;
  channels: MemberSupportChannel[];
  /** E-mail da conta do proprio aluno, para ele informar ao falar com a equipe. */
  email: string;
}) {
  const withPreview = (href: string) => withAccessPreviewParam(href, accessPreviewMode);

  return (
    <MemberPage width="narrow">
      <MemberPageHeader
        description="Fale com a equipe da escola ou encontre a resposta nas perguntas frequentes."
        eyebrow={{ icon: LifeBuoy, label: "Suporte" }}
        title="Como podemos ajudar?"
      />

      <div className="grid gap-12 sm:gap-14">
        <MemberSection
          description={
            channels.length > 0 && email ? (
              <>
                Ao falar com a equipe, informe o e-mail da sua conta: <span className="font-semibold text-zinc-300">{email}</span>
              </>
            ) : undefined
          }
          id="fale-com-a-equipe"
          title="Fale com a equipe"
        >
          {channels.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {channels.map((channel) => (
                <SupportChannelCard channel={channel} key={channel.href} />
              ))}
            </div>
          ) : (
            <MemberEmptyState
              action={
                canUseAccessPreview ? (
                  <a className={memberButtonClassName({ size: "sm" })} href="/admin/area-de-membros/login">
                    <Settings />
                    Configurar link de ajuda
                  </a>
                ) : undefined
              }
              description={
                canUseAccessPreview
                  ? "Para a equipe: cadastre o link de ajuda em Admin › Área de membros › Entrar. Enquanto isso, os alunos veem as perguntas frequentes abaixo."
                  : "Enquanto isso, confira as perguntas frequentes abaixo."
              }
              icon={LifeBuoy}
              size="compact"
              title="A escola ainda não cadastrou um canal de atendimento"
            />
          )}
        </MemberSection>

        <MemberSection id="perguntas-frequentes" title="Perguntas frequentes">
          <MemberSurface className="divide-y divide-white/[0.08] overflow-hidden" padding="none">
            {MEMBER_SUPPORT_FAQ.map((item) => (
              <details className="group" key={item.id}>
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-left outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white sm:px-5 [&::-webkit-details-marker]:hidden">
                  <CircleHelp aria-hidden="true" className="size-[18px] shrink-0 text-zinc-500 group-open:text-[var(--accent)]" strokeWidth={2} />
                  <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-white sm:text-[15px]">{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                <div className="px-4 pb-5 pl-[46px] sm:px-5 sm:pl-[50px]">
                  <p className="text-sm leading-6 text-zinc-400">{item.answer}</p>
                  {item.link ? (
                    <Link
                      className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] text-sm font-semibold text-white outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                      href={withPreview(item.link.href)}
                    >
                      {item.link.label}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  ) : null}
                </div>
              </details>
            ))}
          </MemberSurface>
        </MemberSection>

        <MemberSection id="atalhos" title="Atalhos">
          <div className="grid gap-3 sm:grid-cols-3">
            <ShortcutLink
              description="Tudo que você comprou"
              href={withPreview(MEMBER_ROUTES.purchases)}
              icon={LibraryBig}
              label="Minhas compras"
            />
            <ShortcutLink
              description="Datas de início e fim"
              href={withPreview(`${MEMBER_ROUTES.profile}?aba=acessos`)}
              icon={ShieldCheck}
              label="Meus acessos"
            />
            <ShortcutLink
              description="Troque a senha da conta"
              href={`${MEMBER_ROUTES.changePassword}?next=${encodeURIComponent(MEMBER_ROUTES.support)}`}
              icon={KeyRound}
              label="Alterar senha"
            />
          </div>
        </MemberSection>
      </div>
    </MemberPage>
  );
}
