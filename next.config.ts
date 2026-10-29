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

// Microfone bloqueado em todo o app; so o admin libera para a propria origem (gravar o audio de um aviso
// em Comunicacao > Avisos e pop-ups, docs/22). A regra de /admin vem depois da global e o Next usa a
// ultima que define a mesma chave (tests/deployment-security.test.mjs confere o valor efetivo).
//
// A sala ao vivo (docs/30 §6.3, §8.4 e I10): nas paginas do aluno em /webinarios e no console da equipe
// (/admin/comunicacao/webinarios/[id]/sala), camera, microfone e tela ficam liberados para a propria origem e
// para o Jitsi proprio (o iframe precisa deles para o aluno que levantou a mao, a camera do aluno e o palco do
// apresentador); o resto da area continua fechado. O hostname e o de WEBINAR_MEET_DOMAIN no build (os cabecalhos
// do next.config sao fixados no build), ou meet.bunker707.com.br quando o build nao recebeu a variavel.
const meetDomain = meetDomainOf(process.env.WEBINAR_MEET_DOMAIN) ?? DEFAULT_MEET_DOMAIN;
const fullscreenOrigins = ['"https://www.youtube.com"', '"https://www.youtube-nocookie.com"', '"https://player.vimeo.com"'];

function permissionsPolicy(microphone: "()" | "(self)", liveRoom = false) {
  const media = liveRoom ? meetPermissionsAllowList(meetDomain) : null;

  return [
    `camera=${media ?? "()"}`,
    `display-capture=${media ?? "()"}`,
    "geolocation=()",
    `microphone=${media ?? microphone}`,
    "payment=()",
    `fullscreen=(self ${[...fullscreenOrigins, ...(liveRoom ? [`"${meetOrigin(meetDomain)}"`] : [])].join(" ")})`
  ].join(", ");
}

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
    value: permissionsPolicy("()")
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
      },
      {
        headers: [{ key: "Permissions-Policy", value: permissionsPolicy("(self)") }],
        source: "/admin/:path*"
      },
      {
        headers: [{ key: "Permissions-Policy", value: permissionsPolicy("()", true) }],
        source: "/webinarios/:path*"
      },
      {
        headers: [{ key: "Permissions-Policy", value: permissionsPolicy("(self)", true) }],
        source: "/admin/comunicacao/webinarios/:id/sala"
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
