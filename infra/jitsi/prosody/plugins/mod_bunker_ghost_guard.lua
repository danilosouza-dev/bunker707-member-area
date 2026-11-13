-- Bunker707: quem volta a sala tira a propria entrada antiga (docs/30 D122). Modulo nosso (nao vem do Jitsi), carregado
-- no MUC por XMPP_MUC_MODULES=token_affiliation,bunker_room_guard,bunker_presence_guard,bunker_ghost_guard.
--
-- Por que: quando o navegador de alguem fecha a conexao sem se despedir (a aba fechada, a pagina recarregada, a queda
-- da rede, o iframe desmontado antes de o motor avisar a saida), o mod_smacks guarda a sessao por
-- smacks_hibernation_time (60 s) esperando a retomada, e a pessoa continua na sala para todo mundo. Se ela entra de
-- novo nesse meio tempo, aparece duas vezes nas miniaturas de todos ate o prazo vencer; saindo e entrando tres vezes,
-- tres vezes (teste do produtor de 13/11/2026).
--
-- Como: depois que alguem entra, as outras entradas da MESMA conta do token (session.jitsi_meet_context_user.id, que o
-- app assina) cujas conexoes estao todas hibernando saem na hora (o papel vira "none", como um Remover do sistema). So
-- a entrada morta sai: a mesma conta em duas abas abertas de verdade continua com as duas, e ninguem tira a entrada de
-- outra pessoa. A saida leva a marca flip_device, que o motor trata como "trocou de aparelho": nenhum aviso de
-- "foi removido" para a turma. Quem nao tem conta do token (o Jicofo, o gravador) nunca entra na conta.
-- Um erro aqui nunca impede a entrada: ela ja aconteceu, e a entrada antiga sai sozinha no prazo do mod_smacks.

local oss_util = module:require "util";
local is_admin = oss_util.is_admin;
local is_healthcheck_room = oss_util.is_healthcheck_room;

-- As entradas que este modulo esta tirando: a presenca de saida delas leva a marca flip_device.
local leaving = {};

local function user_id_of(session)
    local user = session and session.jitsi_meet_context_user;
    local id = type(user) == "table" and user.id or nil;
    if type(id) == "string" and id ~= "" then
        return id;
    end
    return nil;
end

-- A entrada e a antiga da mesma conta: todas as conexoes dela sao dessa conta e estao hibernando.
local function is_ghost_of(occupant, user_id)
    local found = false;
    for full_jid in pairs(occupant.sessions or {}) do
        local session = prosody.full_sessions[full_jid];
        if not session or user_id_of(session) ~= user_id or not session.hibernating then
            return false;
        end
        found = true;
    end
    return found;
end

module:hook("muc-occupant-joined", function(event)
    local room, occupant, session = event.room, event.occupant, event.origin;
    if not room or not occupant or is_healthcheck_room(room.jid) or is_admin(occupant.bare_jid) then
        return;
    end
    local user_id = user_id_of(session);
    if not user_id then
        return;
    end
    local ok, err = pcall(function()
        local ghosts = {};
        for _, other in room:each_occupant() do
            if other.nick ~= occupant.nick and is_ghost_of(other, user_id) then
                ghosts[#ghosts + 1] = other.nick;
            end
        end
        for _, nick in ipairs(ghosts) do
            leaving[nick] = true;
            module:log("info", "entrada antiga da mesma conta saiu de %s", room.jid);
            room:set_role(true, nick, "none");
            leaving[nick] = nil;
        end
    end);
    if not ok then
        module:log("warn", "a entrada antiga ficou ate o prazo: %s", tostring(err));
    end
end, -10);

-- A saida da entrada antiga leva a marca de troca de aparelho: o motor nao avisa a turma de um "foi removido".
module:hook("muc-broadcast-presence", function(event)
    local stanza = event.stanza;
    if stanza and stanza.attr.type == "unavailable" and leaving[stanza.attr.from] then
        stanza:tag("flip_device"):up();
    end
end);
