#!/usr/bin/env bash
# Monta o Live Bunker707.app (docs/30 D145) no Mac com Apple Silicon: compila a captura de voz (Xcode Command Line Tools),
# empacota com o Electron e assina sem certificado (assinatura local, "adhoc": sem a conta paga da Apple, o Mac pede para
# abrir pelo botao direito na primeira vez). Saida: out/Live Bunker707.app e out/Live-Bunker707-mac.zip.
set -euo pipefail
cd "$(dirname "$0")"
npm ci --no-audit --no-fund
mkdir -p out
swiftc -O nativo/voz.swift -o out/voz
node empacotar.mjs
app="out/Live Bunker707-darwin-arm64/Live Bunker707.app"
codesign --force --deep -s - "$app"
rm -rf "out/Live Bunker707.app" out/Live-Bunker707-mac.zip
mv "$app" "out/Live Bunker707.app"
rm -rf "out/Live Bunker707-darwin-arm64"
(cd out && ditto -c -k --keepParent "Live Bunker707.app" Live-Bunker707-mac.zip)
echo "pronto: out/Live Bunker707.app e out/Live-Bunker707-mac.zip"
