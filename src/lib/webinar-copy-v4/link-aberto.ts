// Frases do link aberto (docs/30 §14, D127 a D134; pedido do produtor de 23/11/2026: "Eu quero ter um link para mandar
// para pessoas que queiram participar sem ser alunos"): a parte "Link aberto" do card Quem pode do editor, o formulario
// de /webinarios/<slug>/entrar e a moldura de quem entrou pelo link. Entram em WEBINAR_COPY.linkAberto e passam pela
// PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo puro, sem imports.

export const LINK_ABERTO_COPY = {
  editor: {
    titulo: "Link aberto",
    chave: "Qualquer pessoa com o link pode entrar",
    chaveLigada: "Quem não é aluno entra pelo link, só nesta live, sem ver o resto da área de membros. Os alunos logados também entram.",
    chaveDesligada: "Só entra quem passa pelo Quem pode acima.",
    pedir: "O que pedir para entrar",
    pedirDica: "Com tudo em Não pedir, a pessoa só clica em Entrar.",
    campos: { email: "E-mail", name: "Nome", phone: "Telefone" },
    modos: { off: "Não pedir", optional: "Opcional", required: "Obrigatório" },
    link: "Link para mandar",
    // Antes da primeira publicacao o endereco acompanha o titulo e pode mudar (teste do produtor de 24/11/2026: o link
    // copiado no rascunho deu 404 depois de publicar com o titulo mudado). So depois de publicar ele fica fixo.
    linkAntesDePublicar: "O link aparece depois de publicar. Até lá, o endereço ainda muda junto com o título.",
    copiar: "Copiar link",
    copiado: "Link copiado",
    simulacao:
      "Com o link aberto, a live sai da área de membros: o selo Ao vivo da Live gravada, o contador, as entradas, os avisos de venda e os participantes simulados não aparecem para ninguém.",
    lista: "Quem entrou pelo link",
    baixarLista: "Baixar a lista (CSV)",
    listaDica: "Nome, e-mail, telefone, a autorização e a hora de cada entrada."
  },
  entrar: {
    tituloPagina: "Entrar na live",
    // A descricao do cartao do link no WhatsApp e nas redes, quando o webinario nao tem descricao (D136).
    compartilhar: "Entre na live pelo link.",
    chamada: "Preencha para entrar na live.",
    chamadaSemCampos: "A live é aberta. Clique em Entrar.",
    nome: "Seu nome",
    nomeDica: "Aparece no chat com a inicial do sobrenome.",
    email: "Seu e-mail",
    telefone: "Seu telefone com DDD",
    opcional: "opcional",
    entrar: "Entrar",
    entrando: "Entrando",
    jaTemConta: "Já é aluno?",
    entrarComConta: "Entre com a sua conta",
    erro: "Não foi possível entrar agora. Tente de novo em instantes.",
    naoAberta: "Esta live não está aberta pelo link.",
    naoAbertaDica: "Confira o link com quem mandou."
  },
  moldura: {
    convidado: "Você está nesta live pelo link.",
    sair: "Sair"
  },
  csv: {
    arquivo: "entradas-pelo-link",
    colunas: ["Entrada", "Nome", "E-mail", "Telefone", "Autorização", "Autorizado em", "Origem"] as const
  }
} as const;
