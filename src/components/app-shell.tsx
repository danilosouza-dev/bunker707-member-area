"use client";

import {
  Bell,
  Bookmark,
  Compass,
  FileText,
  Home,
  LibraryBig,
  LifeBuoy,
  LogOut,
  Menu,
  PlayCircle,
  Search,
  ShieldCheck,
  Trophy,
  UserCircle,
  X
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ACCESS_PREVIEW_PARAM, withAccessPreviewParam } from "@/lib/access-preview";
import type { NavigationItem } from "@/lib/platform-types";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type AppShellProps = {
  accessPreviewMode?: AccessPreviewMode;
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

const navigationItems = [
  { label: "Home", href: "/", icon: Home },
  { label: "Minha jornada", icon: Compass },
  { label: "Minhas compras", href: "/minhas-compras", icon: LibraryBig },
  { label: "Favoritos", href: "/favoritos", icon: Bookmark },
  { label: "Continue assistindo", icon: PlayCircle },
  { label: "Materiais", icon: FileText },
  { label: "Suporte", icon: LifeBuoy },
  { label: "Perfil", icon: UserCircle }
] satisfies NavigationItem[];

export function AppShell({ accessPreviewMode, canUseAccessPreview = false, children, student }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSolidOpacity, setHeaderSolidOpacity] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  const profileChrome = "border-transparent bg-black/10 hover:bg-white/10";
  const showPreviewControl = canUseAccessPreview;
  const homeHref = withAccessPreviewParam("/", accessPreviewMode);

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

    if (closeSidebar) {
      setSidebarOpen(false);
    }

    void (async () => {
      await window.__bunker707FlushLessonProgress?.();
      router.push(href);
      window.setTimeout(() => {
        router.refresh();
      }, 0);
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
    router.refresh();
  }

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST"
      });

      try {
        const supabase = createBrowserSupabaseClient();
        await supabase.auth.signOut();
      } catch {
        // In local development without Supabase, only the local cookie exists.
      }
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white">
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
        <div className="relative flex h-16 items-center gap-4 px-4 sm:px-6">
          <button
            aria-label="Abrir menu"
            className={`grid h-10 w-10 place-items-center rounded-[6px] border transition ${iconButtonChrome}`}
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link
            aria-label="Voltar para a home"
            className="flex min-w-fit items-center rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            href={homeHref}
            onClick={(event) => handleProgressAwareNavigation(event, homeHref)}
            prefetch={false}
          >
            <Image
              alt="Bunker707"
              className="h-auto w-[150px] sm:w-[190px]"
              height={35}
              priority
              src="/brand/logo-bunker.svg"
              unoptimized
              width={306}
            />
          </Link>

          <div className={`ml-auto flex min-w-0 items-center gap-2 ${searchOpen ? "max-sm:flex-1" : ""}`}>
            {showPreviewControl ? (
              <label className={`hidden h-10 items-center gap-2 rounded-[6px] border border-white/10 bg-black/25 px-2 text-xs font-bold text-zinc-300 backdrop-blur transition focus-within:border-white/25 md:flex ${searchOpen ? "max-lg:hidden" : ""}`}>
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="sr-only">Modo de visualizacao</span>
                <select
                  aria-label="Modo de visualizacao"
                  className="h-8 border-0 bg-transparent text-xs font-bold text-white outline-none"
                  onChange={(event) => handleAccessPreviewChange(event.target.value)}
                  value={accessPreviewMode ?? "current"}
                >
                  <option className="bg-[#141414]" value="current">Sessao atual</option>
                  <option className="bg-[#141414]" value="producer">Produtor/admin</option>
                  <option className="bg-[#141414]" value="student_with_access">Aluno com acesso</option>
                  <option className="bg-[#141414]" value="student_without_access">Aluno sem acesso</option>
                </select>
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
                aria-label="Pesquisar aulas, cursos, formacoes e bootcamps"
                className={`min-w-0 flex-1 border-0 bg-transparent pr-3 text-sm text-white outline-none placeholder:text-zinc-500 transition-opacity duration-200 ${
                  searchOpen ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                  }
                }}
                placeholder="Pesquisar aulas, cursos, formacoes e bootcamps..."
              />
            </div>
            <button
              className={`grid h-10 w-10 place-items-center rounded-[6px] border transition ${searchOpen ? "max-sm:hidden" : ""} ${iconButtonChrome}`}
              type="button"
            >
              <Trophy className="h-4 w-4" />
            </button>
            <button
              className={`grid h-10 w-10 place-items-center rounded-[6px] border transition ${searchOpen ? "max-sm:hidden" : ""} ${iconButtonChrome}`}
              type="button"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              className={`flex h-10 items-center gap-2 rounded-[6px] border px-2 pr-3 transition ${searchOpen ? "max-sm:hidden" : ""} ${profileChrome}`}
              type="button"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-700 text-xs font-bold">
                {student.name.slice(0, 1)}
              </span>
              <span className="hidden text-sm font-semibold sm:block">{student.name}</span>
            </button>
          </div>
        </div>
      </header>

      <div
        aria-hidden={!sidebarOpen}
        className={`fixed inset-0 z-50 transition ${
          sidebarOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
          <button
            aria-label="Fechar menu"
            className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition duration-300 ${
              sidebarOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
          <aside
            className={`relative flex h-full w-[min(380px,92vw)] flex-col border-r border-white/10 bg-[#121212] shadow-2xl shadow-black transition duration-300 ease-out ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <Link
                  aria-label="Voltar para a home"
                  className="inline-flex rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  href={homeHref}
                  onClick={(event) => handleProgressAwareNavigation(event, homeHref, true)}
                  prefetch={false}
                >
                  <Image
                    alt="Bunker707"
                    className="h-auto w-[210px]"
                    height={35}
                    src="/brand/logo-bunker.svg"
                    unoptimized
                    width={306}
                  />
                </Link>
              </div>
              <button
                aria-label="Fechar menu"
                className="grid h-10 w-10 place-items-center rounded-[6px] bg-white/10 transition hover:bg-white/15"
                onClick={() => setSidebarOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-white/10 p-5">
              <div className="flex items-center gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/10 text-lg font-bold">
                  {student.name.slice(0, 1)}
                </div>
                <div>
                  <p className="font-semibold">{student.fullName}</p>
                </div>
              </div>
            </div>

            {showPreviewControl ? (
              <div className="space-y-4 border-b border-white/10 p-5">
                <Link
                  className="flex items-center gap-3 rounded-[8px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100 transition hover:border-red-400/40 hover:bg-red-500/15 hover:text-white"
                  href="/admin"
                  onClick={() => setSidebarOpen(false)}
                >
                  <ShieldCheck className="h-5 w-5" />
                  Ir para o CRM
                </Link>
                <label className="grid gap-2 text-sm font-semibold text-zinc-300">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    Modo de visualizacao
                  </span>
                  <select
                    aria-label="Modo de visualizacao no menu"
                    className="h-11 rounded-[8px] border border-white/10 bg-black/30 px-3 text-sm font-bold text-white outline-none transition focus:border-white/25"
                    onChange={(event) => handleAccessPreviewChange(event.target.value)}
                    value={accessPreviewMode ?? "current"}
                  >
                    <option className="bg-[#141414]" value="current">Sessao atual</option>
                    <option className="bg-[#141414]" value="producer">Produtor/admin</option>
                    <option className="bg-[#141414]" value="student_with_access">Aluno com acesso</option>
                    <option className="bg-[#141414]" value="student_without_access">Aluno sem acesso</option>
                  </select>
                </label>
              </div>
            ) : null}

            <nav className="flex-1 overflow-y-auto p-3">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.href === "/"
                  ? pathname === "/"
                  : item.href
                    ? pathname.startsWith(item.href)
                    : false;
                const itemClassName = `mb-1 flex w-full items-center gap-3 rounded-[8px] px-4 py-3 text-left text-sm font-semibold transition ${
                  isActive
                    ? "bg-[var(--accent)] text-white"
                    : item.href
                      ? "text-zinc-300 hover:bg-white/10 hover:text-white"
                      : "cursor-default text-zinc-500"
                }`;

                if (item.href) {
                  const itemHref = withAccessPreviewParam(item.href, accessPreviewMode);

                  return (
                    <Link
                      className={itemClassName}
                      href={itemHref}
                      key={item.label}
                      onClick={(event) => handleProgressAwareNavigation(event, itemHref, true)}
                      prefetch={false}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  );
                }

                return (
                  <button
                    className={itemClassName}
                    disabled
                    key={item.label}
                    type="button"
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-white/10 p-5">

              <button
                className="flex w-full items-center gap-3 rounded-[8px] px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
                type="button"
              >
                <LogOut className="h-5 w-5" />
                {signingOut ? "Saindo..." : "Sair"}
              </button>
            </div>
          </aside>
        </div>

      <main>{children}</main>

    </div>
  );
}
