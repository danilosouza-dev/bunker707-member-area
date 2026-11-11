// Frases da "Na tela" (docs/30 §2.4, §3.4 e §9; docs/31 §12; especificacao de 10/11/2026): a mensagem e a enquete
// fixadas, o banner e o QR Code que a equipe poe na frente da turma, a entrada "Na tela" do console com os dois
// formularios, o que o aluno ve e ouve (o cartao no palco, a faixa abaixo do palco, a doca da sala vertical), os avisos,
// os erros das acoes e o bloco "Na tela" do relatorio. Entram em WEBINAR_COPY.naTela e passam pela PROIBIDAS_WEBINARIO
// (tests/webinarios-frases.test.mjs). Modulo puro, sem imports. Dono: a entrega "Na tela"; todas as frases da
// especificacao estao aqui desde a primeira fatia, entao as fatias seguintes so leem este arquivo.
//
// O adendo do mesmo dia (R8 e R9) acrescenta `comentarios`: o roteiro de comentarios prontos na Live ao vivo (os
// gatilhos da live e o porque de "Quando o apresentador diz" faltar nela), o "Novo comentário" do console com "Quem
// comenta" (Nome, Foto (opcional), Aparece como, Comentário), a foto de quem comenta com a linha do consentimento, os
// avisos e os erros. Nunca a palavra "personagem" na tela (o teste confere): o nome interno `persona` fica no codigo.
// Em 11/11/2026 saem a caixa "Usar esta foto em todos os comentários de {nome}" e o aviso dela (a lista "Pessoas que
// comentam" faz a pessoa ser a unidade; as frases novas estao em src/lib/webinar-copy-v4/pessoas.ts).
//
// Ja existiam e continuam onde estao: "Fixar" e "Desafixar" de cada linha do chat (WEBINAR_ADMIN_COPY.console), os itens
// de silenciar, remover e banir e o bloco "Removidos, silenciados e banidos" (WEBINAR_COPY.consoleAoVivo), e as frases
// do aluno silenciado e removido (WEBINAR_COPY.aoVivo).

/** "agora", "há 2 min", "há 1 h", "há 1 h 5 min": quanto tempo a coisa esta na tela (Na tela agora, Fixada agora). */
const haTempo = (minutos: number) => {
  const total = Math.max(0, Math.floor(minutos));
  if (total < 1) {
    return "agora";
  }
  if (total < 60) {
    return `há ${total} min`;
  }
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto === 0 ? `há ${horas} h` : `há ${horas} h ${resto} min`;
};

/** "312 viram · 41 clicaram · 9 fecharam" (alunos distintos; a equipe fica de fora). */
const numeros = (viram: number, clicaram: number, fecharam: number) =>
  [viram === 1 ? "1 viu" : `${viram} viram`, clicaram === 1 ? "1 clicou" : `${clicaram} clicaram`, fecharam === 1 ? "1 fechou" : `${fecharam} fecharam`].join(" · ");

