-- Bunker707: barra na entrada da sala quem a equipe removeu ou baniu (docs/30 §1.4 e §8.1). Modulo nosso (nao vem do
-- Jitsi), carregado no MUC por XMPP_MUC_MODULES=token_affiliation,bunker_room_guard.
--
-- Por que: o Remover da sala e o Banir gravam a linha no banco do app e o console manda kickParticipant, mas o Jitsi so
-- confere o token na entrada. O token que o navegador do aluno ja tem (ate 15 min) e o nome da sala continuam valendo:
-- sem este modulo, quem foi removido abre a sala de novo com o token antigo e volta na hora.
--
-- Como: a cada ROOM_GUARD_POLL_SECONDS (5 s) busca no app a lista de barrados (GET assinado em ROOM_GUARD_URL:
-- HMAC-SHA256 de "<timestamp>." com a chave derivada do JWT_APP_SECRET, a mesma conta de roomGuardKey no app) e guarda
-- na memoria. Na entrada (muc-occupant-pre-join, prioridade 5: antes do token_affiliation em -3.5, do lobby em -4 e do
-- members_only em -5) le a conta do token (session.jitsi_meet_context_user.id, nunca o JID, que muda a cada conexao) e
-- o nome da sala, e recusa com not-allowed a conta removida desta sala ou banida de todas. O gancho nunca espera a rede
-- (a lista ja esta na memoria). Sem ROOM_GUARD_URL, ou com o app fora, a ultima lista boa continua valendo (e um aviso
-- no log): a sala nunca para por causa do app; o token curto limita a janela.

local http = require "net.http";
local json = require "util.json";
local hashes = require "util.hashes";
local hex = require "util.hex";
local jid = require "util.jid";
local st = require "util.stanza";

local util = module:require "util";
local is_admin = util.is_admin;
local is_healthcheck_room = util.is_healthcheck_room;

local GUARD_URL = os.getenv("ROOM_GUARD_URL") or "";
local JWT_SECRET = os.getenv("JWT_APP_SECRET") or "";
local POLL_SECONDS = tonumber(os.getenv("ROOM_GUARD_POLL_SECONDS") or "") or 5;
local GUARD_LABEL = "bunker707-room-guard";

local to_hex = hex.to or hex.encode;

-- HMAC-SHA256 em hexadecimal (a versao do Prosody pode devolver binario ou hexadecimal).
local function hmac_hex(key, message)
    local mac = hashes.hmac_sha256(key, message);
    if #mac == 32 then
        return to_hex(mac);
    end
    return mac;
end

local guard_key = JWT_SECRET ~= "" and hmac_hex(JWT_SECRET, GUARD_LABEL) or nil;

-- A ultima lista boa: kicked[sala][conta] e banned[conta].
local kicked = {};
local banned = {};

local function to_set(list)
    local set = {};
    if type(list) == "table" then
        for _, value in ipairs(list) do
            if type(value) == "string" then
                set[value] = true;
            end
        end
    end
    return set;
end

local function refresh()
    if GUARD_URL == "" or not guard_key then
        return;
    end
    local timestamp = tostring(os.time());
    local headers = {
        ["X-Bunker-Timestamp"] = timestamp,
        ["X-Bunker-Signature"] = hmac_hex(guard_key, timestamp .. ".")
    };
    http.request(GUARD_URL, { method = "GET", headers = headers }, function(body, code)
        if code ~= 200 or type(body) ~= "string" then
            module:log("warn", "lista de barrados indisponivel (HTTP %s); fica a ultima", tostring(code));
            return;
        end
        local ok, data = pcall(json.decode, body);
        if not ok or type(data) ~= "table" then
            module:log("warn", "lista de barrados invalida; fica a ultima");
            return;
        end
        local next_kicked = {};
        if type(data.rooms) == "table" then
            for room_name, users in pairs(data.rooms) do
                if type(room_name) == "string" then
                    next_kicked[room_name:lower()] = to_set(users);
                end
            end
        end
        kicked = next_kicked;
        banned = to_set(data.banned);
    end);
end

if GUARD_URL == "" then
    module:log("warn", "ROOM_GUARD_URL vazio: removido e banido so saem pelo token curto (docs/30 §8.1)");
elseif not guard_key then
    module:log("warn", "JWT_APP_SECRET vazio: a lista de barrados nao e buscada");
else
    module:add_timer(1, function()
        refresh();
        return POLL_SECONDS;
    end);
end

module:hook("muc-occupant-pre-join", function(event)
    local room, occupant, session, stanza = event.room, event.occupant, event.origin, event.stanza;

    if is_healthcheck_room(room.jid) or is_admin(occupant.bare_jid) then
        return;
    end

    local context_user = session and session.jitsi_meet_context_user;
    local user_id = context_user and context_user.id;
    if type(user_id) ~= "string" then
        return;
    end

    local room_name = (jid.node(room.jid) or ""):lower();
    local in_room = kicked[room_name];
    if banned[user_id] or (in_room and in_room[user_id]) then
        module:log("info", "entrada recusada: conta barrada na sala %s", room_name);
        session.send(st.error_reply(stanza, "cancel", "not-allowed", "Removido desta sala."));
        return true;
    end
end, 5);
