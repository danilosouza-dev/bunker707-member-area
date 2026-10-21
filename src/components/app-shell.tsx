"use client";

import { ArrowRight, LayoutDashboard, LoaderCircle, Menu, Search, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentType, type MouseEvent } from "react";
import { MemberPopupHost } from "@/components/member/notifications/member-popup-host";
import { DirectorIcon } from "@/components/member/shell/director-parts";
import { MemberAccountMenu } from "@/components/member/shell/member-account-menu";
import { MemberNotificationsMenu } from "@/components/member/shell/member-notifications-menu";
import { getMemberSidebarSections } from "@/components/member/shell/member-shell-model";
import { MemberSidebar } from "@/components/member/shell/member-sidebar";
import { useNavigationFeedback, useNavigationFeedbackRouter } from "@/components/navigation-feedback";
import { PlatformBrandingProvider } from "@/components/platform-branding";
import type { PlatformDirectorChat as PlatformDirectorChatComponent } from "@/components/platform-director-chat";
import { flushPendingSavedItemChanges } from "@/components/saved-item-button";
import { ACCESS_PREVIEW_PARAM, withAccessPreviewParam } from "@/lib/access-preview";
import { isAdminPath } from "@/lib/auth/redirect";
import { signOutAndLeave } from "@/lib/auth/sign-out";
import { normalizeMemberStyle } from "@/lib/member-style";
import { cn } from "@/lib/utils";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import type { ContentPageHeroCorners, PlatformBrandingConfig } from "@/lib/platform-types";
import { SCHOOL_DEFAULT_ICON } from "@/server/communications/message-meta";
import type { AccessPreviewMode } from "@/lib/access-preview";

type AppShellProps = {
  accessPreviewMode?: AccessPreviewMode;
  /** Cantos do banner desta pagina (Produto > Detalhes): "rounded" recua logo e foto do perfil como no estilo arredondado. */
  bannerCorners?: ContentPageHeroCorners;
  branding?: PlatformBrandingConfig;
  canUseAccessPreview?: boolean;
  children: React.ReactNode;
  student: {
    avatarUrl?: string | null;
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
// por MemberSidebar (gaveta por cima da pagina, aberta pelo hamburguer do cabecalho, como no YouTube)
// e MemberAccountMenu (src/components/member/shell/). Hamburguer e logo ficam sempre no cabecalho; a
// gaveta repete os dois no mesmo lugar ao abrir.
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

export function AppShell({ accessPreviewMode, bannerCorners, branding, canUseAccessPreview = false, children, student }: AppShellProps) {
  const logoImage = branding === undefined ? "/brand/logo-bunker.svg" : branding.logoImage;
  // Estilo escolhido em Area de membros > Marca: cantos (variaveis CSS no raiz) e posicao do menu.
  const style = normalizeMemberStyle(branding);
  // Menu no cabecalho (estilo Netflix): os destinos de "Estudar" viram links escritos no topo a partir de
  // 1024 px e o hamburguer some nessa largura; abaixo disso ele abre a gaveta como sempre.
  // Suporte e Perfil ficam no menu da conta, que ja os tem.
  const menuInHeader = style.menu === "header";
  // Cantos arredondados: a capa recua 64 px (perto da Netflix); a logo fica nessa linha (hamburguer a
  // 16 px + 40 px + 8 px, ou o cabecalho recuado 64 px quando os links escritos dispensam o hamburguer) e
  // o cabecalho recua o mesmo a direita, para a foto do perfil alinhar com a borda da capa. Vale tambem
  // quando so o banner desta pagina e arredondado (escolha do produto): logo e perfil seguem o banner.
  const rounded = style.corners === "rounded" || bannerCorners === "rounded";
  const pathname = usePathname();
  // Home fora do "ver como": o pop-up dos avisos pode aparecer, e o pedido dele traz o numero do sino.
  const popupHome = pathname === "/" && !accessPreviewMode;
  const headerLinks = menuInHeader
    ? (getMemberSidebarSections(pathname, accessPreviewMode).find((section) => section.id === "estudar")?.items ?? [])
    : [];
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

      // Admin: carregamento inteiro, depois de salvar progresso e favoritos (o microfone dos avisos so
      // e liberado num documento carregado em /admin; isAdminPath).
      if (isAdminPath(href)) {
        window.location.assign(href);
        return;
      }

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

  function openSidebar() {
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
    <div className="min-h-screen bg-[#141414] text-white" data-member-buttons={style.buttons} data-member-corners={style.corners} data-member-menu={style.menu}>
      <header className="fixed left-0 right-0 top-0 z-40 overflow-hidden">
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
        <div className={cn("relative flex h-16 items-center gap-2 px-4", rounded ? "sm:pr-16" : "sm:px-6", rounded && menuInHeader && "lg:pl-16")}>
          <button
            aria-controls={sidebarId}
            aria-expanded={sidebarOpen}
            aria-haspopup="dialog"
            aria-label="Abrir menu"
            className={cn("grid h-10 w-10 place-items-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white", menuInHeader && "lg:hidden", iconButtonChrome)}
            onClick={openSidebar}
            ref={menuButtonRef}
            type="button"
          >
            <Menu aria-hidden="true" className="size-6" strokeWidth={1.5} />
          </button>

          <Link
            aria-label="Ir para o início"
            className="flex min-w-fit items-center rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
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

          {menuInHeader ? (
            <nav aria-label="Navegação principal" className="ml-5 hidden min-w-0 items-center gap-1 lg:flex">
              {headerLinks.map((item) => (
                <Link
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none",
                    item.active ? "bg-white/[0.12] font-bold text-white" : "font-medium text-zinc-300 hover:text-white"
                  )}
                  href={item.href}
                  key={item.key}
                  onClick={(event) => handleProgressAwareNavigation(event, item.href)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}

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
            <MemberNotificationsMenu
              accessPreviewMode={accessPreviewMode}
              className={searchOpen ? "max-sm:hidden" : undefined}
              onNavigate={(event, href) => handleProgressAwareNavigation(event, href)}
              refreshSummaryOnMount={!popupHome}
              // O circulo dos avisos da escola e o Icone da escola (Marca); a logo fica no topo e de reserva.
              schoolIconUrl={branding?.schoolIcon ?? SCHOOL_DEFAULT_ICON}
              schoolLogoUrl={logoImage}
              schoolName="Bunker707"
            />
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
        returnFocusRef={menuButtonRef}
      />

      <main>{children}</main>

      {/* Pop-up dos avisos: so na home e fora do modo "ver como" do produtor (docs/22 §1.3). */}
      <MemberPopupHost enabled={popupHome} onNavigate={(event, href) => handleProgressAwareNavigation(event, href)} />

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
