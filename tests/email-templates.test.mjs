import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Templates em portugues: boas-vindas (como criar a senha, conforme a entrega) e acesso liberado por
// compra (produto e por onde entrar). Texto escapado, links so http(s), versao em texto simples.

const { escapeHtml, firstNameOf, isSafeEmailLink, renderEmailHtml } = await import("../src/server/email/templates/layout.ts");
const { WELCOME_EMAIL_SUBJECT, renderWelcomeEmail } = await import("../src/server/email/templates/welcome.ts");
const { purchaseEmailSubject, renderPurchaseEmail } = await import("../src/server/email/templates/purchase.ts");

const loginUrl = "https://app.exemplo.test/login";

test("boas-vindas: saudacao pelo primeiro nome, e-mail da conta, botao para /login e assunto fixo", () => {
  const email = renderWelcomeEmail({ email: "ana@exemplo.test", fullName: "Ana Maria Souza", loginUrl, passwordHint: "none" });

  assert.equal(email.subject, WELCOME_EMAIL_SUBJECT);
  assert.match(email.html, /Olá, Ana!/);
  assert.match(email.html, /ana@exemplo\.test/);
  assert.match(email.html, new RegExp(`href="${loginUrl}"`));
  assert.match(email.html, /Entrar na área de membros/);
  assert.match(email.html, /Esqueci minha senha/);
  assert.match(email.text, /Olá, Ana!/);
  assert.match(email.text, new RegExp(`Entrar na área de membros: ${loginUrl}`));
  assert.doesNotMatch(email.text, /<[a-z]/i, "a versao em texto nao tem HTML");
});

test("boas-vindas muda a instrucao da senha conforme a entrega: convite, senha temporaria ou nada", () => {
  const invite = renderWelcomeEmail({ email: "a@b.test", fullName: null, loginUrl, passwordHint: "invite" }).text;
  assert.match(invite, /abra o e-mail “Crie sua senha da Bunker707”/, "convite: cita o assunto do e-mail do Supabase");
  assert.doesNotMatch(invite, /Em instantes|ainda vai chegar/, "convite chega antes das boas-vindas: o texto nao promete um e-mail futuro");
  assert.match(invite, /Esqueci minha senha/, "convite: saida se o e-mail do convite nao aparecer");
  assert.match(renderWelcomeEmail({ email: "a@b.test", fullName: null, loginUrl, passwordHint: "temporary_password" }).text, /senha temporária/);
  assert.match(renderWelcomeEmail({ email: "a@b.test", fullName: null, loginUrl, passwordHint: "none" }).text, /Esqueci minha senha/);
  assert.match(renderWelcomeEmail({ email: "a@b.test", fullName: "  ", loginUrl, passwordHint: "none" }).html, /Olá, aluno!/);
});

test("acesso liberado: um produto vai no assunto e no botao; varios viram lista com link de cada um", () => {
  const single = renderPurchaseEmail({
    email: "ana@exemplo.test",
    fullName: "Ana",
    loginUrl,
    products: [{ title: "Curso de Agentes", url: "https://app.exemplo.test/conteudo/agentes" }]
  });

  assert.equal(single.subject, "Seu acesso a Curso de Agentes foi liberado");
  assert.match(single.html, /Seu acesso a Curso de Agentes já está liberado/);
  assert.match(single.html, /href="https:\/\/app\.exemplo\.test\/conteudo\/agentes"[^>]*>Começar agora/);
  assert.match(single.text, /Começar agora: https:\/\/app\.exemplo\.test\/conteudo\/agentes/);
  assert.match(single.text, /Esqueci minha senha/);

  const combo = renderPurchaseEmail({
    email: "ana@exemplo.test",
    fullName: "Ana",
    loginUrl,
    products: [
      { title: "Curso A", url: "https://app.exemplo.test/conteudo/a" },
      { title: "Curso B", url: null }
    ]
  });

  assert.equal(combo.subject, purchaseEmailSubject(combo.products ?? [{}, {}]));
  assert.equal(combo.subject, "Seus novos acessos na Bunker707 foram liberados");
  assert.match(combo.html, /<li><a href="https:\/\/app\.exemplo\.test\/conteudo\/a"[^>]*>Curso A<\/a><\/li>/);
  assert.match(combo.html, /<li>Curso B<\/li>/);
  assert.match(combo.text, /- Curso A: https:\/\/app\.exemplo\.test\/conteudo\/a/);
  assert.match(combo.text, /- Curso B\n/);
  assert.throws(() => renderPurchaseEmail({ email: "a@b.test", fullName: null, loginUrl, products: [] }), /sem produto/);
});

test("nome e titulo do produto sao escapados no HTML; links que nao sao http(s) nao viram link", () => {
  const email = renderPurchaseEmail({
    email: "ana@exemplo.test",
    fullName: "<script>alert(1)</script>",
    loginUrl: "javascript:alert(1)",
    products: [{ title: "Curso <b>\"x\"</b> & cia", url: "javascript:alert(2)" }]
  });

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /Curso &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; cia/);
  assert.doesNotMatch(email.html, /javascript:/);
  assert.doesNotMatch(email.text, /javascript:/);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(isSafeEmailLink("https://x.test/a?b=1"), true);
  assert.equal(isSafeEmailLink("http://127.0.0.1:3100/login"), true);
  assert.equal(isSafeEmailLink("https://user:pass@x.test/"), false);
  assert.equal(isSafeEmailLink("javascript:alert(1)"), false);
  assert.equal(isSafeEmailLink("/login"), false);
  assert.equal(firstNameOf(" Maria   Clara "), "Maria");
});

