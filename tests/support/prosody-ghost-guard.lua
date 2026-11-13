-- O mod_bunker_ghost_guard.lua rodando de verdade (docs/30 D122), com uma sala, sessoes e presencas de mentira: o modulo
-- so usa module:hook, module:log, module:require "util", prosody.full_sessions, room:each_occupant e room:set_role, e
-- nada do Prosody precisa estar instalado. Quem chama: tests/infra-jitsi.test.mjs, so quando ha lua5.4 na maquina.
-- Uso: lua5.4 tests/support/prosody-ghost-guard.lua <plugin>
local plugin = arg[1]
local hooks, logs = {}, {}
prosody = { full_sessions = {} }
module = {
  hook = function(_, name, handler, priority) hooks[name] = { handler = handler, priority = priority or 0 } end,
  log = function(_, level, fmt, ...) logs[#logs + 1] = level .. ": " .. string.format(fmt, ...) end,
  require = function(_, name)
    assert(name == "util", "so o util do Jitsi")
    return {
      is_admin = function(jid) return jid == "focus@auth.meet.jitsi" end,
      is_healthcheck_room = function(jid) return jid:match("^__jicofo%-health%-check") ~= nil end
    }
  end
}
assert(loadfile(plugin))()

local function check(cond, label) if not cond then error("FALHOU: " .. label, 2) end print("ok - " .. label) end

-- A presenca de saida que a sala manda a todos (so o que o modulo le e escreve).
local function unavailable(from)
  local stanza = { attr = { type = "unavailable", from = from }, tags = {} }
  function stanza:tag(name) self.tags[#self.tags + 1] = name; return self end
  function stanza:up() return self end
  return stanza
end

local function new_room(jid)
  local room = { jid = jid, occupants = {}, removed = {}, flipped = {} }
  function room:each_occupant() return pairs(self.occupants) end
  -- Como a sala do Prosody: tirar o papel tira a entrada e avisa a todos com uma presenca de saida.
  function room:set_role(actor, nick, role)
    assert(actor == true and role == "none", "so a saida feita pelo sistema")
    assert(self.occupants[nick], "a entrada existe")
    self.occupants[nick] = nil
    self.removed[#self.removed + 1] = nick
    local stanza = unavailable(nick)
    hooks["muc-broadcast-presence"].handler({ room = self, stanza = stanza })
    self.flipped[nick] = stanza.tags[1] == "flip_device"
    return true
  end
  return room
end

local count = 0
-- Uma conexao entra na sala: a sessao (com a conta do token, ou sem) e a entrada dela.
local function join(room, user, opts)
  count = count + 1
  opts = opts or {}
  local full_jid = (opts.bare or ("c" .. count .. "@meet.jitsi")) .. "/r" .. count
  local session = { jitsi_meet_context_user = user, hibernating = nil }
  prosody.full_sessions[full_jid] = session
  local nick = room.jid .. "/" .. string.format("%08x", count)
  local occupant = { nick = nick, bare_jid = full_jid:match("^[^/]+"), sessions = { [full_jid] = true } }
  room.occupants[nick] = occupant
  if not opts.silent then
    hooks["muc-occupant-joined"].handler({ room = room, occupant = occupant, origin = session })
  end
  return { nick = nick, session = session, full_jid = full_jid, occupant = occupant }
end
local function size(room) local n = 0 for _ in pairs(room.occupants) do n = n + 1 end return n end

check(hooks["muc-occupant-joined"].priority < 0, "roda depois da entrada (quem entra ja esta na sala)")

-- 1. O caso do teste do produtor: a pessoa sai sem se despedir e volta, tres vezes.
local sala = new_room("w-sala@muc.meet.jitsi")
local host = join(sala, { id = "host", name = "Dani S." })
local ana1 = join(sala, { id = "ana", name = "Ana S." })
check(size(sala) == 2 and #sala.removed == 0, "duas contas diferentes: ninguem sai")
ana1.session.hibernating = true
local ana2 = join(sala, { id = "ana", name = "Ana S." })
check(size(sala) == 2 and sala.removed[1] == ana1.nick, "a entrada antiga da mesma conta sai quando ela volta")
check(sala.flipped[ana1.nick] == true, "a saida leva a marca flip_device (nenhum aviso de removido para a turma)")
ana2.session.hibernating = true
local ana3 = join(sala, { id = "ana", name = "Ana S." })
ana3.session.hibernating = true
local ana4 = join(sala, { id = "ana", name = "Ana S." })
check(size(sala) == 2 and #sala.removed == 3, "tres voltas: sempre uma miniatura so")
check(sala.occupants[ana4.nick] ~= nil and sala.occupants[host.nick] ~= nil, "ficam quem voltou e o host")

-- 2. A mesma conta em duas abas abertas de verdade: as duas ficam.
local aba = join(sala, { id = "ana", name = "Ana S." })
check(size(sala) == 3 and #sala.removed == 3, "duas abas vivas da mesma conta continuam")
check(sala.occupants[ana4.nick] ~= nil and sala.occupants[aba.nick] ~= nil, "nenhuma das duas saiu")

-- 3. A entrada caida de OUTRA conta nunca sai por causa de quem entra.
local bia = join(sala, { id = "bia", name = "Bia L." })
bia.session.hibernating = true
join(sala, { id = "caio", name = "Caio M." })
check(sala.occupants[bia.nick] ~= nil, "a entrada caida de outra pessoa fica ate o prazo dela")
join(sala, { id = "bia", name = "Bia L." })
check(sala.occupants[bia.nick] == nil and sala.flipped[bia.nick] == true, "so a propria Bia, ao voltar, tira a entrada dela")

-- 4. Quem nao tem conta do token (o gravador, a ponte) e o foco: nunca entram na conta.
local antes = #sala.removed
local gravador = join(sala, nil)
gravador.session.hibernating = true
join(sala, nil)
check(#sala.removed == antes and sala.occupants[gravador.nick] ~= nil, "sem conta do token: ninguem sai")
local vazio = join(sala, { id = "" })
vazio.session.hibernating = true
join(sala, { id = "" })
check(#sala.removed == antes, "conta vazia no token: ninguem sai")
local foco_antigo = join(sala, { id = "ana" }, { bare = "focus@auth.meet.jitsi", silent = true })
foco_antigo.session.hibernating = true
join(sala, { id = "x" }, { bare = "focus@auth.meet.jitsi" })
check(sala.occupants[foco_antigo.nick] ~= nil, "a entrada do foco nao dispara nada")

-- 5. A sala de conferencia de saude do Jicofo fica fora.
local saude = new_room("__jicofo-health-check-1@muc.meet.jitsi")
local s1 = join(saude, { id = "ana" })
s1.session.hibernating = true
join(saude, { id = "ana" })
check(#saude.removed == 0, "a sala de saude fica fora")

-- 6. Uma entrada com duas conexoes so sai quando todas estao caidas.
local outra = new_room("w-outra@muc.meet.jitsi")
local d1 = join(outra, { id = "duda" })
local extra = "duda-extra@meet.jitsi/r999"
prosody.full_sessions[extra] = { jitsi_meet_context_user = { id = "duda" }, hibernating = nil }
d1.occupant.sessions[extra] = true
d1.session.hibernating = true
join(outra, { id = "duda" })
check(outra.occupants[d1.nick] ~= nil, "uma das conexoes ainda esta viva: a entrada fica")
prosody.full_sessions[extra].hibernating = true
join(outra, { id = "duda" })
check(outra.occupants[d1.nick] == nil, "todas caidas: a entrada sai")
-- Uma conexao que o servidor ja esqueceu nao e prova de nada: a entrada fica.
local e1 = join(outra, { id = "edu" })
prosody.full_sessions[e1.full_jid] = nil
join(outra, { id = "edu" })
check(outra.occupants[e1.nick] ~= nil, "sem a sessao para conferir: a entrada fica")

-- 7. Uma saida comum (ninguem a esta tirando) passa sem a marca.
local comum = unavailable("w-sala@muc.meet.jitsi/abcd1234")
hooks["muc-broadcast-presence"].handler({ room = sala, stanza = comum })
check(#comum.tags == 0, "a saida de quem saiu sozinho passa intacta")

-- 8. Um erro ao tirar a entrada antiga vira aviso no log: a entrada de quem volta nao e desfeita.
local ruim = new_room("w-ruim@muc.meet.jitsi")
local f1 = join(ruim, { id = "fabi" })
f1.session.hibernating = true
ruim.set_role = function() error("a sala nao deixou") end
local ok = pcall(join, ruim, { id = "fabi" })
check(ok, "o erro nao sobe")
local avisou = false
for _, line in ipairs(logs) do if line:match("^warn: ") then avisou = true end end
check(avisou, "o erro vira aviso no log")
print("logs: " .. #logs)
