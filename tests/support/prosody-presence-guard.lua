-- O mod_bunker_presence_guard.lua rodando de verdade (docs/30 D115), com o util.stanza e o util.filters do Prosody 13
-- (a versao da imagem prosody da tag fixada). Quem chama: tests/infra-jitsi.test.mjs, so quando ha lua5.4 e
-- PROSODY_LUA_ROOT aponta para a raiz de um pacote do Prosody 13 desempacotado (usr/share/lua/5.4/prosody e
-- usr/lib/x86_64-linux-gnu/lua/5.4/prosody). Uso: lua5.4 tests/support/prosody-presence-guard.lua <raiz> <plugin>
local root, plugin = arg[1], arg[2]
package.path = root .. "/usr/share/lua/5.4/?.lua;" .. package.path
package.cpath = root .. "/usr/lib/x86_64-linux-gnu/lua/5.4/?.so;" .. package.cpath
-- Prosody 13 aceita require "util.x" (o nome antigo) apontando para prosody.util.x.
table.insert(package.searchers, 2, function(name)
  if name:match("^util%.") then
    return function() return require("prosody." .. name) end
  end
end)
local st = require "util.stanza"
local filters = require "util.filters"
local logs = {}
module = { log = function(_, level, fmt, ...) logs[#logs + 1] = level .. ": " .. string.format(fmt, ...) end }
assert(loadfile(plugin))()
module.load()

local function check(cond, label) if not cond then error("FALHOU: " .. label, 2) end print("ok - " .. label) end
local function session(user) local s = { jitsi_meet_context_user = user }; filters.initialize(s); return s end
local function presence()
  return st.presence({ to = "w-sala@muc.meet.jitsi/abcd1234" })
    :tag("avatar-url"):text("https://rastreador.example/pixel.png"):up()
    :tag("shared-video", { state = "start", time = "0" }):text("https://www.youtube.com/watch?v=x"):up()
    :tag("nick", { xmlns = "http://jabber.org/protocol/nick" }):text("Ana S."):up()
    :tag("audiomuted"):text("true"):up()
end
local function all(stanza, name) local found = {} for tag in stanza:childtags(name) do found[#found + 1] = tag end return found end

local FOTO = "https://projeto.supabase.co/storage/v1/object/public/content-assets/avatars/u1/foto.webp"
local s1 = session({ id = "u1", name = "Ana S.", avatar = FOTO })
local out = s1.filter("stanzas/in", presence())
check(#all(out, "shared-video") == 0, "o video compartilhado sai")
local avatars = all(out, "avatar-url")
check(#avatars == 1 and avatars[1]:get_text() == FOTO, "uma foto so, a do token, no lugar da anunciada")
check(out:get_child_text("nick", "http://jabber.org/protocol/nick") == "Ana S.", "o nome fica")
check(out:get_child_text("audiomuted") == "true", "os outros comandos ficam")
-- O que outro filtro acrescentar depois cai na raiz (o cursor nao ficou dentro da foto).
out:tag("identity"):up()
check(out:get_child("identity") ~= nil, "o cursor ficou na raiz")
local again = s1.filter("stanzas/in", out)
check(#all(again, "avatar-url") == 1, "passar de novo nao duplica a foto")

local s2 = session({ id = "u2", name = "Bia L." })
local semFoto = s2.filter("stanzas/in", presence())
check(#all(semFoto, "avatar-url") == 0, "sem foto no token: nenhuma (as iniciais)")
check(#all(semFoto, "shared-video") == 0, "sem foto no token: o video sai do mesmo jeito")

for _, ruim in ipairs({ "javascript:alert(1)", "data:image/png;base64,AAAA", "https://x.example/a b.png", string.rep("a", 1100), 42 }) do
  local s = session({ id = "u3", avatar = ruim })
  check(#all(s.filter("stanzas/in", presence()), "avatar-url") == 0, "foto recusada no token: " .. tostring(ruim):sub(1, 30))
end

local foco = session(nil)
check(#all(foco.filter("stanzas/in", presence()), "avatar-url") == 0, "sessao sem token (foco, ponte, gravador): sem foto")

local saida = st.presence({ type = "unavailable" }):tag("avatar-url"):text("https://x.example/a.png"):up()
check(#all(s1.filter("stanzas/in", saida), "avatar-url") == 1, "a presenca de saida passa intacta")
local msg = st.message({ to = "w-sala@muc.meet.jitsi" }):tag("shared-video"):up()
check(#all(s1.filter("stanzas/in", msg), "shared-video") == 1, "mensagem nao e presenca: passa intacta")

module.unload()
local depois = session({ id = "u4", avatar = FOTO })
local intacta = depois.filter and depois.filter("stanzas/in", presence()) or presence()
check(#all(intacta, "shared-video") == 1, "descarregado, o filtro nao vale para sessao nova")
print("logs: " .. #logs)
