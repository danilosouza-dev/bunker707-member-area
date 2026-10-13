"use client";

import { ArrowRight, LayoutDashboard, LoaderCircle, Menu, Search, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentType, type MouseEvent } from "react";
import { DirectorIcon } from "@/components/member/shell/director-parts";
import { MemberAccountMenu } from "@/components/member/shell/member-account-menu";
import { MemberNotificationsMenu } from "@/components/member/shell/member-notifications-menu";
import { MemberRail } from "@/components/member/shell/member-rail";
import { MemberSidebar } from "@/components/member/shell/member-sidebar";
import { useNavigationFeedback, useNavigationFeedbackRouter } from "@/components/navigation-feedback";
import { PlatformBrandingProvider } from "@/components/platform-branding";
import type { PlatformDirectorChat as PlatformDirectorChatComponent } from "@/components/platform-director-chat";
import { flushPendingSavedItemChanges } from "@/components/saved-item-button";
import { ACCESS_PREVIEW_PARAM, withAccessPreviewParam } from "@/lib/access-preview";
import { signOutAndLeave } from "@/lib/auth/sign-out";
import { memberStyleCssVars, normalizeMemberStyle } from "@/lib/member-style";
import { cn } from "@/lib/utils";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { PlatformBrandingConfig } from "@/lib/platform-types";
import type { AccessPreviewMode } from "@/lib/access-preview";

type AppShellProps = {
  accessPreviewMode?: AccessPreviewMode;
  branding?: PlatformBrandingConfig;
  canUseAccessPreview?: boolean;
  children: React.ReactNode;
  student: {
    fullName: string;
    name: string;
  };
};

declare global {
  interface Window {
    __bunker707FlushLessonProgress?: () => Promise<void>;
  }
}

// Itens da barra lateral e do menu da conta: src/lib/member-navigation.ts (fonte unica), desenhados
// por MemberRail (trilho de icones, computador), MemberSidebar (gaveta por cima, todas as larguras) e
// MemberAccountMenu (src/components/member/shell/). O conteudo fica sempre a 80 px do trilho.
const sidebarId = "member-sidebar";

const accessPreviewOptions = [
  { label: "Sessão atual", value: "current" },
  { label: "Produtor/admin", value: "producer" },
  { label: "Aluno com acesso", value: "student_with_access" },
  { label: "Aluno sem acesso", value: "student_without_access" }
] as const;

