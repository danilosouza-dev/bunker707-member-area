import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { imageRemotePatterns } from "./src/lib/image-hosts";

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
    value: [
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "microphone=()",
      "payment=()",
      'fullscreen=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://player.vimeo.com")'
    ].join(", ")
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
    return [{
      headers: securityHeaders,
      source: "/:path*"
    }];
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
