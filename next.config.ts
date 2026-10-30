import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { imageRemotePatterns } from "./src/lib/image-hosts";
import { DEFAULT_MEET_DOMAIN, meetDomainOf, meetOrigin, meetPermissionsAllowList } from "./src/lib/jitsi-room-config";

const localDevOrigins = Object.values(networkInterfaces()).flatMap((networkAddresses = []) => {
  return networkAddresses
    .filter((networkAddress) => networkAddress.family === "IPv4" && !networkAddress.internal)
    .map((networkAddress) => networkAddress.address);
});

function containsPath(root: string, candidate: string) {
  const relativePath = relative(root, candidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function getTurbopackRoot() {
  const projectRoot = process.cwd();

  try {
    const dependencyRoot = realpathSync(resolve(projectRoot, "node_modules"));
    let sharedRoot = projectRoot;

    while (!containsPath(sharedRoot, dependencyRoot)) {
      const parent = dirname(sharedRoot);

      if (parent === sharedRoot) {
        return parent;
      }

      sharedRoot = parent;
    }

    return sharedRoot;
  } catch {
    return projectRoot;
  }
}

// A Permissions-Policy e uma so para o app inteiro (docs/30 §6.3 e I10; docs/06): camera, microfone e tela liberados
// para a propria origem e para o Jitsi proprio, geolocalizacao e pagamento bloqueados, e nenhum terceiro (YouTube,
// Vimeo, Bunny) na lista de camera e microfone. Por que em toda pagina e nao so na sala: o Chrome fixa a politica no
// carregamento do documento, e a navegacao interna do Next (o Entrar da pagina da live, a faixa "Ao vivo agora", o
// sino, o console aberto pelo editor) troca de pagina sem carregar outro documento; a sala aberta assim ficava com a
// politica da pagina de onde a pessoa veio, e o iframe recebia "nao autorizado" sem o navegador perguntar nada. O
// navegador pede a permissao na primeira vez; depois que a pessoa permite, o Chrome a guarda para a origem do app e uma
// pagina do app pode usa-la sem perguntar de novo: risco aceito (nenhum terceiro na lista, CSP com nonce, e so a sala ao
// vivo e o audio de um aviso pedem camera ou microfone; a alternativa mais fechada esta em docs/30 I10). O hostname e o de WEBINAR_MEET_DOMAIN no build (os cabecalhos do
// next.config sao fixados no build), ou meet.bunker707.com.br quando o build nao recebeu a variavel.
const meetDomain = meetDomainOf(process.env.WEBINAR_MEET_DOMAIN) ?? DEFAULT_MEET_DOMAIN;
const fullscreenOrigins = ['"https://www.youtube.com"', '"https://www.youtube-nocookie.com"', '"https://player.vimeo.com"', `"${meetOrigin(meetDomain)}"`];
const media = meetPermissionsAllowList(meetDomain);

const permissionsPolicy = [
  `camera=${media}`,
  `display-capture=${media}`,
  "geolocation=()",
  `microphone=${media}`,
  "payment=()",
  `fullscreen=(self ${fullscreenOrigins.join(" ")})`
].join(", ");

const securityHeaders = [
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin"
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin"
  },
  {
    key: "Permissions-Policy",
    value: permissionsPolicy
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  },
  {
    key: "X-Permitted-Cross-Domain-Policies",
    value: "none"
  },
  ...(process.env.NODE_ENV === "production"
    ? [{
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains"
      }]
    : [])
];

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins,
  // NEXT_OUTPUT=standalone so no build da imagem Docker (Dockerfile): gera .next/standalone com o servidor
  // e as dependencias minimas. Fora dele (Vercel, `npm run build`, testes de ponta a ponta) nada muda.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      {
        headers: securityHeaders,
        source: "/:path*"
      }
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // src/lib/image-hosts.ts também alimenta canOptimizeImageSrc no render.
    remotePatterns: imageRemotePatterns
  },
  turbopack: {
    root: getTurbopackRoot()
  }
};

export default nextConfig;
