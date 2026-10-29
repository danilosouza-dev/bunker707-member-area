// Frases da traducao do chat e do roteiro (docs/30 §1.6): a escolha do idioma em Perfil › Privacidade e na sala, e o
// aviso de mensagem traduzida. A interface da sala segue em portugues; legendas do video ficam de fora. Entram em
// WEBINAR_COPY.traducao. Modulo puro, sem imports. Dono: a frente 4f da traducao.

export const TRADUCAO_COPY = {
  titulo: "Idioma do chat das lives",
  descricao: "As mensagens do chat aparecem traduzidas para o idioma escolhido. A original fica guardada como foi escrita.",
  idiomas: { en: "English", es: "Español", pt: "Português" },
  comoFoiEscrito: "Como foi escrito",
  salvar: "Salvar idioma",
  salvo: "Idioma do chat salvo.",
  erro: "Não foi possível salvar o idioma. Tente de novo.",
  traduzida: "Traduzida",
  verOriginal: "Ver original",
  verTraducao: "Ver tradução",
  traduzindo: "Traduzindo…",
  desligada: "A tradução do chat não está ligada nesta área.",
  legendasDeFora: "As legendas do vídeo não são traduzidas.",
  carregando: "Carregando o idioma escolhido…",
  erroLer: "Não foi possível ler as traduções.",
  muitosPedidos: "Muitos pedidos de tradução. Tente de novo em instantes.",
  chatTraduzido: (idioma: string) => `Chat traduzido para ${idioma}`,
  chatOriginal: "Chat como foi escrito",
  /** O seletor compacto da sala (a mesma escolha do Perfil, sem sair da sala). */
  idiomaDaSala: "Idioma do chat",
  /** O console da equipe: apagar a traducao guardada de uma mensagem (a proxima leitura traduz de novo). */
  console: {
    refazer: "Refazer tradução",
    refeita: (quantas: number) => (quantas === 1 ? "1 tradução apagada: ela é feita de novo na próxima leitura." : `${quantas} traduções apagadas: elas são feitas de novo na próxima leitura.`),
    semTraducao: "Esta mensagem não tinha tradução guardada.",
    mensagemNaoExiste: "Essa mensagem não existe mais.",
    precisaMigracao: (migracao: string) => `A tradução precisa da atualização do banco (migração ${migracao}).`
  }
} as const;