test("a moldura e um HTML completo em pt-BR com fundo escuro e o titulo escapado", () => {
  const html = renderEmailHtml({ blocks: [{ text: "Oi", type: "paragraph" }], footer: "Rodapé & cia", heading: "Título <x>" });

  assert.match(html, /^<!doctype html>\n<html lang="pt-BR">/);
  assert.match(html, /<title>Título &lt;x&gt;<\/title>/);
  assert.match(html, /background:#141414/);
  assert.match(html, /Rodapé &amp; cia/);
});

/* ------------------------------------------------------------------------------------------------
 * Webinarios (docs/30 §2.7): os lembretes de 24 h ("Amanhã às"), do 24 h atrasado ("Hoje às") e de 1 h, e a
 * live cancelada. Enfileirados por src/server/webinars/reminders.ts e notify.ts (tests/webinarios-lembretes).
 * ---------------------------------------------------------------------------------------------- */

const { renderWebinarReminderEmail, webinarReminderSubject } = await import("../src/server/email/templates/webinar-reminder.ts");
const { renderWebinarCancelledEmail } = await import("../src/server/email/templates/webinar-cancelled.ts");

const live = { dateLabel: "05/11/2026", fullName: "Ana Maria Souza", link: "https://app.exemplo.test/webinarios/live-de-agentes", timeLabel: "20:00", title: "Live de agentes" };

test("lembretes da live: assunto por variante, saudacao pelo primeiro nome, botao para a pagina da live e versao em texto sem HTML", () => {
  const amanha = renderWebinarReminderEmail({ ...live, variant: "tomorrow" });

  assert.equal(amanha.subject, "Amanhã às 20:00: Live de agentes");
  assert.match(amanha.html, /<title>Lembrete da live<\/title>/);
  assert.match(amanha.html, /Olá, Ana\. Sua vaga está garantida para Live de agentes, amanhã, 05\/11\/2026 às 20:00 \(horário de Brasília\)/);
  assert.match(amanha.html, /href="https:\/\/app\.exemplo\.test\/webinarios\/live-de-agentes"[^>]*>Entrar na área de membros/);
  assert.match(amanha.html, /cancele sua vaga na página dela/);
  assert.match(amanha.text, /Entrar na área de membros: https:\/\/app\.exemplo\.test\/webinarios\/live-de-agentes/);
  assert.match(amanha.text, /garantiu vaga nesta live/);
  assert.doesNotMatch(amanha.text, /<[a-z]/i, "a versao em texto nao tem HTML");

  const hoje = renderWebinarReminderEmail({ ...live, variant: "today" });
  assert.equal(hoje.subject, "Hoje às 20:00: Live de agentes");
  assert.match(hoje.text, /Olá, Ana\. Sua vaga está garantida para Live de agentes, hoje às 20:00/);

  const umaHora = renderWebinarReminderEmail({ ...live, fullName: null, variant: "one_hour" });
  assert.equal(umaHora.subject, "Começa em 1 hora: Live de agentes");
  assert.match(umaHora.html, /Olá, aluno\. Live de agentes começa às 20:00 \(horário de Brasília\)/);
  assert.equal(webinarReminderSubject({ timeLabel: "20:00", title: "X", variant: "one_hour" }), "Começa em 1 hora: X");
});

test("lembrete com o texto da equipe: a saudacao e o texto escolhido no lugar do padrao, com o mesmo botao e tudo escapado", () => {
  const email = renderWebinarReminderEmail({ ...live, customText: "  Amanhã a gente se vê. Traga <perguntas>.  ", title: "Live <b>x</b>", variant: "tomorrow" });

  assert.match(email.html, /Olá, Ana\.<\/p>/);
  assert.match(email.html, /Amanhã a gente se vê\. Traga &lt;perguntas&gt;\./);
  assert.doesNotMatch(email.html, /Sua vaga está garantida para/);
  assert.doesNotMatch(email.html, /<b>x<\/b>/);
  assert.match(email.html, /href="https:\/\/app\.exemplo\.test\/webinarios\/live-de-agentes"/);
  assert.equal(email.subject, "Amanhã às 20:00: Live <b>x</b>", "o assunto nao e HTML: vai como esta");
  assert.doesNotMatch(renderWebinarReminderEmail({ ...live, customText: "   ", variant: "tomorrow" }).html, /Olá, Ana\.<\/p>/, "texto vazio volta ao padrao");
});

test("live cancelada: assunto, saudacao, o motivo escrito pela equipe quando existe e nenhum botao", () => {
  const com = renderWebinarCancelledEmail({ fullName: "Ana Souza", reason: "O apresentador adoeceu.", title: "Live de agentes" });

  assert.equal(com.subject, "Live cancelada: Live de agentes");
  assert.match(com.html, /<title>Live cancelada<\/title>/);
  assert.match(com.html, /Olá, Ana\. A live Live de agentes foi cancelada\./);
  assert.match(com.html, /Motivo: O apresentador adoeceu\./);
  assert.doesNotMatch(com.html, /href=/);
  assert.doesNotMatch(com.text, /<[a-z]/i);

  const sem = renderWebinarCancelledEmail({ fullName: null, reason: "  ", title: "Live" });
  assert.match(sem.text, /Olá, aluno\. A live Live foi cancelada\./);
  assert.doesNotMatch(sem.text, /Motivo:/);
});
