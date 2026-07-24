import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins,
  turbopack: {
    root: getTurbopackRoot()
  }
};

export default nextConfig;