function AccessPreviewSelect({
  className,
  label,
  onChange,
  value
}: {
  className: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <select aria-label={label} className={className} onChange={(event) => onChange(event.target.value)} value={value}>
      {accessPreviewOptions.map((option) => (
        <option className="bg-[#141414]" key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type DirectorLauncherState = "failed" | "idle" | "loading";
type PlatformDirectorChatProps = ComponentProps<typeof PlatformDirectorChatComponent>;

// Botão estático com o mesmo visual do lançador da IA Diretor. O chat completo
// (react-markdown, remark-gfm) só é baixado depois do primeiro clique.
function PlatformDirectorLauncher({
  onActivate,
  onWarmUp,
  state = "idle"
}: {
  onActivate?: () => void;
  onWarmUp?: () => void;
  state?: DirectorLauncherState;
}) {
  const loading = state === "loading";
  const label = state === "failed" ? "Recarregar a página para abrir a IA Diretor" : "Abrir IA Diretor";

  return (
    <div className="fixed bottom-4 right-4 z-[180] sm:bottom-6 sm:right-6">
      <span className="group/director relative block">
        <button
          aria-busy={loading}
          aria-expanded={false}
          aria-label={label}
          className="grid size-14 place-items-center rounded-full border border-white/15 bg-white text-black shadow-[0_18px_55px_rgba(0,0,0,0.62)] transition duration-200 hover:scale-105 hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none motion-reduce:hover:scale-100"
          disabled={loading}
          onClick={onActivate}
          onFocus={onWarmUp}
          onPointerEnter={onWarmUp}
          type="button"
        >
          {loading ? (
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
          ) : (
            <DirectorIcon className="size-6" />
          )}
        </button>
        {!loading ? (
          <span className="pointer-events-none absolute bottom-[calc(100%+10px)] right-0 translate-y-1 whitespace-nowrap rounded-[6px] bg-[#eeeeee] px-3 py-2 text-[13px] font-medium text-[#202020] opacity-0 shadow-xl transition group-hover/director:translate-y-0 group-hover/director:opacity-100 group-focus-within/director:translate-y-0 group-focus-within/director:opacity-100 max-sm:hidden" role="tooltip">
            {state === "failed" ? "Recarregue a página para conversar com a IA Diretor" : "Conversar com a IA Diretor"}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function PlatformDirectorLoadFailed() {
  return <PlatformDirectorLauncher onActivate={() => window.location.reload()} state="failed" />;
}

const PlatformDirectorChat = dynamic(
  () => import("@/components/platform-director-chat")
    .then((directorModule) => directorModule.PlatformDirectorChat)
    // Falha de rede ou deploy novo: mantém o botão e oferece recarregar, sem derrubar a página.
    .catch((): ComponentType<PlatformDirectorChatProps> => PlatformDirectorLoadFailed),
  {
    loading: () => <PlatformDirectorLauncher state="loading" />,
    ssr: false
  }
);

export function AppShell({ accessPreviewMode, branding, canUseAccessPreview = false, children, student }: AppShellProps) {
  const logoImage = branding === undefined ? "/brand/logo-bunker.svg" : branding.logoImage;
  // Estilo escolhido em Area de membros > Marca: cantos (variaveis CSS no raiz) e posicao do menu.
  const style = normalizeMemberStyle(branding);
  const menuInHeader = style.menu === "header";
  const pathname = usePathname();
  const router = useNavigationFeedbackRouter();
  const { startNavigation } = useNavigationFeedback();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSolidOpacity, setHeaderSolidOpacity] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [directorRequested, setDirectorRequested] = useState(false);
  const [directorOpenOnMount, setDirectorOpenOnMount] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const railMenuButtonRef = useRef<HTMLButtonElement>(null);
  // Botao que abriu a gaveta (trilho no computador, topo no celular): recebe o foco ao fechar.
  const sidebarTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function updateHeaderState() {
      setHeaderSolidOpacity(Math.min(window.scrollY / 72, 1));
    }

    updateHeaderState();
    window.addEventListener("scroll", updateHeaderState, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateHeaderState);
    };
  }, []);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const iconButtonChrome = "border-transparent bg-transparent hover:bg-white/10";
  const showPreviewControl = canUseAccessPreview;
  const homeHref = withAccessPreviewParam("/", accessPreviewMode);
  const closeSidebarMenu = useCallback(() => setSidebarOpen(false), []);

  function handleProgressAwareNavigation(event: MouseEvent<HTMLAnchorElement>, href: string, closeSidebar = false) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    startNavigation(href);

    if (closeSidebar) {
      setSidebarOpen(false);
    }

    void (async () => {
      await window.__bunker707FlushLessonProgress?.();
      await flushPendingSavedItemChanges();
      router.push(href);
    })();
  }

  function handleAccessPreviewChange(value: string) {
    if (!canUseAccessPreview) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());

    if (value === "current") {
      nextSearchParams.delete(ACCESS_PREVIEW_PARAM);
    } else {
      nextSearchParams.set(ACCESS_PREVIEW_PARAM, value);
    }

    const queryString = nextSearchParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    setSidebarOpen(false);
  }

  function handleDirectorNavigation(event: MouseEvent<HTMLAnchorElement>, href: string) {
    handleProgressAwareNavigation(event, withAccessPreviewParam(href, accessPreviewMode));
  }

  function openSidebar(trigger: HTMLElement | null) {
    sidebarTriggerRef.current = trigger;
    // A IA Diretor desmonta enquanto o menu está aberto; ao voltar, ela não reabre sozinha.
    setDirectorOpenOnMount(false);
    setSidebarOpen(true);
  }

  function warmUpDirectorChat() {
    // Antecipa o download do chunk no hover/foco; o clique costuma encontrá-lo pronto.
    void import("@/components/platform-director-chat").catch(() => undefined);
  }

  function activateDirectorChat() {
    setDirectorOpenOnMount(true);
    setDirectorRequested(true);
  }

  async function handleSignOut() {
    setSigningOut(true);

    // Salvar progresso e favoritos é melhor esforço: nunca impede a saída.
    await Promise.allSettled([
      window.__bunker707FlushLessonProgress?.(),
      flushPendingSavedItemChanges()
    ]);

    // O servidor encerra a sessão e a navegação completa descarta o cache do router
    // e o estado do aluno na memória.
    await signOutAndLeave();
  }

  return (
    <PlatformBrandingProvider branding={branding}>
    <div className="min-h-screen bg-[#141414] text-white" data-member-menu={style.menu} style={memberStyleCssVars(style)}>
      <header className={cn("fixed left-0 right-0 top-0 z-40 overflow-hidden", !menuInHeader && "md:left-[80px]")}>
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.26)_58%,rgba(0,0,0,0)_100%)] transition-opacity duration-300 ease-out will-change-opacity"
          style={{ opacity: Math.max(1 - headerSolidOpacity * 1.15, 0) }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#141414] shadow-[0_10px_38px_rgba(0,0,0,0.42)] transition-[opacity,transform] duration-300 ease-out will-change-[opacity,transform]"
          style={{
            opacity: headerSolidOpacity,
            transform: `scaleY(${Math.max(headerSolidOpacity, 0.001)})`,
            transformOrigin: "top"
          }}
        />
        <div className="relative flex h-16 items-center gap-4 px-4 sm:px-6">
          <button
            aria-controls={sidebarId}
            aria-expanded={sidebarOpen}
            aria-haspopup="dialog"
            aria-label="Abrir menu"
            className={cn("grid h-10 w-10 place-items-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white", !menuInHeader && "md:hidden", iconButtonChrome)}
            onClick={(event) => openSidebar(event.currentTarget)}
            ref={menuButtonRef}
            type="button"
          >
            <Menu aria-hidden="true" className="size-6" strokeWidth={1.5} />
          </button>

          <Link
            aria-label="Ir para o início"
            className={cn("flex min-w-fit items-center rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white", !menuInHeader && "md:hidden")}
            href={homeHref}
            onClick={(event) => handleProgressAwareNavigation(event, homeHref)}
          >
            {logoImage ? (
              <Image
                alt="Bunker707"
                className="h-auto max-h-10 w-[124px] object-contain object-left sm:w-[150px]"
                height={35}
                priority
                src={logoImage}
                unoptimized={!canOptimizeImageSrc(logoImage)}
                width={306}
              />
            ) : (
              <span className="text-lg font-black uppercase tracking-wide text-white sm:text-xl">Bunker707</span>
            )}
          </Link>

          <div className={`ml-auto flex min-w-0 items-center gap-2 ${searchOpen ? "max-sm:flex-1" : ""}`}>
            {showPreviewControl ? (
              <label className={`hidden h-10 items-center gap-2 rounded-[8px] border border-white/10 bg-black/25 px-2 text-xs font-bold text-zinc-300 backdrop-blur transition focus-within:border-white/25 md:flex ${searchOpen ? "max-lg:hidden" : ""}`}>
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-400" />
                <span className="sr-only">Modo de visualização</span>
                <AccessPreviewSelect
                  className="h-8 border-0 bg-transparent text-xs font-bold text-white outline-none"
                  label="Modo de visualização"
                  onChange={handleAccessPreviewChange}
                  value={accessPreviewMode ?? "current"}
                />
              </label>
            ) : null}
            <div
              className={`flex h-10 shrink-0 items-center overflow-hidden rounded-[6px] border transition-[width,background-color,border-color] duration-300 ease-out ${
                searchOpen
                  ? "w-[min(340px,42vw)] border-white/15 bg-black/40 px-1 max-sm:w-full"
                  : "w-10 border-transparent bg-transparent"
              }`}
            >
              <button
                aria-expanded={searchOpen}
                aria-label={searchOpen ? "Fechar busca" : "Abrir busca"}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[6px] transition hover:bg-white/10"
                onClick={() => setSearchOpen((current) => !current)}
                type="button"
              >
                <Search className="h-4 w-4" />
              </button>
              <input
                ref={searchInputRef}
                aria-label="Pesquisar aulas, cursos, formações e bootcamps"
                className={`min-w-0 flex-1 border-0 bg-transparent pr-3 text-sm text-white outline-none placeholder:text-zinc-500 transition-opacity duration-200 ${
                  searchOpen ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                  }
                }}
                placeholder="Pesquisar aulas, cursos, formações e bootcamps..."
              />
            </div>
            <MemberNotificationsMenu className={searchOpen ? "max-sm:hidden" : undefined} />
            <MemberAccountMenu
              accessPreviewMode={accessPreviewMode}
              className={searchOpen ? "max-sm:hidden" : undefined}
              onNavigate={(event, href) => handleProgressAwareNavigation(event, href)}
              onSignOut={() => void handleSignOut()}
              pathname={pathname}
              signingOut={signingOut}
              student={student}
            />
          </div>
        </div>
      </header>

      {menuInHeader ? null : (
      <MemberRail
        accessPreviewMode={accessPreviewMode}
        homeHref={homeHref}
        menuButtonRef={railMenuButtonRef}
        menuId={sidebarId}
        menuOpen={sidebarOpen}
        onNavigate={(event, href) => handleProgressAwareNavigation(event, href)}
        onOpenMenu={() => openSidebar(railMenuButtonRef.current)}
        pathname={pathname}
      />
      )}

      <MemberSidebar
        accessPreviewMode={accessPreviewMode}
        homeHref={homeHref}
        id={sidebarId}
        logoImage={logoImage}
        onClose={closeSidebarMenu}
        onNavigate={(event, href) => handleProgressAwareNavigation(event, href, true)}
        open={sidebarOpen}
        pathname={pathname}
        producerPanel={showPreviewControl ? (
          <section aria-label="Área do produtor" className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-3">
            <p className="flex items-center gap-2 px-1 text-xs font-semibold text-zinc-400">
              <ShieldCheck aria-hidden="true" className="size-4 text-emerald-400" />
              Área do produtor
            </p>
            <Link
              className="group/admin mt-3 flex h-10 items-center gap-2.5 rounded-[10px] border border-red-500/25 bg-red-500/10 px-3 text-sm font-semibold text-red-100 outline-none transition-colors hover:border-red-400/45 hover:bg-red-500/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/80"
              href="/admin"
              onClick={(event) => handleProgressAwareNavigation(event, "/admin", true)}
            >
              <LayoutDashboard aria-hidden="true" className="size-4 shrink-0" />
              <span className="flex-1">Ir para o admin</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-hover/admin:translate-x-0.5 motion-reduce:transition-none" />
            </Link>
            <label className="mt-3 grid gap-1.5 px-1 text-xs font-semibold text-zinc-400">
              Modo de visualização
              <AccessPreviewSelect
                className="h-10 w-full rounded-[10px] border border-white/10 bg-black/30 px-2.5 text-sm font-semibold text-white outline-none transition focus:border-white/30"
                label="Modo de visualização no menu"
                onChange={handleAccessPreviewChange}
                value={accessPreviewMode ?? "current"}
              />
            </label>
          </section>
        ) : null}
        returnFocusRef={sidebarTriggerRef}
      />

      <main className={cn(!menuInHeader && "md:pl-[80px]")}>{children}</main>

      {!sidebarOpen ? (
        directorRequested ? (
          <PlatformDirectorChat defaultOpen={directorOpenOnMount} onNavigate={handleDirectorNavigation} studentName={student.name} />
        ) : (
          <PlatformDirectorLauncher onActivate={activateDirectorChat} onWarmUp={warmUpDirectorChat} />
        )
      ) : null}

    </div>
    </PlatformBrandingProvider>
  );
}
