// Moldura dos e-mails transacionais: HTML simples com estilos inline (clientes de e-mail nao carregam
// CSS externo), fundo escuro e destaque vermelho do design system (docs/12). Modulo puro.

const COLORS = {
  accent: "#e50914",
  background: "#141414",
  border: "rgba(255, 255, 255, 0.1)",
  foreground: "#f7f7f4",
  muted: "#a8a8a2",
  panel: "#171717"
};

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Primeiro nome para a saudacao; sem nome, "aluno". */
export function firstNameOf(fullName: string | null | undefined, fallback = "aluno") {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";

  return first.length > 0 ? first : fallback;
}

/** Links nos e-mails: so http(s) absolutos; qualquer outra coisa vira texto sem link. */
export function isSafeEmailLink(url: string) {
  try {
    const parsed = new URL(url);

    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: { label: string; url?: string | null }[] }
  | { type: "button"; label: string; url: string }
  | { type: "note"; text: string };

export type EmailContent = {
  /** Titulo dentro do e-mail (nao e o assunto). */
  heading: string;
  blocks: EmailBlock[];
  /** Texto curto no rodape (quem envia, como responder). */
  footer: string;
};

function renderBlockHtml(block: EmailBlock) {
  switch (block.type) {
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${COLORS.foreground};">${escapeHtml(block.text)}</p>`;
    case "note":
      return `<p style="margin:0 0 16px;font-size:14px;line-height:22px;color:${COLORS.muted};">${escapeHtml(block.text)}</p>`;
    case "list":
      return `<ul style="margin:0 0 16px;padding:0 0 0 20px;font-size:16px;line-height:26px;color:${COLORS.foreground};">${block.items
        .map((item) => {
          const label = escapeHtml(item.label);

          return item.url && isSafeEmailLink(item.url)
            ? `<li><a href="${escapeHtml(item.url)}" style="color:${COLORS.foreground};text-decoration:underline;">${label}</a></li>`
            : `<li>${label}</li>`;
        })
        .join("")}</ul>`;
    case "button": {
      if (!isSafeEmailLink(block.url)) {
        return "";
      }

      const url = escapeHtml(block.url);

      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr><td style="border-radius:6px;background:${COLORS.accent};">` +
        `<a href="${url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(block.label)}</a>` +
        `</td></tr></table><p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${COLORS.muted};">Se o botão não abrir, copie este endereço: <a href="${url}" style="color:${COLORS.muted};">${url}</a></p>`;
    }
  }
}

function renderBlockText(block: EmailBlock) {
  switch (block.type) {
    case "paragraph":
    case "note":
      return block.text;
    case "list":
      return block.items.map((item) => (item.url && isSafeEmailLink(item.url) ? `- ${item.label}: ${item.url}` : `- ${item.label}`)).join("\n");
    case "button":
      return isSafeEmailLink(block.url) ? `${block.label}: ${block.url}` : "";
  }
}

export function renderEmailHtml(content: EmailContent) {
  const body = content.blocks.map(renderBlockHtml).filter(Boolean).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.background};font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLORS.background};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:12px;">
<tr><td style="padding:28px 28px 8px;">
<p style="margin:0 0 20px;font-size:13px;font-weight:600;letter-spacing:0;color:${COLORS.accent};">Bunker707</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:32px;font-weight:700;color:${COLORS.foreground};">${escapeHtml(content.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:8px 28px 28px;border-top:1px solid ${COLORS.border};">
<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:${COLORS.muted};">${escapeHtml(content.footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderEmailText(content: EmailContent) {
  return [content.heading, "", ...content.blocks.map(renderBlockText).filter(Boolean), "", content.footer].join("\n\n").replace(/\n{3,}/g, "\n\n");
}
