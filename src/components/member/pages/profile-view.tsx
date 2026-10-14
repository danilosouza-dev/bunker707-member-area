import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleUser,
  Clock3,
  ImageOff,
  Info,
  KeyRound,
  LibraryBig,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { ProfileAvatarEditor } from "@/components/member/profile/profile-avatar-editor";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip, type MemberChipTone } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberTabNav } from "@/components/member/ui/member-filters";
import { MemberPage } from "@/components/member/ui/member-page";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import type { ProfileAccessView, ProfileDetailsView, ProfileTab } from "@/server/member-area/student-pages-model";
import { ProfileSignOutButton } from "./profile-sign-out-button";

// Perfil do aluno: foto (o aluno troca ou remove no cabecalho), Dados (somente leitura nesta fase),
// Acessos (inicio e fim de cada acesso ativo) e Segurança (alterar senha e sair). Abas trocam o endereco (?aba=), sem JavaScript. Rotulos curtos
// para as tres abas caberem em 390 px sem rolar.

const accessTones: Record<ProfileAccessView["kind"], MemberChipTone> = {
  entitlement: "success",
  free: "neutral",
  preview: "outline"
};

function DetailRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 py-4 sm:items-center sm:px-5">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] text-zinc-400">
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <dl className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <dt className="shrink-0 text-xs font-medium text-zinc-500 sm:text-sm">{label}</dt>
        <dd className="min-w-0 break-words text-sm font-semibold text-white sm:text-right">{value}</dd>
      </dl>
    </div>
  );
}

function NotInformed() {
  return <span className="font-medium text-zinc-500">Não informado</span>;
}

function ProfileDetailsTab({ details, supportHref }: { details: ProfileDetailsView; supportHref: string }) {
  return (
    <div className="grid gap-4">
      <MemberSurface className="divide-y divide-white/[0.06]" padding="none">
        <DetailRow icon={UserRound} label="Nome" value={details.fullName} />
        <DetailRow icon={Mail} label="E-mail" value={details.email || <NotInformed />} />
        <DetailRow icon={Phone} label="Telefone" value={details.phone || <NotInformed />} />
        <DetailRow icon={CalendarDays} label="Aluno desde" value={details.memberSinceLabel || <NotInformed />} />
        <DetailRow icon={Clock3} label="Último acesso" value={details.lastSignInLabel || <NotInformed />} />
      </MemberSurface>
      <p className="flex items-start gap-2 px-1 text-xs leading-5 text-zinc-500">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Precisa corrigir seu nome, e-mail ou telefone?{" "}
          <Link className="font-semibold text-zinc-300 underline-offset-2 hover:text-white hover:underline" href={supportHref}>
            Fale com o suporte
          </Link>
          .
        </span>
      </p>
    </div>
  );
}

