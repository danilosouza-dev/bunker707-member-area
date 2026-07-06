"use client";

import {
  Apple,
  ArrowRight,
  Eye,
  EyeOff,
  HelpCircle,
  LockKeyhole,
  Mail
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import type { LoginPageConfig, LoginProvider } from "@/lib/login-config";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type LoginExperienceProps = {
  authConfigured: boolean;
  config: LoginPageConfig;
  localAuthEnabled: boolean;
  redirectTo?: string;
};

type LoginConfigProps = {
  config: LoginPageConfig;
};

const panelToneClasses = {
  dark: {
    panel:
      "border-white/10 bg-[#151515]/72 text-white shadow-[0_26px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl",
    muted: "text-zinc-400",
    field:
      "border-white/10 bg-black/35 text-white placeholder:text-zinc-600 focus-within:border-white/25 focus-within:bg-black/45",
    input: "text-white placeholder:text-zinc-600",
    secondaryButton:
      "border-white/10 bg-white/[0.04] text-white hover:border-white/18 hover:bg-white/[0.08]",
    link: "text-zinc-300 hover:text-white",
    logo: "image"
  },
  glass: {
    panel:
      "border-white/14 bg-black/48 text-white shadow-[0_32px_120px_rgba(0,0,0,0.62)] backdrop-blur-2xl",
    muted: "text-zinc-300",
    field:
      "border-white/12 bg-white/[0.08] text-white placeholder:text-zinc-500 focus-within:border-white/30 focus-within:bg-white/[0.11]",
    input: "text-white placeholder:text-zinc-500",
    secondaryButton:
      "border-white/12 bg-white/[0.07] text-white hover:border-white/22 hover:bg-white/[0.11]",
    link: "text-zinc-200 hover:text-white",
    logo: "image"
  },
  light: {
    panel:
      "border-black/10 bg-[#f4f4f1]/96 text-[#141414] shadow-[0_28px_80px_rgba(0,0,0,0.2)]",
    muted: "text-zinc-600",
    field:
      "border-black/10 bg-white text-[#141414] placeholder:text-zinc-500 focus-within:border-black/25",
    input: "text-[#141414] placeholder:text-zinc-500",
    secondaryButton:
      "border-black/10 bg-white text-[#141414] hover:border-black/20 hover:bg-zinc-100",
    link: "text-zinc-700 hover:text-black",
    logo: "text"
  }
} as const;

const providerCopy: Record<LoginProvider, { label: string; icon: React.ReactNode }> = {
  apple: {
    label: "Entrar com Apple",
    icon: <Apple className="h-4 w-4 fill-current" />
  },
  google: {
    label: "Entrar com Google",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        viewBox="0 0 24 24"
      >
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
          fill="#EA4335"
        />
      </svg>
    )
  }
};

function isFullBackgroundTemplate(template: LoginPageConfig["template"]) {
  return template === "center-glass" || template === "side-glass-right";
}

function mustChangePassword(userMetadata: unknown) {
  const metadata = userMetadata as { must_change_password?: unknown } | null;

  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      metadata.must_change_password === true
  );
}

function getPasswordChangeRedirectPath(safeRedirectPath: string) {
  const passwordChangePath = new URL("/alterar-senha", window.location.origin);
  passwordChangePath.searchParams.set("next", safeRedirectPath);
  return `${passwordChangePath.pathname}${passwordChangePath.search}`;
}

async function getPostLoginRedirectPath(userMetadata: unknown, safeRedirectPath: string) {
  if (mustChangePassword(userMetadata)) {
    return getPasswordChangeRedirectPath(safeRedirectPath);
  }

  try {
    const response = await fetch(`/api/auth/post-login?next=${encodeURIComponent(safeRedirectPath)}`, {
      cache: "no-store"
    });
    const payload = await response.json() as { redirectTo?: string };

    if (response.ok && payload.redirectTo) {
      return getSafeRedirectPath(payload.redirectTo);
    }
  } catch {
    // Keep login usable if the redirect resolver is temporarily unavailable.
  }

  return safeRedirectPath;
}

