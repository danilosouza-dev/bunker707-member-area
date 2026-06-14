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
import { useState } from "react";
import type { LoginPageConfig, LoginProvider } from "@/lib/login-config";

type LoginExperienceProps = {
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

function LoginFormPanel({ config }: LoginExperienceProps) {
  const [showPassword, setShowPassword] = useState(false);
  const tone = panelToneClasses[config.panelTone];

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
        onSubmit={(event) => {
          event.preventDefault();
        }}
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
              id="login-email"
              placeholder={config.form.emailPlaceholder}
              type="email"
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
              id="login-password"
              placeholder={config.form.passwordPlaceholder}
              type={showPassword ? "text" : "password"}
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
              type="button"
            >
              <span className="text-[11px] font-medium leading-none underline decoration-white/15 underline-offset-2 group-hover:decoration-white/35">
                {config.form.forgotPasswordLabel}
              </span>
            </button>
          </div>
        </div>

        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--accent)] px-5 text-sm font-extrabold text-white shadow-[0_18px_42px_rgba(229,9,20,0.28)] transition hover:bg-[#ff1f2a]"
          type="submit"
        >
          {config.form.primaryCta}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      {config.providers.length > 0 ? (
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
                key={provider}
                type="button"
              >
                {providerCopy[provider].icon}
                {providerCopy[provider].label}
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

function VisualPanel({ config }: LoginExperienceProps) {
  return (
    <section className="relative hidden min-h-screen overflow-hidden bg-black lg:block">
      <Image
        alt={config.visual.alt}
        className="object-cover object-[72%_center]"
        fill
        priority
        sizes="(min-width: 1024px) 50vw, 100vw"
        src={config.visual.imageSrc}
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

export function LoginExperience({ config }: LoginExperienceProps) {
  const fullBackground = isFullBackgroundTemplate(config.template);
  const splitVisualLeft = config.template === "split-visual-left";
  const sideGlassRight = config.template === "side-glass-right";

  if (fullBackground) {
    return (
      <main className="relative min-h-screen overflow-x-hidden bg-[#070707] px-4 py-4 text-white sm:px-6 sm:py-6">
        <Image
          alt={config.visual.alt}
          className="object-cover"
          fill
          priority
          sizes="100vw"
          src={config.visual.imageSrc}
        />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(229,9,20,0.22),transparent_28rem),linear-gradient(to_top,rgba(7,7,7,0.96),rgba(7,7,7,0.16)_52%,rgba(7,7,7,0.78))]" />
        <div
          className={`relative z-10 mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl items-center ${
            sideGlassRight ? "justify-end" : "justify-center"
          }`}
        >
          <LoginFormPanel config={config} />
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#0d0d0d] text-white">
      <div className="absolute inset-0 lg:hidden">
        <Image
          alt={config.visual.alt}
          className="object-cover"
          fill
          priority
          sizes="(max-width: 1023px) 100vw, 1px"
          src={config.visual.imageSrc}
        />
        <div className="absolute inset-0 bg-black/72" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d]/40 to-[#0d0d0d]/80" />
      </div>

      <div className="relative z-10 grid min-h-screen grid-cols-1 items-stretch lg:grid-cols-2">
        {splitVisualLeft ? <VisualPanel config={config} /> : null}
        <div className="flex min-h-screen items-center justify-center bg-[#101010] px-6 py-8 sm:px-10 lg:px-16">
          <LoginFormPanel config={config} />
        </div>
        {!splitVisualLeft ? <VisualPanel config={config} /> : null}
      </div>
    </main>
  );
}
