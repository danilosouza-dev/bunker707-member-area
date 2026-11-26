# Live Bunker707 (Mac)

O console das lives numa janela própria, para quem apresenta no Mac (docs/30 D145). É o mesmo site, com a mesma conta e os mesmos dados. A diferença é o microfone: o aplicativo o captura pela própria Apple, sem o ganho automático, e assim o **Isolamento de Voz** do Mac vale na live e na gravação. No Chrome isso não acontece (docs/30 D144).

## Montar

No Mac com Apple Silicon, com o Node 24 e as Command Line Tools do Xcode:

```bash
npm run build
```

Sai `out/Live Bunker707.app` e `out/Live-Bunker707-mac.zip`.

## Instalar e usar

1. Abra o zip e arraste o **Live Bunker707** para Aplicativos.
2. Na primeira vez, clique com o botão direito no aplicativo e escolha **Abrir**. O Mac avisa porque o aplicativo não tem a assinatura paga da Apple.
3. Permita o microfone e a câmera. Para compartilhar a tela, ligue o **Live Bunker707** em Ajustes > Privacidade e Segurança > **Gravação do Áudio do Sistema e da Tela**, e feche e abra o aplicativo. Cada versão montada conta como um aplicativo novo para o Mac: a permissão vale para a versão instalada.
4. Entre com a sua conta e vá ao console da live.
5. Na barra do Mac, no ícone do microfone, escolha **Isolamento de Voz**. No menu **Ver > Testar o microfone** dá para conferir: em silêncio, abaixo de −70 dB.

Ao compartilhar a tela, o seletor do aplicativo mostra as telas e as janelas e a opção **Compartilhar o som do computador** (o som do Mac, sem o da própria sala).

O microfone é o escolhido nas Configurações da sala (o seletor de microfone). Sem escolha, vale o padrão do Mac (Ajustes > Som > Entrada); cuidado: ligar a câmera pela Cam Link pode tornar o microfone da câmera o padrão.
