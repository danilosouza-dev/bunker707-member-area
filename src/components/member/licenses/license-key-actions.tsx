"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { formatMemberDateTime } from "@/lib/member-format";
import { generateLicenseKey, revokeLicenseKey } from "@/server/licensing/interno/student-actions";

// Os botoes da Chave de ativacao de uma Licenca em Minhas licencas (docs/32 §2.4): Gerar chave, Trocar chave (com a
// confirmacao que diz o que para de funcionar) e Revogar. A Chave chega so na resposta da Server Action e fica so na
// memoria desta tela: aparece uma vez, com Copiar e os proximos passos, e some ao fechar ou sair da pagina. Nunca vai
// para o HTML, para o endereco, para o armazenamento do navegador nem para o servidor de novo.

type Shown = { key: string; validUntil: string | null; cutAddress: string | null };
type Confirming = { kind: "trocar" | "revogar"; warning: string };

export function LicenseKeyActions({
  canGenerate,
  canReplace,
  canRevoke,
  disabled,
  licenseId,
  replaceWarning
}: {
  canGenerate: boolean;
  canReplace: boolean;
  canRevoke: boolean;
  /** Falta o titular ou o aceite dos termos (o formulario acima), ou o servico de licencas nao respondeu. */
  disabled: boolean;
  licenseId: string;
  replaceWarning: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  function ask(next: Confirming) {
    setConfirming(next);
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    setConfirming(null);
  }

  async function generate(confirmReplace: boolean) {
    setBusy(true);
    setError(null);
    const result = await generateLicenseKey({ confirmReplace, licenseId });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.data.kind === "confirmar") {
      // A situacao mudou desde que a pagina abriu (uma chave gerada em outra aba): pede a confirmacao com o que o Emissor disse.
      const parts = [
        result.data.pendingKeyFinal ? `a chave terminada em ${result.data.pendingKeyFinal} deixa de valer` : null,
        result.data.address ? `a escola em ${result.data.address} sai da Licença e fica congelada na próxima conferência` : null
      ].filter(Boolean);
      ask({ kind: "trocar", warning: parts.length > 0 ? `Ao continuar, ${parts.join(", e ")}.` : replaceWarning });
      return;
    }

    setCopied(false);
    setShown({ cutAddress: result.data.cutAddress, key: result.data.key, validUntil: result.data.validUntil });
    router.refresh();
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    const result = await revokeLicenseKey({ licenseId });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setShown(null);
    router.refresh();
  }

  async function confirm() {
    const current = confirming;
    closeDialog();

    if (current?.kind === "trocar") {
      await generate(true);
    } else if (current?.kind === "revogar") {
      await revoke();
    }
  }

  async function copy() {
    if (!shown) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shown.key);
      setCopied(true);
    } catch {
      setError("Não deu para copiar sozinho: selecione a chave e copie.");
    }
  }

  const off = disabled || busy;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canGenerate ? (
          <button className={memberButtonClassName({ size: "sm", variant: "primary" })} disabled={off} onClick={() => void generate(false)} type="button">
            {busy ? "Gerando…" : "Gerar chave"}
          </button>
        ) : null}
        {canReplace ? (
          <button className={memberButtonClassName({ size: "sm" })} disabled={off} onClick={() => ask({ kind: "trocar", warning: replaceWarning })} type="button">
            Trocar chave
          </button>
        ) : null}
        {canRevoke ? (
          <button
            className={memberButtonClassName({ size: "sm", variant: "ghost" })}
            disabled={off}
            onClick={() => ask({ kind: "revogar", warning: `${replaceWarning} Nenhuma chave nova é gerada: quando quiser instalar de novo, use Gerar chave.` })}
            type="button"
          >
            Revogar
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm leading-6 text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {shown ? (
        <section aria-label="Chave de ativação" className="rounded-[12px] border border-emerald-400/25 bg-emerald-500/[0.06] p-4">
          <p className="text-sm font-semibold text-white">Sua chave de ativação</p>
          <p className="mt-1 text-[13px] leading-5 text-zinc-400">Ela aparece só desta vez. Copie e guarde num lugar seguro.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-[8px] bg-black/40 px-3 py-2 font-mono text-[15px] font-semibold tracking-wide text-white select-all">{shown.key}</code>
            <button className={memberButtonClassName({ size: "sm" })} onClick={() => void copy()} type="button">
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-zinc-300">
            <li>No servidor, rode o instalador e cole a chave quando ele pedir. A aula de instalação mostra o passo a passo.</li>
            <li>Se a escola já está instalada, abra no admin dela Configurações › Licença e cole a chave em Ativar.</li>
            {shown.validUntil ? <li>{`Comece a instalação até ${formatMemberDateTime(shown.validUntil)}. Depois disso, gere outra chave.`}</li> : null}
            <li>Perdeu a chave? Gere outra: a anterior para de funcionar.</li>
          </ol>
          {shown.cutAddress ? (
            <p className="mt-3 text-[13px] leading-5 text-amber-200">{`A escola em ${shown.cutAddress} saiu desta Licença e fica congelada na próxima conferência.`}</p>
          ) : null}
          <button className={memberButtonClassName({ className: "mt-4", size: "sm", variant: "ghost" })} onClick={() => setShown(null)} type="button">
            Já guardei, fechar
          </button>
        </section>
      ) : null}

      <dialog
        aria-labelledby={`confirmar-${licenseId}`}
        className="m-auto w-[min(92vw,30rem)] rounded-[14px] border border-white/10 bg-[#181818] p-6 text-white backdrop:bg-black/70"
        onClose={() => setConfirming(null)}
        ref={dialogRef}
      >
        <h3 className="text-lg font-bold" id={`confirmar-${licenseId}`}>
          {confirming?.kind === "revogar" ? "Revogar a chave?" : "Trocar a chave?"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{confirming?.warning}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button className={memberButtonClassName({ size: "sm", variant: "ghost" })} onClick={closeDialog} type="button">
            Cancelar
          </button>
          <button className={memberButtonClassName({ size: "sm", variant: confirming?.kind === "revogar" ? "danger" : "primary" })} onClick={() => void confirm()} type="button">
            {confirming?.kind === "revogar" ? "Revogar" : "Gerar a chave nova"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
