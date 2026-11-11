// Roda DENTRO do container do app, pelos comandos do kit (infra/kit/instalar e membros licenca e link-do-dono; docs/20
// §9D), sempre por `docker compose exec -T app node --input-type=module -e "<este arquivo>" <acao>` (no_app, em
// lib-kit.sh). A entrada e um JSON e a saida e um JSON.
//
// Por que aqui dentro: os segredos que estes pedidos usam (o token do tick e a chave secreta do Supabase) ja estao no
// ambiente do container e nunca saem dele, nem para a linha de comando do servidor (que qualquer usuario ve no `ps`)
// nem para a saida. A Chave de ativacao e o e-mail chegam pela entrada. A ativacao e a do proprio produto: o app recebe
// o pedido em /api/licenca/instalador e chama as mesmas operacoes da tela Licenca (src/server/licensing/operations.ts,
// a conferencia inicial e depois a ativacao). A conta do dono e o link de entrada vao pela API administrativa do Auth,
// pelo gateway da rede interna. So o Node do container (fetch), nada do produto.
//
// Acoes: licenca-estado, licenca-ativar ({"chave"}), dono-criar ({"email"}) e dono-link ({"email"}).
// Saida: {"ok": true, ...} ou {"ok": false, "codigo": "...", "mensagem": "..."}; codigo de saida 0 quando o pedido chegou
// ao app ou ao Auth (mesmo com a resposta "nao"), 1 quando nem chegou.

const acao = process.argv[1] ?? "";
const APP = (process.env.KIT_APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const GATEWAY = (process.env.SUPABASE_INTERNAL_URL || "http://api-gw:8000").replace(/\/+$/, "");
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function responder(objeto, codigo = 0) {
  process.stdout.write(`${JSON.stringify(objeto)}\n`);
  process.exit(codigo);
}

async function lerEntrada() {
  let texto = "";
  for await (const pedaco of process.stdin) texto += pedaco;
  return texto.trim() ? JSON.parse(texto) : {};
}

async function pedir(url, { cabecalhos = {}, corpo } = {}) {
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...cabecalhos },
      body: JSON.stringify(corpo ?? {}),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000)
    });
    const texto = await resposta.text();
    let dados = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = null;
    }
    return { status: resposta.status, dados };
  } catch (erro) {
    return { status: 0, dados: null, erro: erro?.name === "TimeoutError" ? "tempo esgotado" : "sem conexao" };
  }
}

let entrada;
try {
  entrada = await lerEntrada();
} catch {
  responder({ ok: false, codigo: "entrada_invalida", mensagem: "A entrada nao e um JSON." }, 1);
}

function adminAuth() {
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!chave) responder({ ok: false, codigo: "sem_chave_do_servidor", mensagem: "O app esta sem SUPABASE_SECRET_KEY." }, 1);
  return { apikey: chave, authorization: `Bearer ${chave}` };
}

function emailDaEntrada() {
  const email = String(entrada?.email ?? "").trim();
  if (!EMAIL.test(email)) responder({ ok: false, codigo: "email_invalido", mensagem: "O e-mail do dono nao e valido." }, 1);
  return email;
}

switch (acao) {
  case "licenca-estado":
  case "licenca-ativar": {
    const token = process.env.JOBS_TICK_TOKEN;
    if (!token) responder({ ok: false, codigo: "sem_token", mensagem: "O app esta sem JOBS_TICK_TOKEN." }, 1);
    const corpo = acao === "licenca-estado" ? { acao: "estado" } : { acao: "ativar", chave: String(entrada?.chave ?? "") };
    const resposta = await pedir(`${APP}/api/licenca/instalador`, { cabecalhos: { authorization: `Bearer ${token}` }, corpo });
    if (resposta.status === 0) responder({ ok: false, codigo: "app_fora", mensagem: `O app nao respondeu dentro do container (${resposta.erro}).` }, 1);
    if (resposta.status === 404 && !resposta.dados?.codigo) {
      responder({ ok: false, codigo: "sem_rota", mensagem: "Esta versao do app nao ativa pelo comando: ative pela tela Configuracoes > Licenca." }, 1);
    }
    if (!resposta.dados || typeof resposta.dados !== "object") responder({ ok: false, codigo: "resposta_invalida", mensagem: `O app respondeu ${resposta.status} sem JSON.` }, 1);
    responder(resposta.dados, 0);
    break;
  }
  case "dono-criar": {
    const email = emailDaEntrada();
    const resposta = await pedir(`${GATEWAY}/auth/v1/admin/users`, { cabecalhos: adminAuth(), corpo: { email, email_confirm: true } });
    if (resposta.status === 0) responder({ ok: false, codigo: "auth_fora", mensagem: `O Auth nao respondeu (${resposta.erro}).` }, 1);
    if ((resposta.status === 200 || resposta.status === 201) && typeof resposta.dados?.id === "string") {
      responder({ ok: true, id: resposta.dados.id, criada: true });
    }
    const erro = String(resposta.dados?.error_code ?? resposta.dados?.msg ?? resposta.dados?.message ?? "");
    if (resposta.status === 422 && /email_exists|already/i.test(erro)) responder({ ok: false, codigo: "existe" });
    responder({ ok: false, codigo: "auth_recusou", mensagem: `O Auth respondeu ${resposta.status} ao criar a conta (${erro.slice(0, 120) || "sem detalhe"}).` });
    break;
  }
  case "dono-link": {
    const email = emailDaEntrada();
    const resposta = await pedir(`${GATEWAY}/auth/v1/admin/generate_link`, { cabecalhos: adminAuth(), corpo: { type: "recovery", email } });
    if (resposta.status === 0) responder({ ok: false, codigo: "auth_fora", mensagem: `O Auth nao respondeu (${resposta.erro}).` }, 1);
    const tokenHash = resposta.dados?.hashed_token ?? resposta.dados?.properties?.hashed_token;
    if (resposta.status !== 200 || typeof tokenHash !== "string" || !/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) {
      responder({ ok: false, codigo: "auth_recusou", mensagem: `O Auth respondeu ${resposta.status} ao gerar o link.` });
    }
    responder({ ok: true, token_hash: tokenHash });
    break;
  }
  default:
    responder({ ok: false, codigo: "acao_desconhecida", mensagem: `Acao desconhecida: ${acao}` }, 1);
}