function LoginFormPanel({ authConfigured, config, localAuthEnabled, redirectTo }: LoginExperienceProps) {
  const router = useRouter();
  const safeRedirectPath = getSafeRedirectPath(redirectTo);
  const [activeProvider, setActiveProvider] = useState<LoginProvider | null>(null);
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingLocal, setSubmittingLocal] = useState(false);
  const tone = panelToneClasses[config.panelTone];
  const canSubmit = authConfigured || localAuthEnabled;

  useEffect(() => {
    if (!authConfigured) {
      return;
    }

    let active = true;
    const supabase = createBrowserSupabaseClient();

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session?.user) {
        return;
      }

      router.replace(await getPostLoginRedirectPath(data.session.user.user_metadata, safeRedirectPath));
      router.refresh();
    });

    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active || !session?.user) {
        return;
      }

      router.replace(await getPostLoginRedirectPath(session.user.user_metadata, safeRedirectPath));
      router.refresh();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [authConfigured, router, safeRedirectPath]);

  async function recordLoginEvent(
    supabase: ReturnType<typeof createBrowserSupabaseClient>,
    userId: string,
    method: "password" | LoginProvider
  ) {
    await supabase.from("student_events").insert({
      entity_type: "auth",
      event_type: "user_signed_in",
      metadata: {
        method,
        source: "login_page"
      },
      user_id: userId
    });
  }

  async function handleLocalLogin() {
    setErrorMessage("");
    setNoticeMessage("");
    setSubmittingLocal(true);

    try {
      const response = await fetch("/api/auth/local-login", {
        method: "POST"
      });

      if (!response.ok) {
        setErrorMessage("Nao foi possivel iniciar o modo local.");
        return;
      }

      router.replace(safeRedirectPath);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel iniciar o modo local.");
    } finally {
      setSubmittingLocal(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setNoticeMessage("");

    if (!authConfigured) {
      if (localAuthEnabled) {
        await handleLocalLogin();
        return;
      }

      setErrorMessage("Autenticacao indisponivel neste ambiente.");
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setErrorMessage("Informe email e senha para entrar.");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password
      });

      if (error || !data.user) {
        setErrorMessage("Email ou senha invalidos.");
        return;
      }

      await recordLoginEvent(supabase, data.user.id, "password");
      router.replace(await getPostLoginRedirectPath(data.user.user_metadata, safeRedirectPath));
      router.refresh();
    } catch {
      setErrorMessage(
        localAuthEnabled
          ? "Nao foi possivel conectar ao Supabase agora. Em localhost, use o modo local de desenvolvimento."
          : "Nao foi possivel autenticar agora."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth(provider: LoginProvider) {
    setErrorMessage("");
    setNoticeMessage("");

    if (!authConfigured) {
      setErrorMessage("Autenticacao indisponivel neste ambiente.");
      return;
    }

    setActiveProvider(provider);

    try {
      const supabase = createBrowserSupabaseClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", safeRedirectPath);
      callbackUrl.searchParams.set("provider", provider);
      const { error } = await supabase.auth.signInWithOAuth({
        options: {
          redirectTo: callbackUrl.toString()
        },
        provider
      });

      if (error) {
        setErrorMessage("Nao foi possivel iniciar o login social.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel iniciar o login social.");
    } finally {
      setActiveProvider(null);
    }
  }

  async function handlePasswordReset() {
    setErrorMessage("");
    setNoticeMessage("");

    if (!authConfigured) {
      setErrorMessage("Autenticacao indisponivel neste ambiente.");
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage("Informe seu email para receber o link de recuperacao.");
      return;
    }

    try {
      const supabase = createBrowserSupabaseClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", "/alterar-senha");
      callbackUrl.searchParams.set("provider", "email");
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: callbackUrl.toString()
      });

      if (error) {
        setErrorMessage("Nao foi possivel enviar a recuperacao de senha.");
        return;
      }

      setNoticeMessage("Se o email existir na base, enviaremos um link de recuperacao.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel enviar a recuperacao de senha.");
    }
  }

  return (
    <section
      aria-label="Formulario de login"
      className={`relative z-10 w-full max-w-[27rem] rounded-[8px] border p-6 sm:p-7 lg:p-8 ${tone.panel}`}
    >
      <div className="mb-10 flex items-center justify-center">
        {tone.logo === "image" ? (
          <Image
            alt={config.logo.alt}
            className="h-auto w-[154px]"
            height={35}
            priority
            src={config.logo.src}
            width={306}
          />
        ) : (
          <span className="text-xl font-black">{config.brandName}</span>
        )}
      </div>

      {config.form.title || config.form.subtitle ? (
        <div className="pb-1.5">
          {config.form.title ? (
        <h1 className="text-3xl font-black leading-tight sm:text-4xl">{config.form.title}</h1>
          ) : null}
          {config.form.subtitle ? (
            <p className={`mt-3 text-sm leading-6 sm:text-base ${tone.muted}`}>
              {config.form.subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={handleSubmit}
      >
        <div>
          <label className="text-sm font-semibold" htmlFor="login-email">
            {config.form.emailLabel}
          </label>
          <div
            className={`mt-2 flex h-11 items-center gap-3 rounded-[8px] border px-4 transition ${tone.field}`}
          >
            <Mail className="h-4 w-4 text-zinc-500" />
            <input
              autoComplete="email"
              className={`min-w-0 flex-1 border-0 bg-transparent text-sm outline-none ${tone.input}`}
              disabled={submitting || !authConfigured}
              id="login-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={config.form.emailPlaceholder}
              required
              type="email"
              value={email}
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold" htmlFor="login-password">
            {config.form.passwordLabel}
          </label>
          <div
            className={`mt-2 flex h-11 items-center gap-3 rounded-[8px] border px-4 transition ${tone.field}`}
          >
            <LockKeyhole className="h-4 w-4 text-zinc-500" />
            <input
              autoComplete="current-password"
              className={`min-w-0 flex-1 border-0 bg-transparent text-sm outline-none ${tone.input}`}
              disabled={submitting || !authConfigured}
              id="login-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={config.form.passwordPlaceholder}
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-zinc-400 transition hover:bg-white/10 hover:text-white"
              onClick={() => setShowPassword((current) => !current)}
              type="button"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1 flex justify-end">
            <button
              className="group text-[0] leading-none text-zinc-600 transition hover:text-zinc-400"
              disabled={!authConfigured}
              onClick={handlePasswordReset}
              type="button"
            >
              <span className="text-[11px] font-medium leading-none underline decoration-white/15 underline-offset-2 group-hover:decoration-white/35">
                {config.form.forgotPasswordLabel}
              </span>
            </button>
          </div>
        </div>

        {!authConfigured && localAuthEnabled ? (
          <p className="rounded-[8px] border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100">
            Modo local de desenvolvimento ativo. Use este acesso para navegar no MVP sem configurar Supabase.
          </p>
        ) : null}

        {authConfigured && localAuthEnabled ? (
          <p className="rounded-[8px] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100">
            Supabase configurado. Se ele estiver indisponivel no localhost, use o modo local de desenvolvimento.
          </p>
        ) : null}

        {!authConfigured && !localAuthEnabled ? (
          <p className="rounded-[8px] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-medium text-amber-100">
            Login temporariamente indisponivel. Fale com o suporte da Bunker707 para liberar seu acesso.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="rounded-[8px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {noticeMessage ? (
          <p className="rounded-[8px] border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100" role="status">
            {noticeMessage}
          </p>
        ) : null}

        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--accent)] px-5 text-sm font-extrabold text-white shadow-[0_18px_42px_rgba(229,9,20,0.28)] transition hover:bg-[#ff1f2a] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          disabled={submitting || submittingLocal || !canSubmit}
          type="submit"
        >
          {submitting ? "Entrando..." : localAuthEnabled && !authConfigured ? "Entrar em modo local" : config.form.primaryCta}
          <ArrowRight className="h-4 w-4" />
        </button>

        {authConfigured && localAuthEnabled ? (
          <button
            className={`flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-55 ${tone.secondaryButton}`}
            disabled={submitting || submittingLocal}
            onClick={() => void handleLocalLogin()}
            type="button"
          >
            {submittingLocal ? "Entrando..." : "Entrar em modo local"}
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </form>

      {authConfigured && config.providers.length > 0 ? (
        <div className="mt-6">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className={`text-xs font-medium ${tone.muted}`}>ou continue com</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="mt-4 grid gap-3">
            {config.providers.map((provider) => (
              <button
                className={`flex h-10 items-center justify-center gap-2 rounded-[8px] border text-sm font-bold transition ${tone.secondaryButton}`}
                disabled={Boolean(activeProvider) || !authConfigured}
                key={provider}
                onClick={() => void handleOAuth(provider)}
                type="button"
              >
                {providerCopy[provider].icon}
                {activeProvider === provider ? "Abrindo..." : providerCopy[provider].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={`mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${tone.muted}`}>
        <HelpCircle className="h-4 w-4 shrink-0" />
        <span>{config.form.supportLabel}</span>
        <a className={`font-semibold transition ${tone.link}`} href="#">
          {config.form.supportCta}
        </a>
      </div>

      {config.footerLinks.length > 0 ? (
        <div className={`mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs ${tone.muted}`}>
        {config.footerLinks.map((link) => (
          <a className={`transition ${tone.link}`} href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
        </div>
      ) : null}
    </section>
  );
}

function VisualPanel({ config }: LoginConfigProps) {
  return (
    <section className="relative hidden h-screen min-h-screen overflow-hidden bg-black lg:block">
      <Image
        alt={config.visual.alt}
        className="absolute inset-0 h-full w-full object-cover object-[72%_center]"
        height={1024}
        priority
        sizes="(min-width: 1024px) 50vw, 100vw"
        src={config.visual.imageSrc}
        unoptimized
        width={1536}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/12 via-black/18 to-black/28" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/18 to-black/18" />
      <div className="absolute bottom-[13%] left-0 max-w-xl p-8 xl:p-12">
        {config.visual.title ? (
          <div
            className="max-w-[29rem] text-white"
            style={{
              fontFamily:
                "var(--font-exo-2), var(--font-inter), system-ui, sans-serif"
            }}
          >
            <span
              aria-hidden="true"
              className="block h-9 text-6xl font-bold leading-none text-white/80"
              style={{ fontFamily: "Georgia, serif" }}
            >
              &ldquo;
            </span>
            <h2 className="text-2xl font-semibold leading-[1.16] text-white/95 sm:text-3xl">
              {config.visual.title}
            </h2>
          </div>
        ) : null}
        {config.visual.description ? (
          <p className="mt-4 max-w-lg text-base leading-7 text-zinc-200">
            {config.visual.description}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function LoginExperience(props: LoginExperienceProps) {
  const { config } = props;
  const fullBackground = isFullBackgroundTemplate(config.template);
  const splitVisualLeft = config.template === "split-visual-left";
  const sideGlassRight = config.template === "side-glass-right";

  if (fullBackground) {
    return (
      <main className="relative min-h-screen overflow-x-hidden bg-[#070707] px-4 py-4 text-white sm:px-6 sm:py-6">
        <Image
          alt={config.visual.alt}
          className="absolute inset-0 h-full w-full object-cover"
          height={1024}
          priority
          sizes="100vw"
          src={config.visual.imageSrc}
          unoptimized
          width={1536}
        />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(229,9,20,0.22),transparent_28rem),linear-gradient(to_top,rgba(7,7,7,0.96),rgba(7,7,7,0.16)_52%,rgba(7,7,7,0.78))]" />
        <div
          className={`relative z-10 mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl items-center ${
            sideGlassRight ? "justify-end" : "justify-center"
          }`}
        >
          <LoginFormPanel {...props} />
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#0d0d0d] text-white">
      <div className="absolute inset-0 lg:hidden">
        <Image
          alt={config.visual.alt}
          className="absolute inset-0 h-full w-full object-cover"
          height={1024}
          priority
          sizes="(max-width: 1023px) 100vw, 1px"
          src={config.visual.imageSrc}
          unoptimized
          width={1536}
        />
        <div className="absolute inset-0 bg-black/72" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d]/40 to-[#0d0d0d]/80" />
      </div>

      <div className="relative z-10 grid min-h-screen grid-cols-1 items-stretch lg:grid-cols-2">
        {splitVisualLeft ? <VisualPanel config={config} /> : null}
        <div className="flex min-h-screen items-center justify-center bg-[#101010] px-6 py-8 sm:px-10 lg:px-16">
          <LoginFormPanel {...props} />
        </div>
        {!splitVisualLeft ? <VisualPanel config={config} /> : null}
      </div>
    </main>
  );
}