export const NA_TELA_COPY = {
  /** O nome da entrada do console, do bloco do relatorio e da pilula do palco do console. */
  nome: "Na tela",
  /** O selo de cada item pronto e o comeco da linha de Na tela agora. */
  tipos: { banner: "Banner", qr: "QR Code" },
  /** As nove posicoes da grade 3x3 do palco (Onde aparece). */
  lugares: {
    top_left: "Em cima, à esquerda",
    top_center: "Em cima, no meio",
    top_right: "Em cima, à direita",
    middle_left: "No meio, à esquerda",
    center: "No meio",
    middle_right: "No meio, à direita",
    bottom_left: "Embaixo, à esquerda",
    bottom_center: "Embaixo, no meio",
    bottom_right: "Embaixo, à direita"
  },
  tamanhos: { s: "Pequeno", m: "Médio", l: "Grande" },
  /** O fim do resumo de um item pronto. */
  fechar: { sim: "o aluno pode fechar", nao: "o aluno não pode fechar" },
  /** "Embaixo, à direita · Médio · o aluno pode fechar" (screen-model.screenItemSummary). */
  resumo: (lugar: string, tamanho: string, fechar: string) => `${lugar} · ${tamanho} · ${fechar}`,
  /** O nome de uma exibicao no console (Na tela agora) e no relatorio (coluna Item). */
  exibicao: {
    banner: (nome: string) => `Banner · ${nome}`,
    qr: (nome: string) => `QR Code · ${nome}`,
    poll: (pergunta: string) => `Enquete fixada · ${pergunta}`
  },
  haTempo,
  numeros,

  /* O console: a entrada "Na tela" (trilho e ⋯), a aba Chat e a entrada Enquetes. */
  console: {
    entrada: "Na tela",
    /**
     * O nome do contador da entrada para o leitor de tela (o aria-label do item do trilho): quantas coisas estao na frente
     * da turma. O numero aparece tambem no circulo vermelho do trilho (RoomCountBadge), como o das Perguntas.
     */
    contador: (n: number) => (n === 0 ? "Nada na tela" : n === 1 ? "1 coisa na tela" : `${n} coisas na tela`),
    agora: "Na tela agora",
    agoraVazio: "Nada na tela dos alunos.",
    mensagemFixada: (autor: string, texto: string) => `Mensagem fixada · ${autor}: ${texto}`,
    enqueteFixada: (pergunta: string) => `Enquete fixada · ${pergunta}`,
    desafixar: "Desafixar",
    tirarDaTela: "Tirar da tela",
    prontos: "Prontos",
    prontosVazio: "Nenhum banner ou QR Code pronto.",
    previa: "Prévia",
    mostrar: "Mostrar",
    mostrarNoLugar: "Mostrar no lugar do atual",
    /** O selo do item pronto que e o que esta na tela agora. */
    seloNaTela: "Na tela",
    /** O item foi editado depois de mostrado: a turma ainda ve a copia de antes. */
    mostrarDeNovo: "Mostrar de novo",
    maisAcoes: (nome: string) => `Mais ações para ${nome}`,
    editar: "Editar",
    excluir: "Excluir",
    excluirConfirmar: (nome: string) => `Excluir "${nome}"?`,
    excluirTexto: "Ele sai da lista de prontos de todas as sessões. Os números de quando apareceu continuam no relatório.",
    novoBanner: "Novo banner",
    novoQr: "Novo QR Code",
    editarBanner: "Editar banner",
    editarQr: "Editar QR Code",
    voltar: "Voltar",
    /** A pilula neutra no palco do console da Live ao vivo: "Na tela: Banner · QR Code" (os cartoes nao sao desenhados la). */
    pilulaPalco: (tipos: readonly string[]) => `Na tela: ${tipos.join(" · ")}`,
    /** Os avisos do console. */
    avisos: {
      naTela: "Na tela dos alunos em até 5 s.",
      saiu: "Saiu da tela.",
      salvo: "Salvo nos prontos.",
      excluido: "Excluído dos prontos.",
      mensagemFixada: "Mensagem fixada.",
      enqueteFixada: "Enquete fixada.",
      enqueteDesafixada: "Enquete desafixada."
    }
  },

  /* A aba Chat do console (R1). */
  chat: {
    /** A pilula do campo "Escreva para a turma" (aria-pressed; desliga sozinha depois de cada envio). */
    fixarAoEnviar: "Fixar ao enviar",
    /** O bloco acima da lista, fora da rolagem. */
    fixadaAgora: "Fixada agora",
    desafixar: "Desafixar"
  },

  /* A entrada Enquetes do console (R2). */
  enquetes: {
    fixar: "Fixar",
    desafixar: "Desafixar",
    /** O selo da enquete fixada, em "Nesta sessão". */
    fixada: "Fixada",
    /** Em "Prontas", ao lado de Abrir. */
    abrirEFixar: "Abrir e fixar"
  },

  /* Os formularios do banner e do QR Code (R3 e R4). */
  formulario: {
    nome: "Nome (só a equipe vê)",
    imagem: "Imagem",
    enviarImagem: "Enviar imagem",
    trocarImagem: "Trocar",
    removerImagem: "Remover",
    enviandoImagem: "Enviando a imagem…",
    imagemDica: "JPG, PNG ou WebP. Fica com até 1.280 px.",
    descricao: "Descrição da imagem (para quem usa leitor de tela)",
    titulo: "Título",
    texto: "Texto",
    textoDoBotao: "Texto do botão",
    textoDoBotaoDica: "Sem texto do botão, o banner inteiro abre o link.",
    link: "Link",
    linkExemplo: "https://…",
    linkPronto: "Usar um link pronto",
    /** O primeiro link pronto: a pagina do webinario na area de membros. */
    linkPaginaDoWebinario: "Página deste webinário",
    legenda: "Legenda (opcional)",
    ondeAparece: "Onde aparece",
    tamanho: "Tamanho",
    podeFechar: "O aluno pode fechar",
    semFecharDica: "Sem fechar, o banner só sai quando você tirar.",
    /** Os avisos fixos do formulario do banner. */
    avisoCelular: "No celular em pé, aparece como uma faixa abaixo do vídeo.",
    avisoPrazo: "Nunca anuncie um prazo que não é verdade.",
    avisoOferta: "Para vender com o link de pagamento, use a Oferta: só ela liga a compra ao aluno.",
    /** Com "No meio" e sem fechar. */
    avisoMeio: "No meio e sem fechar, o banner cobre parte do vídeo até você tirar. Só nos tamanhos Pequeno e Médio.",
    /** As dicas do formulario do QR Code. */
    qrLinkDica: "Para o QR Code, use um link de até 240 caracteres.",
    qrGerado: "O QR Code é gerado aqui, a partir do link.",
    qrDenso: "Link comprido deixa o QR Code difícil de ler. Use um link mais curto ou o tamanho Grande.",
    previa: "Prévia",
    previaComputador: "Computador",
    previaCelular: "Celular",
    mostrarAgora: "Mostrar agora",
    salvarParaDepois: "Salvar para depois",
    cancelar: "Cancelar"
  },

  /* Os erros das acoes e do formulario (zod no salvar; o servidor recusa com 409 o que nao cabe na sessao). */
  erros: {
    invalido: "Pedido inválido.",
    link: "Use um link que comece com https://.",
    qrLink: "Para o QR Code, use um link de até 240 caracteres.",
    imagemOuTitulo: "Coloque uma imagem ou um título.",
    botaoSemLink: "O botão precisa de um link.",
    descricao: "Descreva a imagem para quem usa leitor de tela.",
    meioGrande: "No meio e sem fechar, só nos tamanhos Pequeno e Médio.",
    curto: (max: number) => `Use até ${max} caracteres.`,
    limite: (max: number) => `Até ${max} banners e QR Codes prontos por webinário. Exclua um para criar outro.`,
    tireDaTela: "Tire da tela para excluir.",
    itemSumiu: "Esse banner ou QR Code não existe mais.",
    exibicaoSumiu: "Isso já saiu da tela.",
    sessaoFechada: "Essa sessão já acabou. Nada mais aparece na tela.",
    replay: "No Replay nada aparece na tela.",
    enqueteNaoFixa: "Só uma enquete aberta, ou encerrada com o resultado compartilhado, pode ficar fixada.",
    imagemFormato: "Envie uma imagem JPG, PNG ou WebP.",
    imagemPesada: "A imagem passou de 200 KB. Envie uma menor.",
    imagemLado: "A imagem precisa ter de 16 a 1.280 px de lado.",
    imagemAnimada: "Imagem animada não é aceita. Use uma imagem parada.",
    imagemSumiu: "A imagem não foi encontrada. Envie de novo."
  },

  /* O que o aluno ve e ouve (R1 a R4; §3). */
  aluno: {
    fixadaPelaEquipe: "Fixada pela equipe",
    enqueteFixadaPelaEquipe: "Enquete fixada pela equipe",
    mostrarTudo: "Mostrar tudo",
    mostrarMenos: "Mostrar menos",
    /** A enquete fixada respondida, recolhida numa linha. */
    respostaEnviada: "Resposta enviada",
    mostrar: "Mostrar",
    recolher: "Recolher",
    /** As pilulas do palco largo com o painel fechado (sao botoes). */
    pilulaFixada: (texto: string) => `Fixada · ${texto}`,
    pilulaEnquete: (pergunta: string) => `Enquete fixada · ${pergunta}`,
    /** O botao de enquete do chat da sala vertical, quando a enquete esta fixada. */
    enqueteFixadaVertical: (pergunta: string) => `Enquete fixada: ${pergunta}`,
    /** O aviso da sala na chegada de uma fixada nova com o painel fechado, com a acao Ver. */
    avisoFixou: "A equipe fixou uma mensagem.",
    ver: "Ver",
    /** O link de texto do QR Code (e a acao principal dele no celular). */
    abrirOLink: "Abrir o link",
    fecharBanner: "Fechar o banner",
    fecharQr: "Fechar o QR Code",
    /** O nome da secao (nao modal) do cartao e da linha da faixa. */
    secaoBanner: (titulo: string) => `Banner da equipe: ${titulo}`,
    secaoQr: (legenda: string | null) => (legenda ? `QR Code da equipe: ${legenda}` : "QR Code da equipe"),
    /** Um anuncio educado por chegada; a saida e silenciosa. */
    anuncioBanner: (titulo: string) => `A equipe colocou um banner na tela: ${titulo}.`,
    anuncioQr: (legenda: string | null) =>
      legenda ? `A equipe mostrou um QR Code: ${legenda}. O link está no botão Abrir o link.` : "A equipe mostrou um QR Code. O link está no botão Abrir o link.",
    /** O leitor de tela ouve tambem, quando o banner nao pode ser fechado. */
    semFechar: "Este banner sai quando a equipe tirar.",
    /** O nome do desenho do QR Code (role="img"). */
    qrNome: (dominio: string) => `QR Code do link ${dominio}`
  },

  /* O roteiro de comentarios prontos na Live ao vivo e a foto de quem comenta (adendo de 10/11/2026, R8 e R9). */
  comentarios: {
    /** Os gatilhos do roteiro na Live ao vivo (o zero e o Começar para todos). */
    gatilhosLive: { at_offset: "Num minuto da live", manual: "Pelo botão da equipe" },
    /** O campo do tempo na live e a dica. */
    minutoDaLive: "Minuto da live",
    minutoDaLiveDica: "Contado do Começar para todos: minuto ou minuto:segundo, como 12 ou 12:30.",
    /** A dica do CSV do roteiro na live: o Tempo e o minuto da live, como no campo. */
    csvDicaLive: "Quatro colunas: Tempo;Nome;Papel;Mensagem. Tempo é o minuto da live, como 12 ou 12:30; Papel Aluno ou Equipe.",
    /** "Quando o apresentador diz" fica de fora na live: o editor diz por quê. */
    semFraseNaLive: "Na live ao vivo não há transcrição durante a transmissão, então “Quando o apresentador diz” não existe aqui. O comentário entra num minuto da live ou pelo botão da equipe.",
    /** Quando o item entra, na fila do console da live. */
    aosMinutos: (minutos: number, segundos = 0) =>
      segundos > 0 ? `Aos ${minutos}:${String(segundos).padStart(2, "0")} da live` : minutos === 0 ? "No começo da live" : minutos === 1 ? "Com 1 minuto de live" : `Aos ${minutos} minutos da live`,
    /** O formulario rapido do console (R8) e os campos de quem comenta (R9). */
    novoComentario: "Novo comentário",
    quemComenta: "Quem comenta",
    nome: "Nome",
    foto: "Foto (opcional)",
    fotoDeQuemComenta: "Foto de quem comenta",
    fotoDe: (nome: string) => `Foto de ${nome}`,
    enviarFoto: "Enviar foto",
    trocarFoto: "Trocar",
    removerFoto: "Remover",
    enviandoFoto: "Enviando a foto…",
    fotoDica: "JPG, PNG ou WebP. Fica com até 512 px.",
    fotoConsentimento: "Use imagem gerada ou com autorização. Nunca a foto de uma pessoa real sem o consentimento dela.",
    apareceComo: "Aparece como",
    papeis: { student: "Aluno", team: "Equipe" },
    comentario: "Comentário",
    enviarAgora: "Enviar agora",
    guardarNaLista: "Guardar na lista",
    cancelar: "Cancelar",
    voltar: "Voltar",
    avisos: {
      enviado: "Comentário no chat em até 5 s.",
      guardado: "Guardado no roteiro, pelo botão da equipe."
    },
    erros: {
      nome: "Dê um nome a quem comenta (até 60 caracteres).",
      comentario: "Escreva o comentário (até 1.000 caracteres).",
      fotoFormato: "Envie uma imagem JPG, PNG ou WebP.",
      fotoPesada: "A foto passou de 100 KB. Envie uma menor.",
      fotoLado: "A foto precisa ter de 16 a 512 px de lado.",
      fotoAnimada: "Imagem animada não é aceita. Use uma imagem parada.",
      fotoSumiu: "A foto não foi encontrada. Envie de novo.",
      fraseNaLive: "Na live ao vivo, o comentário entra num minuto da live ou pelo botão da equipe.",
      replay: "No Replay nenhum comentário entra no chat.",
      sessaoFechada: "Essa sessão já acabou. Nenhum comentário entra no chat.",
      limite: "O roteiro aceita até 5.000 comentários.",
      migracao: (migracao: string) => `A foto de quem comenta precisa da atualização do banco (migração ${migracao}).`,
      /** O roteiro da Live ao vivo no banco sem a 202611100002 (o abrir a sessao de antes soltaria tudo de uma vez). */
      migracaoLive: (migracao: string) => `O roteiro da live ao vivo precisa da atualização do banco (migração ${migracao}).`
    }
  },

  /* O bloco "Na tela" do relatorio da sessao (§7). */
  relatorio: {
    titulo: "Na tela",
    colunas: {
      item: "Item",
      entrouAos: "Entrou aos",
      ficou: "Ficou",
      viram: "Viram",
      clicaram: "Clicaram",
      cliques: "Cliques",
      fecharam: "Fecharam",
      taxa: "Clicaram ÷ viram"
    },
    /** "Entrou aos" de uma exibicao feita na espera. */
    antesDoInicio: "antes do início",
    nota: "Viram: alunos com o item visível na tela por 1 segundo ou mais. Leituras do QR Code pela câmera não são contadas; só o toque em Abrir o link."
  }
} as const;
