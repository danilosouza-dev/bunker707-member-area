import { packager } from "@electron/packager";
import { readFileSync } from "node:fs";

const { devDependencies, version } = JSON.parse(readFileSync("package.json", "utf8"));

await packager({
  appBundleId: "br.com.bunker707.live",
  appCategoryType: "public.app-category.education",
  appVersion: version,
  arch: "arm64",
  asar: true,
  dir: ".",
  electronVersion: devDependencies.electron,
  extendInfo: {
    LSMinimumSystemVersion: "14.0",
    NSCameraUsageDescription: "Para a sua câmera aparecer nas lives da Bunker707.",
    NSMicrophoneUsageDescription: "Para você falar nas lives da Bunker707."
  },
  extraResource: ["out/voz"],
  ignore: [/^\/out/, /^\/nativo/, /^\/build\.sh/, /^\/empacotar\.mjs/, /^\/README\.md/, /\.log$/],
  name: "Live Bunker707",
  osxSign: false,
  out: "out",
  overwrite: true,
  platform: "darwin"
});
