"use client";

import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type PasswordChangeExperienceProps = {
  authConfigured: boolean;
  email?: string;
  nextPath?: string;
  requiresPasswordChange: boolean;
};

export function PasswordChangeExperience({
  authConfigured,
  email,
  nextPath = "/",
  requiresPasswordChange
}: PasswordChangeExperienceProps) {
  const router = useRouter();
  const safeNextPath = getSafeRedirectPath(nextPath);
  const redirectPath = safeNextPath === "/alterar-senha" ? "/" : safeNextPath;
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function getPostPasswordChangeRedirectPath() {
    try {
      const response = await fetch(`/api/auth/post-login?next=${encodeURIComponent(redirectPath)}&passwordChanged=true`, {
        cache: "no-store"
      });
      const payload = await response.json() as { redirectTo?: string };

      if (response.ok && payload.redirectTo) {
        return getSafeRedirectPath(payload.redirectTo);
      }
    } catch {
      // Keep the password flow usable if the redirect resolver is temporarily unavailable.
    }

    return redirectPath;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!authConfigured) {
      setErrorMessage("Autenticacao indisponivel neste ambiente.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Use uma senha com pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("As senhas nao conferem.");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const currentMetadata =
        userData.user?.user_metadata && typeof userData.user.user_metadata === "object"
          ? userData.user.user_metadata
          : {};
      const { error } = await supabase.auth.updateUser({
        data: {
          ...currentMetadata,
          must_change_password: false,
          password_changed_at: new Date().toISOString()
        },
        password
      });

      if (error) {
        setErrorMessage("Nao foi possivel atualizar a senha.");
        return;
      }

      if (userData.user) {
        await supabase.from("student_events").insert({
          entity_type: "auth",
          event_type: "password_changed",
          metadata: {
            source: "password_change_page"
          },
          user_id: userData.user.id
        });
      }

      router.replace(await getPostPasswordChangeRedirectPath());
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel atualizar a senha.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#090909] px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-[8px] border border-white/10 bg-[#151515] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)] sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[8px] bg-[var(--accent)]/15 text-[var(--accent)]">
            <LockKeyhole className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-zinc-500">Bunker707</p>
            <h1 className="text-2xl font-black text-white">Definir senha</h1>
          </div>
        </div>

        <p className="mt-5 text-sm font-medium leading-6 text-zinc-400">
          {requiresPasswordChange
            ? "Crie uma nova senha para liberar sua entrada na area de membros."
            : "Atualize sua senha de acesso para continuar."}
        </p>

        {email ? (
          <p className="mt-3 truncate rounded-[8px] border border-white/10 bg-black/25 px-3 py-2 text-sm font-semibold text-zinc-300">
            {email}
          </p>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Nova senha
            <span className="flex h-11 items-center gap-2 rounded-[8px] border border-white/10 bg-black/30 px-3 focus-within:border-white/30">
              <input
                autoComplete="new-password"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimo de 8 caracteres"
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="grid h-8 w-8 place-items-center rounded-[6px] text-zinc-400 transition hover:bg-white/10 hover:text-white"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          <label className="grid gap-2 text-sm font-bold text-zinc-400">
            Confirmar senha
            <input
              autoComplete="new-password"
              className="h-11 rounded-[8px] border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-white/30"
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repita a nova senha"
              required
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
            />
          </label>

          {errorMessage ? (
            <p className="rounded-[8px] border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
              {errorMessage}
            </p>
          ) : null}

          <button
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--accent)] px-4 py-2 text-sm font-black text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? <CheckCircle2 className="h-4 w-4 animate-pulse" /> : <ArrowRight className="h-4 w-4" />}
            {submitting ? "Salvando..." : "Salvar e entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