function AccessRow({ access }: { access: ProfileAccessView }) {
  const image = access.image.trim();

  return (
    <li className="min-w-0">
      <Link
        aria-label={`Abrir ${access.title}`}
        className="group flex min-w-0 items-center gap-4 rounded-[12px] border border-white/[0.08] bg-[#181818] p-3 outline-none transition-colors duration-200 hover:border-white/20 hover:bg-[#1d1d1d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:p-4"
        href={access.href}
      >
        <span className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-[6px] bg-[#1f1f1f] ring-1 ring-white/[0.08] sm:w-14">
          {image ? (
            <Image alt="" className="object-cover" fill sizes="56px" src={image} unoptimized={!canOptimizeImageSrc(image)} />
          ) : (
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-zinc-600">
              <ImageOff className="size-4" strokeWidth={1.8} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <MemberChip tone="neutral">{access.kindLabel}</MemberChip>
            <MemberChip tone={accessTones[access.kind]}>{access.statusLabel}</MemberChip>
            {access.endsSoon ? <MemberChip tone="warning">{access.endsSoonLabel}</MemberChip> : null}
          </span>
          <span className="mt-1.5 block truncate text-[15px] font-bold text-white">{access.title}</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-400">
            {[access.sinceLabel, access.durationLabel].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-white motion-reduce:transition-none" />
      </Link>
    </li>
  );
}

function ProfileAccessesTab({ accesses, supportHref }: { accesses: ProfileAccessView[]; supportHref: string }) {
  if (accesses.length === 0) {
    return (
      <MemberEmptyState
        action={
          <MemberButtonLink href={supportHref} variant="primary">
            Falar com o suporte
          </MemberButtonLink>
        }
        description="Comprou e o curso não aparece? Fale com a equipe informando o e-mail usado na compra."
        icon={LibraryBig}
        title="Você ainda não tem acessos ativos"
      />
    );
  }

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2.5">
        {accesses.map((access) => (
          <AccessRow access={access} key={access.id} />
        ))}
      </ul>
      <p className="flex items-start gap-2 px-1 text-xs leading-5 text-zinc-500">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Acesso expirado ou cancelado não aparece aqui. Algo diferente do que você comprou?{" "}
          <Link className="font-semibold text-zinc-300 underline-offset-2 hover:text-white hover:underline" href={supportHref}>
            Fale com o suporte
          </Link>
          .
        </span>
      </p>
    </div>
  );
}

function SecurityCard({
  action,
  description,
  icon: Icon,
  title
}: {
  action: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <MemberSurface className="flex flex-col gap-4 sm:flex-row sm:items-center" padding="md">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-zinc-200">
        <Icon className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-bold text-white">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </MemberSurface>
  );
}

function ProfileSecurityTab() {
  return (
    <div className="grid gap-3">
      <SecurityCard
        action={
          <MemberButtonLink href={`${MEMBER_ROUTES.changePassword}?next=${encodeURIComponent(MEMBER_ROUTES.profile)}`} variant="secondary">
            <KeyRound />
            Alterar senha
          </MemberButtonLink>
        }
        description="Use uma senha forte, com pelo menos 8 caracteres, que você não usa em outros sites."
        icon={KeyRound}
        title="Senha"
      />
      <SecurityCard
        action={<ProfileSignOutButton />}
        description="Encerra a sua sessão neste aparelho. Para voltar, entre de novo com seu e-mail."
        icon={LogOut}
        title="Sair da conta"
      />
    </div>
  );
}

export function ProfileView({
  accessPreviewMode,
  accesses,
  details,
  tab
}: {
  accessPreviewMode?: AccessPreviewMode;
  accesses: ProfileAccessView[];
  details: ProfileDetailsView;
  tab: ProfileTab;
}) {
  const tabHref = (value: ProfileTab) =>
    withAccessPreviewParam(value === "dados" ? MEMBER_ROUTES.profile : `${MEMBER_ROUTES.profile}?aba=${value}`, accessPreviewMode);
  const supportHref = withAccessPreviewParam(MEMBER_ROUTES.support, accessPreviewMode);

  return (
    <MemberPage width="narrow">
      <header className="mb-8 sm:mb-10">
        <p className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-zinc-400">
          <CircleUser aria-hidden="true" className="size-4 text-[var(--accent)]" strokeWidth={2.2} />
          Sua conta
        </p>
        <ProfileAvatarEditor avatarUrl={details.avatarUrl} name={details.fullName}>
          <h1 className="truncate text-[26px] font-black leading-[1.1] text-white sm:text-4xl">{details.fullName}</h1>
          {details.email ? <p className="mt-1.5 truncate text-sm text-zinc-400 sm:text-[15px]">{details.email}</p> : null}
          {details.memberSinceLabel ? (
            <p className="mt-1 text-xs text-zinc-500">Aluno desde {details.memberSinceLabel}</p>
          ) : null}
        </ProfileAvatarEditor>
      </header>

      <MemberTabNav
        ariaLabel="Seções do perfil"
        className="mb-8"
        items={[
          { active: tab === "dados", href: tabHref("dados"), icon: UserRound, label: "Dados" },
          { active: tab === "acessos", count: accesses.length, href: tabHref("acessos"), icon: ShieldCheck, label: "Acessos" },
          { active: tab === "seguranca", href: tabHref("seguranca"), icon: KeyRound, label: "Segurança" }
        ]}
      />

      {tab === "dados" ? <ProfileDetailsTab details={details} supportHref={supportHref} /> : null}
      {tab === "acessos" ? <ProfileAccessesTab accesses={accesses} supportHref={supportHref} /> : null}
      {tab === "seguranca" ? <ProfileSecurityTab /> : null}
    </MemberPage>
  );
}
