-- Bunker707: o que cada participante anuncia na presenca da sala (docs/30 D115). Modulo nosso (nao vem do Jitsi),
-- carregado no MUC por XMPP_MUC_MODULES=token_affiliation,bunker_room_guard,bunker_presence_guard. Como o
-- mod_muc_displayname do Jitsi, e um filtro de entrada das sessoes (util.filters, stanzas/in), que vale para todas.
--
-- Por que: para a miniatura mostrar a foto do Perfil, o custom-config.js liga os pedidos a terceiros
-- (disableThirdPartyRequests = false): na tag fixada, so assim o motor carrega foto por endereco. Com a chave ligada,
-- o navegador de cada participante carrega a foto que os outros anunciam (o comando avatar-url da presenca) e toca o
-- video compartilhado (o comando shared-video, YouTube) que qualquer um mandar, fixado no palco de todos. Os dois saem
-- do navegador de quem esta na sala: sem este modulo, um aluno com as ferramentas do navegador anunciaria a foto num
-- endereco qualquer (o de um rastreador, ou a foto de outra pessoa) ou poria um video no palco da turma.
--
-- Como: em toda presenca que chega de uma sessao, tira o <shared-video> (a sala nunca usa) e o <avatar-url>, e poe de
-- volta so a foto do token (session.jitsi_meet_context_user.avatar: o app assina so a foto enviada pelo Perfil, no
-- endereco do nosso Storage; src/server/webinars/live-room.ts). Sem foto no token, nenhuma: a miniatura mostra as
-- iniciais. Um erro aqui nunca derruba a sessao: a presenca segue sem foto.

local filters = require "util.filters";
local st = require "util.stanza";

-- Os comandos da presenca que o navegador nao decide: o video compartilhado sai sempre; a foto volta so a do token.
local STRIPPED = { ["shared-video"] = true, ["avatar-url"] = true };
local MAX_AVATAR_LENGTH = 1024;

local function token_avatar(session)
    local user = session and session.jitsi_meet_context_user;
    local avatar = type(user) == "table" and user.avatar or nil;
    if type(avatar) == "string" and #avatar <= MAX_AVATAR_LENGTH and avatar:match("^https?://[^%s<>\"]+$") then
        return avatar;
    end
    return nil;
end

local function strip(stanza)
    stanza:maptags(function(tag)
        if STRIPPED[tag.name] then
            return nil;
        end
        return tag;
    end);
end

local function guard_presence(stanza, session)
    if type(stanza) ~= "table" or stanza.name ~= "presence" or stanza.attr.type == "error" or stanza.attr.type == "unavailable" then
        return stanza;
    end
    local ok, err = pcall(function()
        strip(stanza);
        local avatar = token_avatar(session);
        if avatar then
            -- Na raiz da presenca, sem mexer no cursor do stanza (o que outro filtro acrescentar depois cai no lugar certo).
            stanza:add_direct_child(st.stanza("avatar-url"):text(avatar));
        end
    end);
    if not ok then
        module:log("warn", "presenca seguiu sem a foto: %s", tostring(err));
        pcall(strip, stanza);
    end
    return stanza;
end

local function filter_session(session)
    filters.add_filter(session, "stanzas/in", guard_presence, -99);
end

function module.load()
    filters.add_filter_hook(filter_session);
end

function module.unload()
    filters.remove_filter_hook(filter_session);
end
