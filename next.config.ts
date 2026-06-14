import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localDevOrigins = Object.values(networkInterfaces()).flatMap((networkAddresses = []) => {
  return networkAddresses
    .filter((networkAddress) => networkAddress.family === "IPv4" && !networkAddress.internal)
    .map((networkAddress) => networkAddress.address);
});

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins
};

export default nextConfig;
