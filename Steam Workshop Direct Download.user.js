// ==UserScript==
// @name         Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      26.06.21.10
// @description  Download direto de mods do Steam Workshop via mirrors, com detecção automática de jogo.
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/*/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// @connect      insane.x10.mx
// @connect      api.steampowered.com
// @connect      smods.ru
// @connect      catalogue.smods.ru
// @updateURL    https://github.com/Martin01683/Scripts-do-ViolentMonkey/raw/refs/heads/main/Steam%20Workshop%20Direct%20Download.user.js
// @downloadURL  https://github.com/Martin01683/Scripts-do-ViolentMonkey/raw/refs/heads/main/Steam%20Workshop%20Direct%20Download.user.js
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Inicialização e Configurações de Usuário
     * Permite ao usuário alternar a visibilidade das informações detalhadas de cache no tooltip.
     */
    let showCacheInfo = GM_getValue('showCacheInfo', 0);

    GM_registerMenuCommand(showCacheInfo ? '❌ Ocultar Info de Cache' : '✅ Mostrar Info de Cache', () => {
        showCacheInfo = showCacheInfo ? 0 : 1;
        GM_setValue('showCacheInfo', showCacheInfo);
        alert('Configuração salva! A página será recarregada para aplicar as mudanças.');
        window.location.reload();
    });

    /**
     * Utilitário de Segurança (Sanitização)
     * Previne ataques de Cross-Site Scripting (XSS) convertendo caracteres especiais em entidades HTML.
     * Deve ser utilizado antes de injetar qualquer dado dinâmico na DOM.
     *
     * @param {string} str - A string a ser sanitizada.
     * @returns {string} String segura para injeção no HTML.
     */
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
    }

    // ========================================================================
    // MÓDULO 0: CACHE MANAGER (Gerenciador Centralizado de Armazenamento)
    // Abstrai as operações do localStorage, tratando falhas de limite de cota
    // e garantindo a resiliência do armazenamento local.
    // ========================================================================
    const CacheManager = {
        set(key, dataObj) {
            try {
                localStorage.setItem(key, JSON.stringify(dataObj));
            } catch(e) {
                // Estratégia de Fallback: Se o limite de armazenamento (geralmente 5MB) for atingido,
                // removemos todos os caches gerados pelo script ('SWDD_') e tentamos salvar novamente.
                if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                    try {
                        console.warn('[SWDD] LocalStorage atingiu o limite de cota. Executando limpeza preventiva...');
                        this.clearByPrefix('SWDD_');
                        localStorage.setItem(key, JSON.stringify(dataObj));
                    } catch(err) {
                        console.error('[SWDD] Falha crítica ao gravar no cache após limpeza.', err);
                    }
                }
            }
        },
        get(key) {
            try {
                const stored = localStorage.getItem(key);
                if (stored) return JSON.parse(stored);
            } catch(e) {}
            return null;
        },
        remove(key) {
            localStorage.removeItem(key);
        },
        clearByPrefix(prefix) {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) keysToRemove.push(k);
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        }
    };

    // ========================================================================
    // MÓDULO 0.1: API CLIENT (Gerenciador de Requisições de Rede)
    // Encapsula a API assíncrona do Tampermonkey (GM_xmlhttpRequest) em Promises,
    // tornando o fluxo de requisições externo mais limpo e legível (async/await).
    // ========================================================================
    const ApiClient = {
        fetch(url, options = {}) {
            const timeoutMs = options.timeout || 15000;
            return new Promise((resolve, reject) => {
                let settled = false;
                const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

                // Watchdog independente do "timeout" interno do GM_xmlhttpRequest.
                // Em alguns cenários (ex: o processo em segundo plano da extensão sendo
                // reiniciado pelo navegador) nenhum dos callbacks onload/onerror/ontimeout
                // chega a ser disparado e a requisição fica pendente PARA SEMPRE — isso
                // travava "isFetchingBatch" e, em cascata, impedia o cache da Steam de ser
                // renovado mesmo após expirar (o tooltip ficava preso mostrando "0s" e
                // nunca mais era atualizado, mesmo com o usuário interagindo com a página).
                // Esse watchdog garante que a Promise sempre se resolve/rejeita dentro de
                // um prazo, então o sistema de cache nunca fica permanentemente travado.
                const watchdog = setTimeout(() => finish(reject, new Error('Watchdog Timeout')), timeoutMs + 5000);

                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    data: options.data,
                    headers: options.headers,
                    timeout: timeoutMs, // Timeout estrito previne vazamento de memória em redes lentas
                    onload: (res) => {
                        clearTimeout(watchdog);
                        if (res.status >= 200 && res.status < 300) finish(resolve, res);
                        else finish(reject, { status: res.status, responseText: res.responseText });
                    },
                    onerror: () => { clearTimeout(watchdog); finish(reject, new Error('Network Error')); },
                    ontimeout: () => { clearTimeout(watchdog); finish(reject, new Error('Timeout')); }
                });
            });
        }
    };

    // ========================================================================
    //  MÓDULO 1: CONFIGURAÇÕES E PARSERS (Utilitários de Extração de Dados)
    // Funções projetadas para extrair e normalizar datas e IDs de diversas fontes.
    // ========================================================================
    const utils = {
        /**
         * Lida com Repetições de Mods em Mirrors Completos.
         * Garante que, se um Mod ID aparecer duas vezes na mesma API, apenas o arquivo mais recente será mantido.
         */
        addOrUpdateMod: function(resultObj, id, link, parsedDateObj) {
            const newDate = parsedDateObj ? parsedDateObj.date : null;
            const currentData = resultObj[id];

            // Se o mod ainda não existe no resultado, OU se a nova data for estritamente MAIOR que a data já salva
            if (!currentData || (newDate && (!currentData.date || newDate > currentData.date))) {
                resultObj[id] = {
                    link: link,
                    date: newDate,
                    exactTime: parsedDateObj ? parsedDateObj.exact : true
                };
            }
        },
        /**
         * Extrai e converte strings de datas complexas de mirrors (como o Skymods).
         * Prioriza datas explícitas e determina se a hora exata está disponível.
         */
        parseSmodsDate: function(dateStr) {
            if (!dateStr) return null;
            dateStr = String(dateStr).trim();

            let cleanStr = dateStr.replace(/\s+at\s+/i, ' ');
            const match = cleanStr.match(/(\d{1,2})\s+([A-Za-z]{3,})(?:,?\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?/i);

            if (match) {
                const day = parseInt(match[1], 10);
                const monthStr = match[2].toLowerCase().substring(0, 3);
                let year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
                const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                const month = months[monthStr];

                if (month !== undefined) {
                    let parsedDate;
                    let exact = false;
                    if (match[4] !== undefined && match[5] !== undefined) {
                        const hours = parseInt(match[4], 10);
                        const minutes = parseInt(match[5], 10);
                        parsedDate = new Date(Date.UTC(year, month, day, hours + 3, minutes, 0));
                        exact = true; // Confirma que a hora/minuto foi extraída com precisão
                    } else {
                        parsedDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
                    }

                    // Se a data futura for identificada sem ano especificado, assume que é do ano anterior
                    if (!match[3] && parsedDate.getTime() > Date.now()) {
                        parsedDate.setUTCFullYear(year - 1);
                    }
                    return { date: parsedDate, exact: exact };
                }
            }

            const d1 = new Date(cleanStr);
            if (!isNaN(d1.getTime())) {
                if (!/\d{2}:\d{2}/.test(cleanStr)) {
                    d1.setUTCHours(23, 59, 59, 999);
                    return { date: d1, exact: false };
                }
                return { date: d1, exact: true };
            }
            return null;
        },

        // Métodos auxiliares para parse de Insane Mirror e JSON do Insane GH
        parseInsaneDate: function(dateStr) {
            if (!dateStr || dateStr.startsWith('0000-00-00')) return null;
            const d = new Date(dateStr.replace(' ', 'T') + '+01:00');
            return isNaN(d.getTime()) ? null : { date: d, exact: /\d{2}:\d{2}/.test(dateStr) };
        },
        parseInsaneGHDate: function(dateStr) {
            if (!dateStr) return null;
            const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!match) return null;
            return { date: new Date(Date.UTC(match[1], match[2] - 1, match[3], match[4] - 1, match[5], match[6] || 0)), exact: true };
        },
        getIdFromName: function(name) {
            const match = String(name || '').match(/^\s*(\d{6,})/);
            return match ? match[1] : null;
        },

        /**
         * Compara a data de atualização do mirror com a data oficial da Steam.
         * Despreza diferenças de segundos (converte para minutos).
         */
        isUpToDate: function(dateMirror, dateSteam) {
            if (dateSteam === STEAM_NO_DATE || dateSteam === STEAM_FETCH_ERROR) return true;
            if (!dateMirror) return false;
            const minMirror = Math.floor(dateMirror.getTime() / 60000);
            const minSteam = Math.floor(dateSteam.getTime() / 60000);
            return minMirror >= minSteam;
        },
        extractJsonArray: function(text, varName) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return text;
                if (parsed[varName]) return JSON.stringify(parsed[varName]);
            } catch (e) {}
            const regex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`);
            const match = text.match(regex);
            if (!match) return null;

            const startIdx = match.index + match[0].length - 1;
            let depth = 0;

            let inString = false;
            let stringChar = '';

            for (let i = startIdx; i < text.length; i++) {
                const char = text[i];
                if (!inString && (char === '"' || char === "'")) {
                    inString = true;
                    stringChar = char;
                } else if (inString && char === stringChar && text[i-1] !== '\\') {
                    inString = false;
                } else if (!inString) {
                    if (char === '[') depth++;
                    else if (char === ']') {
                        depth--;
                        if (depth === 0) return text.substring(startIdx, i + 1);
                    }
                }
            }
            return null;
        }
    };

    // ========================================================================
    // MÓDULO 1.1: TEMPLATES DE MIRRORS (Arquitetura Escalável)
    // Definição estrutural padronizada de como o script se comunica e
    // compreende as respostas de provedores/mirrors de mods de terceiros.
    // ========================================================================
    /**
     * @typedef {Object} MirrorTemplate
     * @property {string} id - Identificador único no sistema de cache.
     * @property {string} name - Nome de exibição na interface do usuário.
     * @property {string} type - "per_mod" (consulta individual sob demanda) ou "full_db" (download de indexação completa).
     * @property {function|string} url - Resolve a URL do endpoint de busca.
     * @property {number} cacheTime - Tempo de expiração do cache deste serviço (em ms).
     * @property {function} parser - Interpretador responsável por encontrar links e datas no corpo da resposta.
     * @property {string} [requestUrl] - (Opcional) URL do fórum para pedir mods ou atualizações neste provedor.
     * @property {object} [gameProbe] - Configuração para sondagem dinâmica de suporte ao jogo.
     */
    const MIRROR_TEMPLATES = {
        skymods: (appId) => {
            // Verifica se o jogo atual é o Cities: Skylines
            const isCitiesSkylines = appId === '255710';

            return {
                id: `smods_${appId}`,
                name: "Skymods",
                type: "per_mod",

                // Redireciona a URL dinamicamente com base no jogo
                url: (modId) => isCitiesSkylines
                    ? `https://smods.ru/?s=${modId}`
                    : `https://catalogue.smods.ru/?s=${modId}&app=${appId}`,

                cacheTime: 60 * 60 * 1000, // Cache de 1 hora
                parser: (responseText, modId) => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(responseText, "text/html");
                    let bestMatch = null;
                    const posts = doc.querySelectorAll('article.post');

                    for (const post of posts) {
                        const possibleDates = [];

                        // Extração passiva de todas as datas secundárias (Fallbacks de metadados HTML)
                        post.querySelectorAll('.updated, .published, .skymods-item-date').forEach(el => {
                            const textOrAttr = el.getAttribute('datetime') || el.textContent;
                            const res = utils.parseSmodsDate(textOrAttr);
                            if (res && res.date && !isNaN(res.date.getTime())) possibleDates.push({ date: res.date, time: res.date.getTime(), exact: res.exact });
                        });

                        // Seleciona a data de fallback mais recente
                        let fallbackDateObj = null;
                        if (possibleDates.length > 0) {
                            const maxObj = possibleDates.reduce((prev, curr) => (prev.time > curr.time) ? prev : curr);
                            fallbackDateObj = { date: new Date(maxObj.time), exact: maxObj.exact };
                        }

                        // Extração ativa da data prioritária inserida manualmente no texto ("Last revision:")
                        let revDateObj = null;
                        const textContent = post.textContent;
                        const revMatch = textContent.match(/Last revision:\s*([^\n\r]+)/i);
                        if (revMatch) {
                            const res = utils.parseSmodsDate(revMatch[1].trim());
                            if (res && res.date && !isNaN(res.date.getTime())) revDateObj = { date: res.date, exact: res.exact };
                        }

                        // Busca o link direto de download, evitando links internos de navegação
                        const linkEl = Array.from(post.querySelectorAll('.skymods-excerpt-btn')).find(a => a.href && !a.href.includes('/archives/'));

                        if ((revDateObj || fallbackDateObj) && linkEl) {
                            const primaryDate = revDateObj ? revDateObj.date : fallbackDateObj.date;
                            const primaryExact = revDateObj ? revDateObj.exact : fallbackDateObj.exact;

                            const modData = {
                                link: linkEl.href,
                                date: primaryDate,
                                exactTime: primaryExact,
                                fallbackDate: fallbackDateObj ? fallbackDateObj.date : null,
                                fallbackExact: fallbackDateObj ? fallbackDateObj.exact : true
                            };

                            // Garantia de vínculo seguro contra duplicatas em páginas de pesquisa
                            const steamLink = post.querySelector('a[href*="steamcommunity.com/"][href*="?id="]');
                            if (steamLink) {
                                const idMatch = steamLink.href.match(/id=(\d+)/);
                                if (idMatch && idMatch[1] === modId) {
                                    if (!bestMatch || (modData.date && (!bestMatch.date || modData.date > bestMatch.date))) {
                                        bestMatch = modData;
                                    }
                                }
                            } else if (!bestMatch) {
                                bestMatch = modData;
                            }
                        }
                    }
                    return bestMatch;
                },
                // Desativa a sondagem dinâmica (probe) se for Cities: Skylines, evitando o bloqueio.
                // Mantém ativo para os outros jogos do catalogue.
                gameProbe: isCitiesSkylines ? null : {
                    url: `https://catalogue.smods.ru/?app=${appId}`,
                    parser: (responseText) => {
                        const doc = new DOMParser().parseFromString(responseText, "text/html");
                        const option = doc.querySelector(`select#select-app option[value="${appId}"]`);
                        return !!option;
                    }
                }
            };
        },

        insane_php: (uniqueId, phpFileName) => ({
            id: `insane_php_${uniqueId}`,
            name: "Insane Mirror",
            type: "full_db",
            url: `https://insane.x10.mx/${phpFileName}.php`,
            cacheTime: 60 * 60 * 1000,
            parser: (responseText) => {
                const jsonString = utils.extractJsonArray(responseText, 'allMods');
                if (!jsonString) throw new Error("Format error");
                const parsedData = JSON.parse(jsonString);
                const result = {};
                parsedData.forEach(mod => {
                    if (mod.name && (mod.link || mod.url)) {
                        const steamId = String(mod.name || '').match(/^(\d+)/);
                        if (steamId) {
                            const parsed = utils.parseInsaneDate(mod.uploaded);
                            utils.addOrUpdateMod(result, steamId[1], mod.link || mod.url, parsed);
                        }
                    }
                });
                return result;
            }
        }),

        insane_gh_json: (uniqueId, jsonUrl) => ({
            id: `insane_gh_${uniqueId}`,
            name: "Insane GH",
            type: "full_db",
            url: jsonUrl,
            cacheTime: 60 * 60 * 1000,
            parser: (responseText) => {
                const json = JSON.parse(responseText);
                const files = Array.isArray(json?.files) ? json.files : [];
                const result = {};
                files.forEach(file => {
                    const steamId = utils.getIdFromName(file?.name);
                    const link = file?.link || file?.url;
                    if (steamId && link) {
                        const parsed = utils.parseInsaneGHDate(file.uploaded);
                        utils.addOrUpdateMod(result, steamId, link, parsed);
                    }
                });
                return result;
            }
        })
    };

    // ========================================================================
    // MÓDULO 1.2: REGISTRO DE JOGOS SUPORTADOS (Modo Explícito)
    // Configurações de jogos que possuem listas ou mirrors exclusivos.
    // ========================================================================
    /**
     * @typedef {Object} GameConfig
     * @property {string} [forumUrl] - (Opcional) URL do tópico oficial do jogo no fórum (ex: CS.RIN) para pedidos.
     * @property {Array<MirrorTemplate>} mirrors - Lista de templates (provedores) EXCLUSIVOS/manuais deste jogo,
     *           em ORDEM DE PRIORIDADE: o primeiro mirror da lista que retornar uma versão em dia "vence" a busca
     *           (ver getBestModFromMirrors()), então a ordem aqui declarada importa.
     *           Os mirrors universais (MÓDULO 1.3) são SEMPRE mesclados automaticamente ao final desta lista
     *           pelo resolveGameConfig() — a menos que:
     *             a) o mesmo mirror universal já tenha sido declarado manualmente aqui (basta incluir, por
     *                exemplo, MIRROR_TEMPLATES.skymods(appId) na posição desejada; a mesclagem automática
     *                detecta o "id" repetido e não o duplica — isso permite controlar a ordem/prioridade
     *                de busca de um mirror universal especificamente para este jogo); ou
     *             b) o "id" desse mirror universal esteja listado em "excludeUniversalMirrors" abaixo.
     * @property {Array<string>} [excludeUniversalMirrors] - (Opcional) Lista de "id"s de mirrors universais
     *           que NÃO devem ser pesquisados para este jogo específico (opt-out por jogo). Útil quando um
     *           mirror universal é sabidamente incompatível/irrelevante para este título.
     *           Exemplo: excludeUniversalMirrors: ['smods_1118520']
     */
    const GAMES_CONFIG = {
        '1118520': { // Paralives
            forumUrl: "https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692",
            mirrors: [
                MIRROR_TEMPLATES.insane_gh_json('paralives', 'https://raw.githubusercontent.com/AORUS834/947e26abefdb9eb0a9cd292d2ee691d9/refs/heads/main/files.json'),
                // Mirror universal posicionado manualmente: fica em 2º lugar na prioridade de busca
                // para este jogo e, por já estar declarado aqui, não é duplicado pela mesclagem automática.
                MIRROR_TEMPLATES.skymods('1118520')
            ]
        },
        '3450310': { // Europa Universalis V
            forumUrl: "https://cs.rin.ru/forum/viewtopic.php?f=10&t=152865",
            mirrors: [
                MIRROR_TEMPLATES.insane_php('eu5', 'eu5'),
                MIRROR_TEMPLATES.skymods('3450310')
            ]
        }
    };

    // ========================================================================
    // MÓDULO 1.3: MIRRORS UNIVERSAIS (Modo Dinâmico / Mesclagem Automática)
    // Mirrors que indexam múltiplos jogos simultaneamente.
    //
    // Agora estes mirrors são SEMPRE incluídos na busca de QUALQUER jogo — inclusive
    // jogos com configuração manual em GAMES_CONFIG. O resolveGameConfig() mescla a
    // lista de mirrors manuais (prioridade máxima, busca primeiro) com os mirrors
    // universais (mesclados em seguida, exceto os que já foram declarados manualmente
    // ou explicitamente excluídos via "excludeUniversalMirrors" — ver MÓDULO 1.2).
    //
    // Para jogos SEM entrada em GAMES_CONFIG, esta lista continua sendo a ÚNICA fonte
    // de mirrors (Modo Dinâmico "puro"), e nesse caso o script ainda faz a sondagem de
    // suporte (GameSupportManager) para não injetar botões em jogos que comprovadamente
    // não têm mods hospedados em nenhum mirror universal.
    // ========================================================================
    /**
     * → Para DESATIVAR completamente o suporte universal (tanto no modo dinâmico "puro"
     * quanto na mesclagem automática com jogos de GAMES_CONFIG), deixe a lista vazia: => []
     *
     * → Se a lista estiver vazia E o AppID não estiver em GAMES_CONFIG,
     * o script não injetará nenhum botão na página.
     *
     * @param {string} appId - AppID do jogo detectado na URL.
     * @returns {Array} Lista de templates de mirrors.
     */
    const UNIVERSAL_MIRRORS = (appId) => [
        MIRROR_TEMPLATES.skymods(appId)
        // Adicione outros mirrors universais abaixo seguindo o exemplo:
        // MIRROR_TEMPLATES.exemplo(appId)
    ];

    /**
     * Extrai o AppID (ID do Jogo) da URL ou do HTML da página da Steam de forma segura.
     * Prevê múltiplas estruturas de URL do Workshop.
     */
    function getAppId() {
        let id = null;
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('appid')) id = urlParams.get('appid');
        if (!id) { const pathMatch = window.location.pathname.match(/\/app\/(\d+)/); if (pathMatch) id = pathMatch[1]; }
        if (!id) { const input = document.querySelector('input[name="appid"]'); if (input && input.value) id = input.value; }
        if (!id) {
            const breadcrumb = document.querySelector('.breadcrumbs a[href*="/app/"]');
            if (breadcrumb) { const bMatch = breadcrumb.href.match(/\/app\/(\d+)/); if (bMatch) id = bMatch[1]; }
        }
        // Validação de segurança: Retorna apenas se o ID for puramente numérico (Mitigação de HPP / Poluição de Rota)
        return (id && /^\d+$/.test(id)) ? id : null;
    }

    const currentAppId = getAppId();
    if (!currentAppId) return;

    // ========================================================================
    // MÓDULO 1.4: GERENCIADOR DE SONDAGEM E SUPORTE DINÂMICO (Game Probe)
    // Impede o script de realizar milhares de requisições inúteis para jogos
    // que sabidamente não possuem mods hospedados nos mirrors universais.
    // ========================================================================
    const GameSupportManager = {
        CACHE_KEY_PREFIX: 'SWDD_GameSupport_',
        CACHE_TIME_UNSUPPORTED: 7 * 24 * 60 * 60 * 1000,   // Guarda estado negativo por 7 dias
        CACHE_TIME_SUPPORTED:   30 * 24 * 60 * 60 * 1000,   // Guarda estado positivo por 30 dias
        _probePromises: {},

        getStatus(appId) {
            const parsed = CacheManager.get(this.CACHE_KEY_PREFIX + appId);
            if (parsed && Date.now() < parsed.exp) return parsed.supported;
            return null;
        },

        setStatus(appId, supported) {
            const time = supported ? this.CACHE_TIME_SUPPORTED : this.CACHE_TIME_UNSUPPORTED;
            CacheManager.set(this.CACHE_KEY_PREFIX + appId, {
                supported: supported,
                exp: Date.now() + time
            });
        },

        probe(appId, mirrors) {
            const cached = this.getStatus(appId);
            if (cached !== null) return Promise.resolve(cached);

            // Retorna a promessa ativa se o probe já estiver rodando (Evita múltiplas requisições simultâneas)
            if (this._probePromises[appId]) return this._probePromises[appId];

            const self = this;
            const probePromise = (async () => {
                let definitiveFalse = false;
                for (const mirror of mirrors) {
                    if (!mirror.gameProbe) continue;
                    try {
                        const probeUrl = mirror.gameProbe.url + (mirror.gameProbe.url.includes('?') ? '&' : '?') + '_t=' + Date.now();
                        const res = await ApiClient.fetch(probeUrl, { method: 'GET' });
                        let result;
                        try { result = mirror.gameProbe.parser(res.responseText); }
                        catch(e) { result = null; } // Parser error → inconclusivo (não marca como não suportado)

                        if (result === true) {
                            self.setStatus(appId, true);
                            delete self._probePromises[appId];
                            return true;
                        } else if (result === false) {
                            definitiveFalse = true;
                        }
                    } catch(e) {
                        // RECUPERAÇÃO DE ESTADO NEGATIVO: Se o provedor retorna HTTP 404 (Não Encontrado),
                        // podemos afirmar com segurança que o jogo não tem suporte lá, salvando recursos de rede.
                        if (e && e.status === 404) {
                            definitiveFalse = true;
                        }
                    }
                }

                if (definitiveFalse) {
                    self.setStatus(appId, false);
                    delete self._probePromises[appId];
                    return false;
                }

                // Em caso de falha de rede ou timeout (onde não há certeza conclusiva),
                // assumimos suporte temporariamente para não bloquear a funcionalidade.
                delete self._probePromises[appId];
                return true;
            })();

            this._probePromises[appId] = probePromise;
            return probePromise;
        }
    };

    /**
     * Resolve a configuração final do jogo, MESCLANDO os mirrors manuais (GAMES_CONFIG, se
     * existirem) com os mirrors universais (UNIVERSAL_MIRRORS).
     *
     * Regras de mesclagem:
     *  1. Mirrors universais são sempre buscados, mesmo quando o jogo já tem configuração
     *     manual em GAMES_CONFIG.
     *  2. Mirrors manuais SEMPRE têm prioridade: entram primeiro na lista final, e como
     *     getBestModFromMirrors() para no primeiro mirror que retornar uma versão em dia,
     *     eles são efetivamente consultados antes dos universais mesclados automaticamente.
     *  3. Se um mirror universal já foi declarado manualmente dentro de GAMES_CONFIG[appId].mirrors
     *     (mesmo "id"), a posição declarada manualmente define sua prioridade e ele NÃO é
     *     duplicado pela mesclagem automática.
     *  4. Mirrors universais cujo "id" conste em GAMES_CONFIG[appId].excludeUniversalMirrors
     *     são ignorados (o jogo fica de fora da busca naquele mirror específico).
     */
    function resolveGameConfig(appId) {
        const universalMirrors = UNIVERSAL_MIRRORS(appId);
        const explicitConfig = GAMES_CONFIG[appId];

        if (explicitConfig) {
            const manualMirrors = explicitConfig.mirrors || [];
            const manualMirrorIds = new Set(manualMirrors.map(m => m.id));
            const excludedIds = new Set(explicitConfig.excludeUniversalMirrors || []);

            // Mirrors universais que ainda não foram posicionados manualmente nem excluídos para este jogo
            const autoMergedUniversalMirrors = universalMirrors.filter(m => !manualMirrorIds.has(m.id) && !excludedIds.has(m.id));

            return {
                config: {
                    forumUrl: explicitConfig.forumUrl || null,
                    // Manuais primeiro (prioridade máxima) → universais mesclados automaticamente depois
                    mirrors: [...manualMirrors, ...autoMergedUniversalMirrors]
                },
                isDynamic: false
            };
        }

        if (universalMirrors.length === 0) return { config: null, isDynamic: true };

        const fallbackForumUrl = universalMirrors.find(m => m.requestUrl)?.requestUrl || null;
        return { config: { forumUrl: fallbackForumUrl, mirrors: universalMirrors }, isDynamic: true };
    }

    const { config: GAME, isDynamic: isGameDynamic } = resolveGameConfig(currentAppId);

    // Aborta a execução do script se não houver configurações e nem fallbacks universais.
    if (!GAME) return;

    // Para jogos dinâmicos, encerra imediatamente se o cache indicar "Não Suportado"
    if (isGameDynamic && GameSupportManager.getStatus(currentAppId) === false) return;

    // Variável global assíncrona que gerencia o fluxo de injeção dos botões na tela
    const gameSupportedPromise = isGameDynamic
        ? GameSupportManager.probe(currentAppId, GAME.mirrors)
        : Promise.resolve(true);

    let gameUnsupported = false;
    let gameSupportConfirmed = !isGameDynamic;

    if (isGameDynamic) {
        gameSupportedPromise.then(supported => {
            if (!supported) gameUnsupported = true;
            else { gameSupportConfirmed = true; runInjectors(); }
        });
    }

    const CACHE_PREFIX = `SWDD_${currentAppId}_`;
    const CACHE_TIME_STEAM_MS = 60 * 60 * 1000; // 60 Minutos para expiração dos metadados da Steam
    const STEAM_NO_DATE = 'NO_DATE';
    const STEAM_FETCH_ERROR = 'FETCH_ERROR';
    const STEAM_CACHE_KEY = `${CACHE_PREFIX}Steam`;

    // ========================================================================
    // MÓDULO 2: INTERNACIONALIZAÇÃO (I18N)
    // Dicionário de localização abstraído em strings limpas.
    // Ícones e Emojis são aplicados separadamente pelo gerador de botões.
    // ========================================================================
    const translations = {
        en: { checkingVersion: 'Checking Version...', mirrorError: 'Mirror Error', requestMod: 'Request Mod', modNotListed: 'Mod not listed. Click to request.', download: 'Download', downloadWarning: 'Download', modUpdated: 'MOD UP TO DATE', modOutdated: 'MOD OUTDATED', requestUpdate: 'Request Update', labelSteam: 'Steam:', labelCache: 'Cache Status:', cacheSteam: 'Steam:', justNow: 'just now', minAgo: 'min ago', steamError: 'Unverified', steamErrorTip: 'Steam API unreachable. Version not verified.', mirrorNoDate: 'Mirror Without Date', mirrorNoDateTip: 'Could not verify mirror version date.', clearCache: 'Clear Cache', cacheCooldown: 'Clear cache ({s}s)', idlePaused: 'Paused (Idle)', idleActive: 'Active', exactTimeWarn: 'Mirror missing time.<br>Precision uncertain.', modUnavailable: 'Mod Unavailable', modUnavailableTip: 'Not found in the mirrors', modUnavailableSubTip: 'No mirror site/forum found to submit this request', modNotListedSubTip: 'Read the site/forum rules before requesting', invalidLink: 'Invalid Link', invalidLinkTip: 'Mirror returned an invalid or unsafe link.', checkedMirrors: 'Mirrors checked:', bestAvailable: 'Best available version selected', requestUpdateTip: 'Read the site/forum rules before requesting', noForumTip: 'No mirror site/forum found to request updates for this mod.', clearCacheTip: 'Clears verification data and rechecks.' },
        pt: { checkingVersion: 'Verificando versão...', mirrorError: 'Erro no Mirror', requestMod: 'Pedir Mod', modNotListed: 'Mod não listado. Clique para pedir.', download: 'Baixar', downloadWarning: 'Baixar', modUpdated: 'MOD ATUALIZADO', modOutdated: 'MOD DESATUALIZADO', requestUpdate: 'Pedir Atualização', labelSteam: 'Steam:', labelCache: 'Status do Cache:', cacheSteam: 'Steam:', justNow: 'agora', minAgo: 'min atrás', steamError: 'Sem Verificar', steamErrorTip: 'Falha na API Steam. Versão não verificada.', mirrorNoDate: 'Mirror sem data', mirrorNoDateTip: 'Não foi possível verificar a versão do mirror.', clearCache: 'Limpar Cache', cacheCooldown: 'Limpar cache ({s}s)', idlePaused: 'Pausado (Inativo)', idleActive: 'Ativo', exactTimeWarn: 'O mirror não contém hora.<br>Precisão incerta.', modUnavailable: 'Mod Indisponível', modUnavailableTip: 'Não encontrado nos mirrors', modUnavailableSubTip: 'Nenhum site/fórum dos mirrors foi encontrado<br>para fazer este pedido', modNotListedSubTip: 'Leia as regras do site/fórum antes de pedir', invalidLink: 'Link Inválido', invalidLinkTip: 'O mirror retornou um link inválido ou inseguro.', checkedMirrors: 'Mirrors verificados:', bestAvailable: 'Melhor versão disponível selecionada', requestUpdateTip: 'Leia as regras do site/fórum antes de pedir', noForumTip: 'Nenhum site/fórum dos mirrors foi encontrado para solicitar atualizações deste mod.', clearCacheTip: 'Limpa os dados de verificação e refaz a checagem.' },
        es: { checkingVersion: 'Comprobando versión...', mirrorError: 'Error en Mirror', requestMod: 'Pedir mod', modNotListed: 'Mod no listado. Haz clic para pedirlo.', download: 'Descargar', downloadWarning: 'Descargar', modUpdated: 'MOD ACTUALIZADO', modOutdated: 'MOD DESACTUALIZADO', requestUpdate: 'Pedir actualización', labelSteam: 'Steam:', labelCache: 'Estado del caché:', cacheSteam: 'Steam:', justNow: 'ahora', minAgo: 'min atrás', steamError: 'No verificado', steamErrorTip: 'Fallo en la API de Steam. Versión no verificada.', mirrorNoDate: 'Mirror sin fecha', mirrorNoDateTip: 'No se pudo verificar la versión del mirror.', clearCache: 'Borrar caché', cacheCooldown: 'Borrar caché ({s}s)', idlePaused: 'Pausado (Inactivo)', idleActive: 'Activo', exactTimeWarn: 'Mirror sin hora.<br>Precisión incierta.', modUnavailable: 'Mod no disponible', modUnavailableTip: 'No encontrado en los mirrors', modUnavailableSubTip: 'No se encontró ningún sitio/foro de mirrors para hacer esta solicitud', modNotListedSubTip: 'Lee las reglas del sitio/foro antes de pedir', invalidLink: 'Enlace Inválido', invalidLinkTip: 'El mirror devolvió un enlace inválido o inseguro.', checkedMirrors: 'Mirrors verificados:', bestAvailable: 'Mejor versión disponible seleccionada', requestUpdateTip: 'Lee las reglas del sitio/foro antes de pedir', noForumTip: 'No se encontró ningún sitio/foro de mirrors para solicitar actualizaciones de este mod.', clearCacheTip: 'Borra los datos de verificación y vuelve a comprobar.' },
        fr: { checkingVersion: 'Vérification de la version...', mirrorError: 'Erreur Mirror', requestMod: 'Demander le mod', modNotListed: 'Mod non listé. Cliquez pour le demander.', download: 'Télécharger', downloadWarning: 'Télécharger', modUpdated: 'MOD À JOUR', modOutdated: 'MOD OBSOLÈTE', requestUpdate: 'Demander une mise à jour', labelSteam: 'Steam:', labelCache: 'État du cache:', cacheSteam: 'Steam:', justNow: 'à l\'instant', minAgo: 'min', steamError: 'Non vérifié', steamErrorTip: 'Erreur de l\'API Steam. Version non vérifiée.', mirrorNoDate: 'Mirror sans date', mirrorNoDateTip: 'Impossible de vérifier la version du mirror.', clearCache: 'Vider le cache', cacheCooldown: 'Vider ({s}s)', idlePaused: 'En pause (Inactif)', idleActive: 'Actif', exactTimeWarn: 'Heure manquante dans le mirror.<br>Précision incertaine.', modUnavailable: 'Mod indisponible', modUnavailableTip: 'Introuvable dans les mirrors', modUnavailableSubTip: 'Aucun site/forum de mirrors trouvé pour faire cette demande', modNotListedSubTip: 'Lisez les règles du site/forum avant de faire une demande', invalidLink: 'Lien invalide', invalidLinkTip: 'Le mirror a renvoyé un lien invalide ou non sécurisé.', checkedMirrors: 'Mirrors vérifiés:', bestAvailable: 'Meilleure version disponible sélectionnée', requestUpdateTip: 'Lisez les règles du site/forum avant de faire une demande', noForumTip: "Aucun site/forum de mirrors trouvé pour demander des mises à jour de ce mod.", clearCacheTip: 'Efface les données de vérification et relance la vérification.' },
        de: { checkingVersion: 'Version wird geprüft...', mirrorError: 'Mirror-Fehler', requestMod: 'Mod anfragen', modNotListed: 'Mod nicht gelistet. Zum Anfragen klicken.', download: 'Herunterladen', downloadWarning: 'Herunterladen', modUpdated: 'MOD AKTUELL', modOutdated: 'MOD VERALTET', requestUpdate: 'Update anfragen', labelSteam: 'Steam:', labelCache: 'Cache-Status:', cacheSteam: 'Steam:', justNow: 'gerade eben', minAgo: 'Min. her', steamError: 'Nicht verifiziert', steamErrorTip: 'Steam API nicht erreichbar. Version nicht verifiziert.', mirrorNoDate: 'Mirror ohne Datum', mirrorNoDateTip: 'Mirror-Version konnte nicht verifiziert werden.', clearCache: 'Cache leeren', cacheCooldown: 'Cache leeren ({s}s)', idlePaused: 'Pausiert (Inaktiv)', idleActive: 'Aktiv', exactTimeWarn: 'Mirror ohne Uhrzeit.<br>Präzision ungewiss.', modUnavailable: 'Mod nicht verfügbar', modUnavailableTip: 'Nicht in den Mirrors gefunden', modUnavailableSubTip: 'Keine Mirror-Seite/Forum gefunden, um diese Anfrage zu stellen', modNotListedSubTip: 'Lies die Regeln der Seite/des Forums, bevor du eine Anfrage stellst', invalidLink: 'Ungültiger Link', invalidLinkTip: 'Der Mirror hat einen ungültigen oder unsicheren Link zurückgegeben.', checkedMirrors: 'Überprüfte Mirrors:', bestAvailable: 'Beste verfügbare Version ausgewählt', requestUpdateTip: 'Lies die Regeln der Seite/des Forums, bevor du eine Anfrage stellst', noForumTip: 'Keine Mirror-Seite/Forum gefunden, um Updates für diesen Mod anzufragen.', clearCacheTip: 'Löscht die Überprüfungsdaten und prüft erneut.' },
        it: { checkingVersion: 'Controllo versione...', mirrorError: 'Errore Mirror', requestMod: 'Richiedi mod', modNotListed: 'Mod non presente. Clicca per richiederla.', download: 'Scarica', downloadWarning: 'Scarica', modUpdated: 'MOD AGGIORNATA', modOutdated: 'MOD NON AGGIORNATA', requestUpdate: 'Richiedi aggiornamento', labelSteam: 'Steam:', labelCache: 'Stato cache:', cacheSteam: 'Steam:', justNow: 'adesso', minAgo: 'min fa', steamError: 'Non verificato', steamErrorTip: 'API Steam non raggiungibile. Versione non verificata.', mirrorNoDate: 'Mirror senza data', mirrorNoDateTip: 'Impossibile verificare la versione del mirror.', clearCache: 'Svuota cache', cacheCooldown: 'Svuota cache ({s}s)', idlePaused: 'In pausa (Inattivo)', idleActive: 'Attivo', exactTimeWarn: 'Mirror senza ora.<br>Precisione incerta.', modUnavailable: 'Mod non disponibile', modUnavailableTip: 'Non trovato nei mirror', modUnavailableSubTip: 'Nessun sito/forum di mirror trovato per effettuare questa richiesta', modNotListedSubTip: 'Leggi le regole del sito/forum prima di richiedere', invalidLink: 'Link non valido', invalidLinkTip: 'Il mirror ha restituito un link non valido o non sicuro.', checkedMirrors: 'Mirrors controllati:', bestAvailable: 'Migliore versione disponibile selezionata', requestUpdateTip: 'Leggi le regole del sito/forum prima di richiedere', noForumTip: 'Nessun sito/forum di mirror trovato per richiedere aggiornamenti di questa mod.', clearCacheTip: 'Cancella i dati di verifica e ricontrolla.' },
        nl: { checkingVersion: 'Versie controleren...', mirrorError: 'Mirrorfout', requestMod: 'Mod aanvragen', modNotListed: 'Mod staat niet in de lijst. Klik om aan te vragen.', download: 'Downloaden', downloadWarning: 'Downloaden', modUpdated: 'MOD IS UP-TO-DATE', modOutdated: 'MOD IS VEROUDERD', requestUpdate: 'Update aanvragen', labelSteam: 'Steam:', labelCache: 'Cache-status:', cacheSteam: 'Steam:', justNow: 'zojuist', minAgo: 'min geleden', steamError: 'Ongecontroleerd', steamErrorTip: 'Steam API onbereikbaar. Versie niet gecontroleerd.', mirrorNoDate: 'Mirror zonder datum', mirrorNoDateTip: 'Kon de mirrorversie niet verifiëren.', clearCache: 'Cache wissen', cacheCooldown: 'Cache wissen ({s}s)', idlePaused: 'Gepauzeerd (Inactief)', idleActive: 'Actief', exactTimeWarn: 'Mirror mist tijd.<br>Precisie onzeker.', modUnavailable: 'Mod niet beschikbaar', modUnavailableTip: 'Niet gevonden in de mirrors', modUnavailableSubTip: 'Geen mirror-site/forum gevonden om deze aanvraag te doen', modNotListedSubTip: 'Lees de regels van de site/het forum voordat je een aanvraag doet', invalidLink: 'Ongeldige link', invalidLinkTip: 'De mirror gaf een ongeldige of onveilige link terug.', checkedMirrors: 'Gecontroleerde mirrors:', bestAvailable: 'Beste beschikbare versie geselecteerd', requestUpdateTip: 'Lees de regels van de site/het forum voordat je een aanvraag doet', noForumTip: 'Geen mirror-site/forum gevonden om updates voor deze mod aan te vragen.', clearCacheTip: 'Wist de verificatiegegevens en controleert opnieuw.' },
        pl: { checkingVersion: 'Sprawdzanie wersji...', mirrorError: 'Błąd Mirrora', requestMod: 'Poproś o mod', modNotListed: 'Mod nie jest na liście. Kliknij, aby poprosić.', download: 'Pobierz', downloadWarning: 'Pobierz', modUpdated: 'MOD AKTUALNY', modOutdated: 'MOD NIEAKTUALNY', requestUpdate: 'Poproś o aktualizację', labelSteam: 'Steam:', labelCache: 'Stan pamięci podręcznej:', cacheSteam: 'Steam:', justNow: 'właśnie teraz', minAgo: 'min temu', steamError: 'Niezweryfikowane', steamErrorTip: 'API Steam niedostępne. Wersja niezweryfikowana.', mirrorNoDate: 'Mirror bez daty', mirrorNoDateTip: 'Nie można zweryfikować wersji mirrora.', clearCache: 'Wyczyść pamięć', cacheCooldown: 'Wyczyść pamięć ({s}s)', idlePaused: 'Wstrzymano (Bezczynny)', idleActive: 'Aktywny', exactTimeWarn: 'Brak godziny w mirrorze.<br>Precyzja niepewna.', modUnavailable: 'Mod niedostępny', modUnavailableTip: 'Nie znaleziono w mirrorach', modUnavailableSubTip: 'Nie znaleziono strony/forum mirrora do złożenia tej prośby', modNotListedSubTip: 'Przeczytaj zasady strony/forum przed złożeniem prośby', invalidLink: 'Nieprawidłowy link', invalidLinkTip: 'Mirror zwrócił nieprawidłowy lub niebezpieczny link.', checkedMirrors: 'Sprawdzone mirrory:', bestAvailable: 'Wybrano najlepszą dostępną wersję', requestUpdateTip: 'Przeczytaj zasady strony/forum przed złożeniem prośby', noForumTip: 'Nie znaleziono strony/forum mirrora do proszenia o aktualizacje tego moda.', clearCacheTip: 'Czyści dane weryfikacji i sprawdza ponownie.' },
        ru: { checkingVersion: 'Проверка версии...', mirrorError: 'Ошибка зеркала', requestMod: 'Запросить мод', modNotListed: 'Мода нет в списке. Нажмите, чтобы запросить.', download: 'Скачать', downloadWarning: 'Скачать', modUpdated: 'МОД АКТУАЛЕН', modOutdated: 'МОД УСТАРЕЛ', requestUpdate: 'Запросить обновление', labelSteam: 'Steam:', labelCache: 'Статус кэша:', cacheSteam: 'Steam:', justNow: 'только что', minAgo: 'мин назад', steamError: 'Не проверено', steamErrorTip: 'API Steam недоступен. Версия не проверена.', mirrorNoDate: 'Зеркало без даты', mirrorNoDateTip: 'Не удалось проверить версию зеркала.', clearCache: 'Очистить кэш', cacheCooldown: 'Очистить кэш ({s}s)', idlePaused: 'Пауза (Бездействие)', idleActive: 'Активно', exactTimeWarn: 'На зеркале нет времени.<br>Точность не гарантируется.', modUnavailable: 'Мод недоступен', modUnavailableTip: 'Не найдено на зеркалах', modUnavailableSubTip: 'Сайт/форум зеркала для этого запроса не найден', modNotListedSubTip: 'Прочитайте правила сайта/форума перед запросом', invalidLink: 'Неверная ссылка', invalidLinkTip: 'Зеркало вернуло неверную или небезопасную ссылку.', checkedMirrors: 'Проверенные зеркала:', bestAvailable: 'Выбрана лучшая доступная версия', requestUpdateTip: 'Прочитайте правила сайта/форума перед запросом', noForumTip: 'Не найден сайт/форум зеркала для запроса обновлений этого мода.', clearCacheTip: 'Очищает данные проверки и выполняет проверку заново.' },
        tr: { checkingVersion: 'Sürüm kontrol ediliyor...', mirrorError: 'Mirror hatası', requestMod: 'Mod iste', modNotListed: 'Mod listede yok. İstemek için tıkla.', download: 'İndir', downloadWarning: 'İndir', modUpdated: 'MOD GÜNCEL', modOutdated: 'MOD ESKİ', requestUpdate: 'Güncelleme iste', labelSteam: 'Steam:', labelCache: 'Önbellek Durumu:', cacheSteam: 'Steam:', justNow: 'şimdi', minAgo: 'dk önce', steamError: 'Doğrulanmadı', steamErrorTip: 'Steam API\'sine ulaşılamıyor. Sürüm doğrulanmadı.', mirrorNoDate: 'Tarihsiz Mirror', mirrorNoDateTip: 'Mirror sürümü doğrulanamadı.', clearCache: 'Önbelleği Temizle', cacheCooldown: 'Önbelleği temizle ({s}s)', idlePaused: 'Duraklatıldı (Boşta)', idleActive: 'Aktif', exactTimeWarn: 'Mirror\'da saat yok.<br>Kesinlik belirsiz.', modUnavailable: 'Mod mevcut değil', modUnavailableTip: 'Mirror\'larda bulunamadı', modUnavailableSubTip: 'Bu isteği yapmak için mirror sitesi/forumu bulunamadı', modNotListedSubTip: 'İstemeden önce site/forum kurallarını okuyun', invalidLink: 'Geçersiz Bağlantı', invalidLinkTip: 'Mirror geçersiz veya güvensiz bir bağlantı döndürdü.', checkedMirrors: 'Kontrol edilen mirror\'lar:', bestAvailable: 'Mevcut en iyi sürüm seçildi', requestUpdateTip: 'İstemeden önce site/forum kurallarını okuyun', noForumTip: 'Bu mod için güncelleme istemek üzere mirror sitesi/forumu bulunamadı.', clearCacheTip: 'Doğrulama verilerini temizler ve yeniden kontrol eder.' },
        zh: { checkingVersion: '正在检查版本...', mirrorError: '镜像错误', requestMod: '请求 Mod', modNotListed: 'Mod 未收录。点击请求。', download: '下载', downloadWarning: '下载', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已过期', requestUpdate: '请求更新', labelSteam: 'Steam:', labelCache: '缓存状态:', cacheSteam: 'Steam:', justNow: '刚刚', minAgo: '分钟前', steamError: '未验证', steamErrorTip: 'Steam API 无法访问。版本未验证。', mirrorNoDate: '镜像无日期', mirrorNoDateTip: '无法验证镜像版本。', clearCache: '清除缓存', cacheCooldown: '清除缓存 ({s}s)', idlePaused: '已暂停（空闲）', idleActive: '活跃', exactTimeWarn: '镜像缺少时间。<br>精度不确定。', modUnavailable: '模组不可用', modUnavailableTip: '镜像中未找到', modUnavailableSubTip: '未找到可用于提交此请求的镜像网站/论坛', modNotListedSubTip: '请求前请阅读网站/论坛规则', invalidLink: '链接无效', invalidLinkTip: '镜像返回了无效或不安全的链接。', checkedMirrors: '已检查的镜像:', bestAvailable: '已选择最佳可用版本', requestUpdateTip: '请求前请阅读网站/论坛规则', noForumTip: '未找到可用于请求此模组更新的镜像网站/论坛。', clearCacheTip: '清除验证数据并重新检查。' },
        zh_tw: { checkingVersion: '正在檢查版本...', mirrorError: '鏡像錯誤', requestMod: '請求 Mod', modNotListed: 'Mod 未收錄。點擊請求。', download: '下載', downloadWarning: '下載', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已過期', requestUpdate: '請求更新', labelSteam: 'Steam:', labelCache: '快取狀態:', cacheSteam: 'Steam:', justNow: '剛剛', minAgo: '分鐘前', steamError: '未驗證', steamErrorTip: 'Steam API 無法訪問。版本未驗證。', mirrorNoDate: '鏡像無日期', mirrorNoDateTip: '無法驗證鏡像版本。', clearCache: '清除快取', cacheCooldown: '清除快取 ({s}s)', idlePaused: '已暫停（閒置）', idleActive: '活躍', exactTimeWarn: '鏡像缺少時間。<br>精度不確定。', modUnavailable: '模組不可用', modUnavailableTip: '鏡像中未找到', modUnavailableSubTip: '未找到可用於提交此請求的鏡像網站/論壇', modNotListedSubTip: '請求前請閱讀網站/論壇規則', invalidLink: '連結無效', invalidLinkTip: '鏡像返回了無效或不安全的連結。', checkedMirrors: '已檢查的鏡像:', bestAvailable: '已選擇最佳可用版本', requestUpdateTip: '請求前請閱讀網站/論壇規則', noForumTip: '未找到可用於請求此模組更新的鏡像網站/論壇。', clearCacheTip: '清除驗證資料並重新檢查。' },
        ja: { checkingVersion: 'バージョン確認中...', mirrorError: 'ミラーエラー', requestMod: 'Modをリクエスト', modNotListed: 'Modが未登録です。クリックしてリクエスト。', download: 'ダウンロード', downloadWarning: 'ダウンロード', modUpdated: 'MODは最新です', modOutdated: 'MODは古いです', requestUpdate: '更新をリクエスト', labelSteam: 'Steam:', labelCache: 'キャッシュ状態:', cacheSteam: 'Steam:', justNow: 'たった今', minAgo: '分前', steamError: '未検証', steamErrorTip: 'Steam APIにアクセスできません。バージョン未検証。', mirrorNoDate: '日付のないミラー', mirrorNoDateTip: 'ミラーのバージョンを確認できませんでした。', clearCache: 'キャッシュを消去', cacheCooldown: 'キャッシュ消去 ({s}s)', idlePaused: '一時停止（アイドル）', idleActive: 'アクティブ', exactTimeWarn: 'ミラーに時間がありません。<br>精度は不確実です。', modUnavailable: 'Mod利用不可', modUnavailableTip: 'ミラーに見つかりません', modUnavailableSubTip: 'このリクエストを送信できるミラーのサイト/フォーラムが見つかりません', modNotListedSubTip: 'リクエストする前にサイト/フォーラムのルールをお読みください', invalidLink: '無効なリンク', invalidLinkTip: 'ミラーが無効または安全でないリンクを返しました。', checkedMirrors: '確認したミラー:', bestAvailable: '利用可能な最適なバージョンを選択しました', requestUpdateTip: 'リクエストする前にサイト/フォーラムのルールをお読みください', noForumTip: 'このMODの更新をリクエストできるミラーのサイト/フォーラムが見つかりません。', clearCacheTip: '検証データを消去して再チェックします。' },
        ko: { checkingVersion: '버전 확인 중...', mirrorError: '미러 오류', requestMod: '모드 요청', modNotListed: '모드가 목록에 없습니다. 클릭해서 요청하세요.', download: '다운로드', downloadWarning: '다운로드', modUpdated: 'MOD 최신 상태', modOutdated: 'MOD 오래됨', requestUpdate: '업데이트 요청', labelSteam: 'Steam:', labelCache: '캐시 상태:', cacheSteam: 'Steam:', justNow: '방금', minAgo: '분 전', steamError: '확인 안 됨', steamErrorTip: 'Steam API에 접근할 수 없습니다. 버전이 확인되지 않았습니다.', mirrorNoDate: '날짜 없는 미러', mirrorNoDateTip: '미러 버전을 확인할 수 없습니다.', clearCache: '캐시 지우기', cacheCooldown: '캐시 지우기 ({s}s)', idlePaused: '일시 정지 (유휴)', idleActive: '활성', exactTimeWarn: '미러에 시간이 없습니다.<br>정확도 불확실.', modUnavailable: '모드 사용 불가', modUnavailableTip: '미러에서 찾을 수 없습니다', modUnavailableSubTip: '이 요청을 보낼 미러 사이트/포럼을 찾을 수 없습니다', modNotListedSubTip: '요청하기 전에 사이트/포럼 규칙을 읽어주세요', invalidLink: '잘못된 링크', invalidLinkTip: '미러가 유효하지 않거나 안전하지 않은 링크를 반환했습니다.', checkedMirrors: '확인된 미러:', bestAvailable: '가장 적합한 버전을 선택했습니다', requestUpdateTip: '요청하기 전에 사이트/포럼 규칙을 읽어주세요', noForumTip: '이 모드의 업데이트를 요청할 미러 사이트/포럼을 찾을 수 없습니다.', clearCacheTip: '확인 데이터를 지우고 다시 확인합니다.' }
    };

    const languageAliases = {
        'pt-br': 'pt', 'pt-pt': 'pt', 'es-es': 'es', 'es-419': 'es',
        'fr-fr': 'fr', 'de-de': 'de', 'it-it': 'it', 'nl-nl': 'nl',
        'pl-pl': 'pl', 'ru-ru': 'ru', 'tr-tr': 'tr',
        'zh-cn': 'zh', 'zh-sg': 'zh', 'zh-hans': 'zh',
        'zh-tw': 'zh_tw', 'zh-hk': 'zh_tw', 'zh-hant': 'zh_tw',
        'ja-jp': 'ja', 'ko-kr': 'ko',
    };

    // Mapa dos códigos internos de idioma usados pela Steam no parâmetro "?l=" da URL.
    // A Steam troca o idioma da página via fetch interno (sem navegação real e sem
    // atualizar o atributo lang da <html>), então o parâmetro da URL é a fonte de
    // verdade mais confiável para detectar o idioma realmente exibido na página.
    const steamUrlLangMap = {
        english: 'en', portuguese: 'pt', brazilian: 'pt',
        spanish: 'es', latam: 'es',
        french: 'fr', german: 'de', italian: 'it', dutch: 'nl',
        polish: 'pl', russian: 'ru', turkish: 'tr',
        schinese: 'zh', tchinese: 'zh_tw',
        japanese: 'ja', koreana: 'ko',
    };

    function getUrlLang() {
        try {
            const l = new URLSearchParams(window.location.search).get('l');
            if (l) return steamUrlLangMap[l.toLowerCase()] || null;
        } catch (e) { /* URL inválida ou indisponível: ignora e cai no fallback */ }
        return null;
    }

    function getScriptLanguage() {
        const urlLang = getUrlLang();
        if (urlLang) return urlLang;
        const rawLang = (document.documentElement.lang || document.querySelector('html')?.getAttribute('lang') || navigator.language || 'en').toLowerCase();
        const normalized = rawLang.replace('_', '-');
        if (translations[normalized]) return normalized;
        if (languageAliases[normalized]) return languageAliases[normalized];
        const baseLang = normalized.split('-')[0];
        return translations[baseLang] ? baseLang : 'en';
    }

    let t = translations[getScriptLanguage()];

    // ========================================================================
    // MÓDULO 2.1: TROCA DINÂMICA DE IDIOMA (Hot Language Switching)
    // A Steam pode alterar o idioma da página via navegação interna (SPA/AJAX)
    // sem recarregar o documento. Este módulo observa o atributo "lang" do <html>
    // (e o evento nativo "languagechange") e, ao detectar uma mudança real,
    // atualiza o dicionário ativo e re-renderiza todos os widgets visíveis,
    // sem exigir um F5 por parte do usuário.
    // ========================================================================
    function applyLanguageChange() {
        const newLang = getScriptLanguage();
        const newDict = translations[newLang];
        if (!newDict || newDict === t) return; // Nenhuma mudança real de idioma suportado

        t = newDict;

        // Fecha menus e tooltips abertos: seu HTML já foi renderizado com o idioma antigo
        if (dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
        }
        if (tooltipGlobal.classList.contains('show')) {
            clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal);
        }

        // Re-renderiza todos os widgets ativos na tela com os textos do novo idioma
        for (const container of activeWidgets) {
            if (!document.documentElement.contains(container)) { activeWidgets.delete(container); continue; }
            if (container.dataset.modid) renderWidget(container, container.dataset.modid, container.dataset.iscard === 'true');
        }
    }

    let lastDetectedHtmlLang = document.documentElement.lang;
    const languageObserver = new MutationObserver(() => {
        if (document.documentElement.lang !== lastDetectedHtmlLang) {
            lastDetectedHtmlLang = document.documentElement.lang;
            applyLanguageChange();
        }
    });
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    // Cobre também o caso de preferência de idioma do navegador mudar em tempo real
    window.addEventListener('languagechange', applyLanguageChange);

    // A troca de idioma da Steam (ex.: clicar em "Idioma > English") não navega a
    // página de verdade nem atualiza o atributo lang da <html>: ela busca o HTML
    // novo internamente e só troca o conteúdo + a URL (via History API). Por isso
    // observamos diretamente mudanças na URL, que é o sinal real dessa troca.
    let lastDetectedUrl = window.location.href;
    function checkUrlLanguageChange() {
        if (window.location.href !== lastDetectedUrl) {
            lastDetectedUrl = window.location.href;
            applyLanguageChange();
        }
    }
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            checkUrlLanguageChange();
            return result;
        };
    }
    window.addEventListener('popstate', checkUrlLanguageChange);
    // Rede de segurança: caso a Steam altere a URL por algum outro meio não coberto
    // acima, uma checagem leve periódica garante que a troca não passe despercebida.
    setInterval(checkUrlLanguageChange, 1500);

    // ========================================================================
    // MÓDULO 3: TEMPLATE ENGINE (Criação de Interface e Estilização)
    // Separa a construção do HTML (Apresentação) da Lógica de Negócio (Regras).
    // Evita injeção direta de strings não higienizadas (Proteção contra XSS).
    // Botão: createModularButton(isCard, btnConfig) | Tooltip: createTooltip(config)
    // ========================================================================
    const TemplateEngine = {
        // Dicionário Central de Temas: muda a cor/classe aqui e ela reflete no script inteiro
        // (botão principal, bolinhas de status dos mirrors verificados, "melhor versão", etc).
        THEMES: {
            success: { color: '#A3E33B', stateClass: 'swdd-state-success' },
            warning: { color: '#F59E0B', stateClass: 'swdd-state-warning' },
            error:   { color: '#ff6b6b', stateClass: 'swdd-state-error' }
        },

        formatCacheAge(ms) {
            if (!ms || ms < 0 || isNaN(ms)) ms = 0;
            const minutes = Math.floor(ms / 60000);
            if (minutes < 1) return t.justNow;
            return `${minutes} ${t.minAgo}`;
        },
        formatTimeLeft(expTimestamp) {
            if (!expTimestamp) return "0s";
            const left = expTimestamp - Date.now();
            if (left <= 0) return "0s";
            const m = Math.floor(left / 60000);
            const s = Math.floor((left % 60000) / 1000);
            return `${m}m ${s}s`;
        },
        createLoadingBtn(isCard) {
            const cClass = isCard ? 'swdd-custom-btn-compact' : '';
            return `<a class="swdd-custom-btn ${cClass} swdd-state-loading"><span class="swdd-btn-icon">⏳</span> <span class="swdd-btn-text">${escapeHTML(t.checkingVersion)}</span></a>`;
        },

        /**
         * GERAÇÃO DO BOTÃO MODULAR
         * Constrói dinamicamente a estrutura visual do botão suportando ícones, timers,
         * desativação nativa e menus suspensos com base nas configurações passadas.
         *
         * @param {boolean} isCard - Define se o botão está no modo compacto (card)
         * @param {object} config - Objeto contendo o Schema de renderização
         */
        createModularButton(isCard, config) {
            /**
             * config esperado:
             * {
             * text: string,           // Texto principal
             * icon: string,           // Emoji ou ícone a ser renderizado antes do texto
             * link: string|null,      // URL de destino
             * stateClass: string,     // 'swdd-state-success', 'swdd-state-warning', etc
             * disabled: boolean,      // Define se o botão principal é clicável
             * timerExp: number,       // Timestamp (Date.now() + ms) para bloqueio temporário
             * tooltip: string,        // Dica exibida no painel escuro customizado ou nativo
             * dropdown: Array         // Lista de ações no menu suspenso
             * }
             */
            const cClass = isCard ? 'swdd-custom-btn-compact' : '';
            const isBlocked = config.disabled || (config.timerExp && config.timerExp > Date.now());

            // Se bloqueado, omitimos o href para impedir o clique nativamente (sem precisar de preventDefault)
            const hrefAttr = (config.link && !isBlocked) ? `href="${escapeHTML(config.link)}" rel="noopener noreferrer"` : '';
            const origLinkData = config.link ? `data-orig-link="${escapeHTML(config.link)}"` : '';

            // Estilização inline para botões bloqueados.
            // Exceção: o estado de erro (ex: "Mod Indisponível") deve permanecer sempre vermelho e vívido,
            // sem o efeito de escurecimento (grayscale/opacity) aplicado aos demais estados bloqueados.
            const isErrorState = config.stateClass === 'swdd-state-error';
            const blockStyle = isBlocked ? (isErrorState ? 'cursor: not-allowed;' : 'cursor: not-allowed; filter: grayscale(100%) opacity(0.6);') : '';

            // Metadados para o sistema de Timer e texto original
            const timerData = config.timerExp ? `data-timer-exp="${config.timerExp}"` : '';
            const originalTextData = config.text ? `data-orig-text="${escapeHTML(config.text)}"` : '';
            const iconHtml = config.icon ? `<span class="swdd-btn-icon">${escapeHTML(config.icon)}</span> ` : '';

            // Tooltip via atributo nativo title
            const titleAttr = config.tooltip ? `title="${escapeHTML(config.tooltip)}"` : '';

            let html = `
                <div class="swdd-btn-group" ${titleAttr}>
                    <a ${hrefAttr} ${origLinkData} class="swdd-custom-btn ${cClass} ${config.stateClass} swdd-btn-main" style="${blockStyle}" ${timerData} ${originalTextData}>
                        ${iconHtml}<span class="swdd-btn-text">${escapeHTML(config.text)}</span>
                    </a>`;

            // Renderiza a "Seta" do menu suspenso se houverem itens válidos
            if (config.dropdown && config.dropdown.length > 0) {
                // Filtra apenas itens que atendam as condições dinâmicas estipuladas
                const validItems = config.dropdown.filter(item => item.condition !== false);
                if (validItems.length > 0) {
                    // Armazena a estrutura do menu no DOM (data-attribute) para ser lida quando clicado
                    const dropdownData = escapeHTML(JSON.stringify(validItems));
                    html += `<button class="swdd-custom-btn ${cClass} ${config.stateClass} swdd-btn-arrow" data-dropdown-items="${dropdownData}">▼</button>`;
                }
            }

            html += `</div>`;
            return html;
        },

        createTooltipGrid(showSteam, strSteam, showMirror, mirrorName, strMirror, exactTimeWarnHtml, infoLabel = null, infoValue = null) {
            let gridHtml = `<div style="display: grid; grid-template-columns: max-content 1fr; column-gap: 8px; row-gap: 4px; margin: 6px 0;">`;
            if (showSteam) {
                gridHtml += `<span class="swdd-tooltip-label" style="margin:0; min-width:auto;">${escapeHTML(t.labelSteam)}</span><span class="swdd-tooltip-value">${escapeHTML(strSteam)}</span>`;
            }
            if (showMirror) {
                gridHtml += `<span class="swdd-tooltip-label" style="margin:0; min-width:auto;">${escapeHTML(mirrorName)}:</span><span class="swdd-tooltip-value">${escapeHTML(strMirror)}</span>`;
            }
            if (infoLabel && infoValue) {
                gridHtml += `<span class="swdd-tooltip-label" style="margin:0; min-width:auto;">${escapeHTML(infoLabel)}</span><span class="swdd-tooltip-value">${escapeHTML(infoValue)}</span>`;
            }
            gridHtml += `</div>`;
            return gridHtml + exactTimeWarnHtml;
        },

        createMirrorCheckNotice(consultedMirrors, showBestAvailable = true, needsTopSeparator = true) {
            // Se nenhum mirror foi consultado, não exibe nada
            if (!consultedMirrors || consultedMirrors.length === 0) return '';

            // Cada mirror consultado vira um "chip" inline (bolinha + nome) que flui na
            // horizontal e quebra de linha sozinho (flex-wrap) quando não couber mais na
            // largura atual da caixa, em vez de empilhar um mirror por linha. A bolinha
            // reflete o status individual DAQUELE mirror (atualizado, desatualizado ou
            // indisponível/erro), puxando a cor diretamente do Dicionário Central de Temas (THEMES) acima.
            const mirrorNamesListHtml = consultedMirrors
                .map(mirror => {
                    // Pega o tema do mirror consultado (ou cai no tema de erro por padrão, caso ausente)
                    const themeObj = this.THEMES[mirror.theme] || this.THEMES.error;
                    const dotColor = themeObj.color;
                    const dotHtml = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${dotColor}; margin-left: 6px; box-shadow: 0 0 3px ${dotColor}60;"></span>`;
                    // Quando o mirror falhou ao responder (Mirror Error), a cor da bolinha sozinha
                    // passa despercebida. Reforça com o mesmo ícone de aviso já usado no bloco de
                    // Status do Cache (⚠️), deixando o erro óbvio também aqui em "Mirrors verificados".
                    const errorIconHtml = mirror.error
                        ? `<span style="margin-left: 4px; font-size: 10px;" title="${escapeHTML(t.mirrorError)}">⚠️</span>`
                        : '';
                    return `<span style="display: inline-flex; align-items: center; font-size: 11.5px; color: #E2E8F0; font-weight: 500; white-space: nowrap;">${escapeHTML(mirror.name)}${errorIconHtml}${dotHtml}</span>`;
                })
                .join('');

            // Fallbacks de texto caso o usuário não tenha atualizado todas as linguagens no Módulo 2
            const txtChecked = t.checkedMirrors || 'Mirrors verificados:';

            // "Melhor versão selecionada" só faz sentido quando uma versão FOI de fato
            // encontrada/selecionada entre os mirrors. No cenário de mod não encontrado
            // (showBestAvailable: false) essa linha seria contraditória com o título
            // "Não encontrado no mirror" logo acima. Além disso, só exibimos quando mais
            // de 1 mirror foi verificado — com apenas 1 mirror não há de fato uma
            // "seleção" relevante entre opções a se comunicar ao usuário.
            let bestAvailableHtml = '';
            if (showBestAvailable && consultedMirrors.length > 1) {
                const txtBest = t.bestAvailable || 'Melhor versão disponível selecionada';
                // Cor verde puxada diretamente do Dicionário Central de Temas, em vez de fixa no CSS
                const successColor = this.THEMES.success.color;
                bestAvailableHtml = `
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 11.5px; color: ${successColor};">
                    <span style="font-size: 12px;">✨</span>
                    <span style="font-weight: 500;">${escapeHTML(txtBest)}</span>
                </div>`;
            }

            // Quando vem logo após o título (sem bodyHtml no meio, ex: "Mod não listado" /
            // "Mod Indisponível"), a própria borda inferior do título (.swdd-tooltip-title)
            // já serve de separador — adicionar outra aqui geraria duas linhas bem próximas
            // uma da outra. Só desenhamos a borda quando há conteúdo (bodyHtml) antes dela.
            const separatorStyle = needsTopSeparator
                ? 'margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;'
                : 'margin-top: 0;';

            return `
            <div class="swdd-tooltip-row" style="${separatorStyle}">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 11.5px; color: #8f98a0;">
                    <span style="font-size: 10px;">🔍</span>
                    <span>${escapeHTML(txtChecked)}</span>
                </div>
                <div style="display: flex; flex-direction: row; flex-wrap: wrap; row-gap: 5px; column-gap: 14px; margin-left: 16px;">
                    ${mirrorNamesListHtml}
                </div>${bestAvailableHtml}
            </div>`;
        },

        createCacheBlock(creationTimeSteam, steamCacheExp, consultedMirrors) {
            if (!showCacheInfo) return '';

            const strSteamCache  = this.formatCacheAge(Date.now() - creationTimeSteam);
            const strSteamReset  = this.formatTimeLeft(steamCacheExp);

            let mirrorCacheRowsHtml = '';
            for (const cmirror of consultedMirrors) {
                if (cmirror.error) {
                    mirrorCacheRowsHtml += `<span class="swdd-tooltip-value" style="font-size:11px; color:#ff6b6b;">${escapeHTML(cmirror.name)}: ⚠️ ${escapeHTML(t.mirrorError)}</span>`;
                } else {
                    const strMirrorCache = this.formatCacheAge(Date.now() - cmirror.creation);
                    const strMirrorReset = this.formatTimeLeft(cmirror.exp);
                    mirrorCacheRowsHtml += `<span class="swdd-tooltip-value" style="font-size:11px; color:#8f98a0;">${escapeHTML(cmirror.name)}: <span class="swdd-cache-age" data-created="${cmirror.creation}">${escapeHTML(strMirrorCache)}</span> (🔄 <span class="swdd-cache-countdown" data-exp="${cmirror.exp}">${escapeHTML(strMirrorReset)}</span>)</span>`;
                }
            }

            return `
            <div class="swdd-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <span>${escapeHTML(t.labelCache)}</span><span class="swdd-idle-status" style="font-size:11px; font-weight:normal;"></span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px;">
                    <span class="swdd-tooltip-value" style="font-size:11px; color:#8f98a0;">${escapeHTML(t.cacheSteam)} <span class="swdd-cache-age" data-created="${creationTimeSteam}">${escapeHTML(strSteamCache)}</span> (🔄 <span class="swdd-cache-countdown" data-exp="${steamCacheExp}">${escapeHTML(strSteamReset)}</span>)</span>
                    ${mirrorCacheRowsHtml}
                </div>
            </div>`;
        },

        /**
         * GERAÇÃO MODULAR DO TOOLTIP
         * Centraliza a montagem do tooltip em UM único lugar, nos mesmos moldes do
         * createModularButton. "Mirrors verificados" (createMirrorCheckNotice) e o bloco
         * de cache (createCacheBlock) são incluídos por padrão em TODO estado — quem
         * quiser omitir precisa desligar explicitamente (showMirrorCheck:false /
         * showCache:false), em vez de cada branch da renderização precisar "lembrar"
         * de colar esses blocos manualmente na string.
         *
         * @param {object} config - Objeto contendo o Schema de renderização
         */
        createTooltip(config) {
            /**
             * config esperado:
             * {
             * stateClass: string,        // 'success' | 'warning' | 'error' (sufixo de swdd-tooltip-*)
             * icon: string,              // Emoji exibido no título
             * titleText: string,         // Texto do título (já traduzido)
             * bodyHtml: string,          // HTML específico do estado (grid, aviso, etc). Opcional.
             * consultedMirrors: Array,   // Mirrors consultados nesta checagem
             * creationTimeSteam: number, // Timestamp de criação do cache Steam
             * steamCacheExp: number,     // Timestamp de expiração do cache Steam
             * showMirrorCheck: boolean,  // Exibe "Mirrors verificados". Default: true
             * showCache: boolean         // Exibe o bloco "Status do Cache". Default: true
             * showBestAvailable: boolean // Exibe "Melhor versão disponível selecionada" dentro
             *                             // do bloco de mirrors verificados. Default: true.
             *                             // Usar false quando NADA foi encontrado/selecionado
             *                             // (senão a frase contradiz o título de erro).
             * }
             */
            const titleHtml = `<div class="swdd-tooltip-title swdd-tooltip-${config.stateClass}"><span>${config.icon}</span> ${escapeHTML(config.titleText)}</div>`;
            const bodyHtml = config.bodyHtml || '';

            // Defaults true: omitir exige opt-out explícito, não opt-in que pode ser esquecido.
            // needsTopSeparator: só desenha a borda separadora se houver bodyHtml antes —
            // caso contrário a borda do título (logo acima) já cumpre esse papel.
            const mirrorCheckHtml = (config.showMirrorCheck !== false) ? this.createMirrorCheckNotice(config.consultedMirrors, config.showBestAvailable !== false, !!bodyHtml) : '';
            const cacheHtml = (config.showCache !== false) ? this.createCacheBlock(config.creationTimeSteam, config.steamCacheExp, config.consultedMirrors) : '';

            return `${titleHtml}${bodyHtml}${mirrorCheckHtml}${cacheHtml}`;
        }
    };

    // Injeção de Estilos CSS no Head
    const style = document.createElement('style');
    style.innerHTML = `
        .swdd-custom-btn { display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 0 15px !important; font-size: 13px !important; font-weight: bold !important; border-radius: 2px !important; text-decoration: none !important; white-space: nowrap !important; transition: all 0.2s ease-in-out !important; box-sizing: border-box !important; font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important; box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important; gap: 8px !important; z-index: 99 !important; height: 34px !important; text-shadow: 1px 1px 2px rgba(0,0,0,0.5) !important; margin: 0 !important; user-select: none !important; -webkit-user-select: none !important; -moz-user-select: none !important; }
        .swdd-custom-btn-compact { padding: 0 8px !important; font-size: 11px !important; border-radius: 2px !important; gap: 4px !important; height: 24px !important; }
        .swdd-custom-btn:hover { filter: brightness(1.15) !important; }
        .swdd-custom-btn:active { filter: brightness(0.9) !important; }
        .swdd-state-loading { background: linear-gradient(to bottom, #343f4d 5%, #222933 95%) !important; color: #acb2b8 !important; border: 1px solid #455366 !important; cursor: wait !important; }
        .swdd-state-success { background: linear-gradient(to bottom, #3f5c1e 5%, #2c4015 95%) !important; color: #A3E33B !important; border: 1px solid #5a852a !important; cursor: pointer !important; }
        .swdd-state-warning { background: linear-gradient(to bottom, #6b410c 5%, #452a08 95%) !important; color: #F59E0B !important; border: 1px solid #995c10 !important; cursor: pointer !important; }
        .swdd-state-error { background: linear-gradient(to bottom, #612222 5%, #3d1616 95%) !important; color: #ff6b6b !important; border: 1px solid #8c3232 !important; cursor: pointer !important; }
        .swdd-btn-group { position: relative; display: inline-flex; border-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: transform 0.2s; align-items: center; height: 100%; }
        .swdd-btn-group:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.4); }
        .swdd-btn-main { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; border-right: 1px solid rgba(0,0,0,0.4) !important; margin: 0 !important; box-shadow: none !important; }
        .swdd-btn-main:hover { transform: none !important; box-shadow: none !important; }
        .swdd-btn-arrow { border-top-left-radius: 0 !important; border-bottom-left-radius: 0 !important; padding: 0 8px !important; margin: 0 !important; box-shadow: none !important; }
        .swdd-btn-arrow:hover { transform: none !important; box-shadow: none !important; }
        .swdd-global-dropdown { position: fixed !important; background: #171a21; border: 1px solid #3d4450; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.9); display: none; flex-direction: column; min-width: 220px; z-index: 2147483647 !important; overflow: hidden; margin: 0 !important; }
        .swdd-global-dropdown.show { display: flex; }
        .swdd-global-dropdown:popover-open { bottom: auto; right: auto; margin: 0 !important; }
        .swdd-global-dropdown a { padding: 10px 12px; color: #acb2b8; text-decoration: none; font-size: 12px; transition: background 0.2s; font-family: "Motiva Sans", sans-serif; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none !important; -webkit-user-select: none !important; -moz-user-select: none !important; }
        .swdd-global-dropdown a:hover { background: #3d4450; color: #fff; }
        .swdd-custom-tooltip { position: fixed !important; margin: 0 !important; z-index: 2147483647 !important; background: #171a21 !important; border: 1px solid #3d4450 !important; border-radius: 6px !important; padding: 12px !important; color: #acb2b8 !important; font-family: "Motiva Sans", Arial, sans-serif !important; font-size: 13px !important; box-shadow: 0 8px 16px rgba(0,0,0,0.9) !important; pointer-events: none !important; opacity: 0; transition: opacity 0.1s; white-space: nowrap !important; }
        .swdd-custom-tooltip.show { opacity: 1 !important; }
        .swdd-custom-tooltip:popover-open { bottom: auto; right: auto; margin: 0 !important; }
        .swdd-tooltip-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #3d4450; display: flex; align-items: center; gap: 6px; }
        .swdd-tooltip-success { color: #A3E33B; } .swdd-tooltip-warning { color: #F59E0B; } .swdd-tooltip-error { color: #ff6b6b; }
        .swdd-tooltip-row { margin: 4px 0; text-align: left !important; } .swdd-tooltip-label { color: #8f98a0; display: inline-block; width: auto; min-width: 48px; margin-right: 4px; } .swdd-tooltip-value { color: #E2E8F0; font-weight: 500; }
        #swdd-widget-main { display: inline-flex; height: 34px; align-items: center; }
        .swdd-widget-container { position: relative; z-index: 10; display: inline-flex; align-items: center; }
        .swdd-widget-container:hover { z-index: 9999; }
    `;
    document.head.appendChild(style);

    // ========================================================================
    // MÓDULO 4: EVENTOS NATIVOS E INTERFACE DE USUÁRIO (Event Delegation)
    // Ouve as interações do usuário (Cliques, Movimentação, Rolagem) em escopo global,
    // otimizando a memória ao evitar atrelar "EventListeners" botão a botão.
    // ========================================================================

    let popoverHideTimeouts = new Map();

    // Fallbacks elegantes para uso da Popover API nativa (se suportado pelo navegador)
    function safeShowPopover(el) {
        if (typeof el.showPopover === 'function') {
            if (popoverHideTimeouts.has(el)) { clearTimeout(popoverHideTimeouts.get(el)); popoverHideTimeouts.delete(el); }
            try { if (!el.matches(':popover-open')) el.showPopover(); } catch(e) {}
        }
    }

    function safeHidePopover(el, delay = 0) {
        if (typeof el.hidePopover === 'function') {
            if (popoverHideTimeouts.has(el)) clearTimeout(popoverHideTimeouts.get(el));
            if (delay > 0) {
                const timeoutId = setTimeout(() => {
                    try { if (el.matches(':popover-open')) el.hidePopover(); } catch(e) {}
                    popoverHideTimeouts.delete(el);
                }, delay);
                popoverHideTimeouts.set(el, timeoutId);
            } else {
                try { if (el.matches(':popover-open')) el.hidePopover(); } catch(e) {}
                popoverHideTimeouts.delete(el);
            }
        }
    }

    /**
     * Limpa qualquer seleção de texto residual deixada dentro do menu suspenso.
     * Sem isso, selecionar o texto de um item e depois fechar o menu (ex: rolando a página)
     * deixava uma seleção "presa" nos elementos antigos, fazendo o menu se fechar
     * sozinho na tentativa seguinte de abri-lo.
     */
    function clearStaleDropdownSelection() {
        try {
            const sel = window.getSelection ? window.getSelection() : null;
            if (sel && !sel.isCollapsed && sel.anchorNode && dropdownGlobal.contains(sel.anchorNode)) {
                sel.removeAllRanges();
            }
        } catch(e) {}
    }

    const dropdownGlobal = document.createElement('div');
    dropdownGlobal.className = 'swdd-global-dropdown';
    if (typeof dropdownGlobal.showPopover === 'function') dropdownGlobal.setAttribute('popover', 'manual');

    /**
     * Atualiza dinamicamente o texto e ícone de estado de bloqueio no botão limpar cache.
     * Altera visualmente apenas as tags span internas, preservando a formatação.
     */
    function updateDropdownCacheText() {
        const cacheBtn = dropdownGlobal.querySelector('#swdd-clear-cache');
        if (!cacheBtn) return;

        const now = Date.now();
        const iconSpan = cacheBtn.querySelector('.swdd-dropdown-icon');
        const textSpan = cacheBtn.querySelector('.swdd-dropdown-text');

        if (now < globalCacheCooldown) {
            const s = Math.ceil((globalCacheCooldown - now) / 1000);
            cacheBtn.style.cursor = 'not-allowed';
            cacheBtn.style.opacity = '0.5';
            if (iconSpan) iconSpan.innerHTML = '⏳';
            if (textSpan) textSpan.innerHTML = escapeHTML(t.cacheCooldown.replace('{s}', s));
        } else {
            cacheBtn.style.cursor = 'pointer';
            cacheBtn.style.opacity = '1';
            if (iconSpan) iconSpan.innerHTML = '🔄';
            if (textSpan) textSpan.innerHTML = escapeHTML(t.clearCache);
        }
    }

    /**
     * Interceptador Global de Cliques (Delegação)
     */
    document.addEventListener('click', (e) => {
        // Ação: Botão de "Limpar Cache"
        const clearCacheBtn = e.target.closest('#swdd-clear-cache');
        if (clearCacheBtn) {
            e.preventDefault(); e.stopPropagation();
            if (Date.now() >= globalCacheCooldown) {
                setGlobalCacheCooldown(30000); // Impede spam no botão de limpar cache

                CacheManager.remove(STEAM_CACHE_KEY);
                CacheManager.remove(GameSupportManager.CACHE_KEY_PREFIX + currentAppId);

                // Resolve as Promises pendentes com STEAM_FETCH_ERROR ANTES de zerar o cache,
                // já que os callbacks registrados leem o valor diretamente de steamDateCache[id]
                // (não recebem o argumento por parâmetro).
                steamCallbacks.forEach((callbacks, id) => {
                    steamDateCache[id] = STEAM_FETCH_ERROR;
                    callbacks.forEach(cb => cb());
                });

                steamDateCache = {};
                localSteamCache = {};

                pendingSteamIDs.clear();
                steamCallbacks.clear();

                // Limpa tanto caches Mod a Mod quanto Full Mirrors
                GAME.mirrors.forEach(mirror => {
                    if (mirror.type === 'per_mod') {
                        CacheManager.clearByPrefix(`${CACHE_PREFIX}Mirror_${mirror.id}_`);
                        memoryMirrorCache[mirror.id] = {};
                    } else {
                        CacheManager.remove(`${CACHE_PREFIX}Mirror_${mirror.id}`);
                        if (memoryMirrorCache[mirror.id]) memoryMirrorCache[mirror.id].exp = 0;
                    }
                });

                updateDropdownCacheText();
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
                if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }

                // Re-renderiza todos os widgets ativos na tela com os novos dados "zerados"
                for (const container of activeWidgets) {
                    if (!document.documentElement.contains(container)) {
                        activeWidgets.delete(container); continue;
                    }
                    if (container.dataset.modid) renderWidget(container, container.dataset.modid, container.dataset.iscard === 'true');
                }
            }
            return;
        }

        // Ação: Cliques nos links gerados pelo script
        // RECUPERAÇÃO DE TECLAS MODIFICADORAS: Respeita a intenção nativa do usuário de abrir em nova aba/janela
        // usando (Ctrl, Shift, Command/Meta, Alt)
        const scriptLink = e.target.closest('a.swdd-custom-btn, a.swdd-bg-link');
        if (scriptLink && scriptLink.hasAttribute('href') && e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            // Abre o link em background dependendo dos grants disponíveis no script runner (Tampermonkey/Violentmonkey)
            if (typeof GM_openInTab === 'function') GM_openInTab(scriptLink.href, { active: false, insert: true });
            else window.open(scriptLink.href, '_blank', 'noopener');

            if (scriptLink.classList.contains('swdd-bg-link') && dropdownGlobal.classList.contains('show')) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
                if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }
            }
            return;
        }

        // Ação: Botão da "Seta" para abrir menu dropdown
        const arrowBtn = e.target.closest('.swdd-btn-arrow');
        if (arrowBtn) {
            e.preventDefault(); e.stopPropagation();
            if (dropdownGlobal.classList.contains('show') && dropdownGlobal.lastArrow === arrowBtn) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
                if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }
                return;
            }

            // Calcula a posição do Popover na tela
            const dialogParent = arrowBtn.closest('dialog');
            const rect = arrowBtn.getBoundingClientRect();
            let topPos = rect.bottom, leftPos = rect.right - 220;

            if (dialogParent) dialogParent.appendChild(dropdownGlobal); else document.body.appendChild(dropdownGlobal);
            if (typeof dropdownGlobal.showPopover !== 'function' && dialogParent) {
                const dialogParentStyle = window.getComputedStyle(dialogParent);
                if (dialogParentStyle.transform !== 'none') { const dialogRect = dialogParent.getBoundingClientRect(); topPos -= dialogRect.top; leftPos -= dialogRect.left; }
            }

            // Extrai as configurações json armazenadas e constrói os itens do menu
            // dinamicamente com base nas condições modulares.
            const dropdownData = arrowBtn.getAttribute('data-dropdown-items');
            let items = [];
            try { items = JSON.parse(dropdownData); } catch(err) {}

            let menuHtml = '';
            items.forEach(item => {
                // Configurações de Bloqueio Dinâmico
                const isBlocked = item.disabled === true;
                const blockStyle = isBlocked ? 'cursor: not-allowed; opacity: 0.4; text-decoration: none;' : 'cursor: pointer;';

                // Configurações de Atributos do HTML
                const idAttr = item.action === 'clearCache' ? 'id="swdd-clear-cache"' : '';
                const hrefAttr = (!isBlocked && item.link) ? `href="${escapeHTML(item.link)}" rel="noopener noreferrer"` : '';
                const classAttr = `class="${item.action !== 'clearCache' && !isBlocked ? 'swdd-bg-link' : ''}"`;

                // Implementa o Tooltip Customizado via data-attribute para renderização no motor principal.
                const tooltipDataAttr = item.tooltip ? `data-swdd-tooltip="${escapeHTML(item.tooltip)}"` : '';
                // Marca o tooltip como "aviso" (amarelo) quando sinalizado pela config do botão,
                // ex: o lembrete de "leia as regras do site/fórum antes de pedir".
                const tooltipWarnAttr = item.tooltipWarn ? 'data-swdd-tooltip-warn="1"' : '';

                // O ícone será inserido condicionalmente apenas se houver configuração de icon
                menuHtml += `
                    <a ${idAttr} ${hrefAttr} ${classAttr} ${tooltipDataAttr} ${tooltipWarnAttr} style="${blockStyle}">
                        ${item.icon ? `<span class="swdd-dropdown-icon">${escapeHTML(item.icon)}</span> ` : ''}<span class="swdd-dropdown-text">${escapeHTML(item.text)}</span>
                    </a>
                `;
            });

            dropdownGlobal.innerHTML = menuHtml;
            updateDropdownCacheText();
            clearStaleDropdownSelection();

            dropdownGlobal.style.top = topPos + 'px'; dropdownGlobal.style.left = leftPos + 'px';
            dropdownGlobal.classList.add('show'); safeShowPopover(dropdownGlobal); dropdownGlobal.lastArrow = arrowBtn;

            // Vincula dinamicamente a apresentação visual do painel flutuante aos menus suspensos
            dropdownGlobal.querySelectorAll('a[data-swdd-tooltip]').forEach(link => {
                const tooltipText = link.getAttribute('data-swdd-tooltip');
                const isWarnTip = link.hasAttribute('data-swdd-tooltip-warn');
                const tooltipColor = isWarnTip ? '#F59E0B' : 'inherit';
                const tooltipHtml = `<div class="swdd-tooltip-row" style="white-space: normal !important; max-width: 220px; line-height: 1.4; color: ${tooltipColor};">${escapeHTML(tooltipText)}</div>`;
                bindTooltip(link, tooltipHtml);
            });

            return;
        }

        // Fecha o dropdown se o clique ocorrer em qualquer lugar fora dele
        if (!e.target.closest('.swdd-global-dropdown') && dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
            if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }
        }
    }, true);

    /**
     * Oculta menus suspensos e tooltips ao rolar a página.
     * Impede que as caixas de UI flutuem incorretamente sobre outros elementos da Steam.
     * O uso de { passive: true } garante que a escuta não gere engasgos de processamento.
     */
    window.addEventListener('scroll', () => {
        if (dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show');
            safeHidePopover(dropdownGlobal);
            dropdownGlobal.lastArrow = null;
            // Limpa qualquer seleção de texto deixada em um item do menu antes de fechá-lo,
            // evitando que ela "vaze" para a próxima vez que o menu for aberto.
            clearStaleDropdownSelection();
        }
        if (tooltipGlobal.classList.contains('show')) {
            clearTimeout(hoverTimer);
            tooltipGlobal.classList.remove('show');
            safeHidePopover(tooltipGlobal);
        }
    }, { passive: true });

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'swdd-custom-tooltip';
    if (typeof tooltipGlobal.showPopover === 'function') tooltipGlobal.setAttribute('popover', 'manual');
    let hoverTimer; // Temporizador (Debounce) para evitar "piscar" o tooltip passando o mouse rápido

    // Atualiza dinamicamente as contagens de tempo regressivo visíveis no tooltip
    function refreshTooltipTimers() {
        tooltipGlobal.querySelectorAll('.swdd-cache-countdown').forEach(el => {
            const exp = parseInt(el.getAttribute('data-exp'), 10);
            if (exp) el.innerText = TemplateEngine.formatTimeLeft(exp);
        });
        tooltipGlobal.querySelectorAll('.swdd-cache-age').forEach(el => {
            const created = parseInt(el.getAttribute('data-created'), 10);
            if (created) el.innerText = TemplateEngine.formatCacheAge(Date.now() - created);
        });
        const idleStatusEl = tooltipGlobal.querySelector('.swdd-idle-status');
        if (idleStatusEl) {
            idleStatusEl.innerHTML = (isIdleNow() || wasIdleRecently) ? `<span style="color:#F59E0B">⏸️ ${escapeHTML(t.idlePaused)}</span>` : `<span style="color:#A3E33B">🟢 ${escapeHTML(t.idleActive)}</span>`;
        }
    }

    // ========================================================================
    // MÓDULO 5: OCIOSIDADE (IDLE) E SINCRONIZAÇÃO ENTRE ABAS E TIMERS
    // Pausa rotinas ativas se o usuário estiver AFK para poupar CPU/Rede.
    // Ouve eventos de Storage para atualizar múltiplas abas abertas simultaneamente.
    // ========================================================================
    let globalCacheCooldown = parseInt(CacheManager.get(`${CACHE_PREFIX}Cooldown`) || '0', 10);
    function setGlobalCacheCooldown(ms) {
        globalCacheCooldown = Date.now() + ms;
        CacheManager.set(`${CACHE_PREFIX}Cooldown`, globalCacheCooldown.toString());
    }

    let globalCacheCleared = false;
    window.addEventListener('storage', (e) => {
        if (e.key === `${CACHE_PREFIX}Cooldown`) {
            globalCacheCooldown = parseInt(JSON.parse(e.newValue), 10) || 0;
            if (dropdownGlobal.classList.contains('show')) updateDropdownCacheText();
        }
        if (e.key === STEAM_CACHE_KEY && e.newValue === null) {
            steamDateCache = {}; localSteamCache = {}; globalCacheCleared = true;
        }

        // Invalida ativamente os caches armazenados na memória RAM de todas as abas
        if (e.key && e.key.startsWith(`${CACHE_PREFIX}Mirror_`) && e.newValue === null) {
            GAME.mirrors.forEach(mirror => {
                if (mirror.type === 'per_mod') {
                    if (e.key.startsWith(`${CACHE_PREFIX}Mirror_${mirror.id}_`)) {
                        const modId = e.key.replace(`${CACHE_PREFIX}Mirror_${mirror.id}_`, '');
                        if (memoryMirrorCache[mirror.id] && memoryMirrorCache[mirror.id][modId]) memoryMirrorCache[mirror.id][modId].exp = 0;
                        globalCacheCleared = true;
                    }
                } else {
                    if (e.key === `${CACHE_PREFIX}Mirror_${mirror.id}`) {
                        if (memoryMirrorCache[mirror.id]) memoryMirrorCache[mirror.id].exp = 0;
                        globalCacheCleared = true;
                    }
                }
            });
        }
    });

    const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos de inatividade
    let lastActivityTime = Date.now();
    let activityTimeout; let wasIdleRecently = false;

    function isIdleNow() { return (Date.now() - lastActivityTime) > IDLE_TIMEOUT_MS; }

    function resetActivity() {
        if (!activityTimeout) {
            const now = Date.now();
            if (isIdleNow()) { wasIdleRecently = true; setTimeout(() => { wasIdleRecently = false; refreshTooltipTimers(); }, 4000); }
            lastActivityTime = now;
            activityTimeout = setTimeout(() => { activityTimeout = null; }, 1000); // Throttling 1s
        }
    }
    ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(evt => window.addEventListener(evt, resetActivity, { passive: true }));

    const activeWidgets = new Set();

    // Heartbeat central do script (Loop que roda 1x por segundo)
    setInterval(() => {
        if (dropdownGlobal.classList.contains('show')) updateDropdownCacheText();
        if (tooltipGlobal.classList.contains('show')) refreshTooltipTimers();

        // Motor do Timer Modular: Atualiza a contagem visual e libera botões temporariamente bloqueados
        document.querySelectorAll('.swdd-btn-main[data-timer-exp]').forEach(btn => {
            const exp = parseInt(btn.getAttribute('data-timer-exp'), 10);
            const now = Date.now();
            const textSpan = btn.querySelector('.swdd-btn-text');
            const origText = btn.getAttribute('data-orig-text');

            if (exp > now) {
                // Atualiza contagem visual
                const left = Math.ceil((exp - now) / 1000);
                if (textSpan) textSpan.innerText = `${origText} (${left}s)`;
            } else {
                // Timer expirou: Libera o botão nativamente
                btn.removeAttribute('data-timer-exp');
                btn.style.cursor = '';
                btn.style.filter = '';
                const origLink = btn.getAttribute('data-orig-link');
                if (origLink) {
                    btn.href = origLink;
                    btn.setAttribute('rel', 'noopener noreferrer');
                }
                if (textSpan) textSpan.innerText = origText;
            }
        });

        // Se a página não estiver oculta e o usuário não estiver AFK, roda verificações de atualização
        if (!document.hidden && !isIdleNow()) {
            const now = Date.now();
            const forceUpdate = globalCacheCleared;
            if (forceUpdate) globalCacheCleared = false;

            for (const container of activeWidgets) {
                // Checagem rigorosa para evitar leak de memória (limpa widgets que já foram removidos da tela)
                if (!document.documentElement.contains(container)) { activeWidgets.delete(container); continue; }

                const modId = container.dataset.modid;
                if (modId) {
                    const steamExpired = localSteamCache[modId] ? (now >= localSteamCache[modId].exp) : false;
                    if (steamExpired) delete steamDateCache[modId];

                    let mirrorExpired = false;
                    if (container.dataset.activeMirrorIds) {
                        try {
                            const mirrorIds = JSON.parse(container.dataset.activeMirrorIds);
                            for (const mId of mirrorIds) {
                                const mConfig = GAME.mirrors.find(m => m.id === mId);
                                if (mConfig) {
                                    if (mConfig.type === 'per_mod') {
                                        if (memoryMirrorCache[mId] && memoryMirrorCache[mId][modId] && now >= memoryMirrorCache[mId][modId].exp) { mirrorExpired = true; break; }
                                    } else {
                                        if (memoryMirrorCache[mId] && now >= memoryMirrorCache[mId].exp) { mirrorExpired = true; break; }
                                    }
                                }
                            }
                        } catch(e) {}
                    }

                    // Força a re-renderização se algum cache daquele botão expirou
                    if ((mirrorExpired || steamExpired || forceUpdate) && !container.querySelector('.swdd-state-loading')) {
                        // .catch() defensivo: se o ciclo assíncrono falhar por algum motivo
                        // inesperado, registramos no console em vez de deixar uma rejeição de
                        // Promise não tratada silenciosa; o próximo ciclo do heartbeat (1s
                        // depois) tenta novamente normalmente, então o widget não fica preso.
                        renderWidget(container, modId, container.dataset.iscard === 'true').catch(err => {
                            console.error('[SWDD] Falha ao atualizar widget após expiração de cache:', err);
                        });
                    }
                }
            }
        }
    }, 1000);

    /**
     * Vincula a lógica de surgimento (Hover/Debounce) ao elemento do DOM passado.
     */
    function bindTooltip(element, htmlContent) {
        let lastX = 0, lastY = 0;
        const updatePos = () => {
            let left = lastX + 15, top = lastY + 15;
            const tooltipWidth = tooltipGlobal.offsetWidth || 200, tooltipHeight = tooltipGlobal.offsetHeight || 100;
            // Previne que o Tooltip extrapole as bordas da tela
            if (left + tooltipWidth > window.innerWidth - 10) left = lastX - tooltipWidth - 15;
            if (top + tooltipHeight > window.innerHeight - 10) top = lastY - tooltipHeight - 15;

            // Tratamento especial para popovers flutuando sobre diálogos nativos abertos <dialog>
            if (typeof tooltipGlobal.showPopover !== 'function') {
                const dialogParent = element.closest('dialog');
                if (dialogParent && window.getComputedStyle(dialogParent).transform !== 'none') {
                    const dialogRect = dialogParent.getBoundingClientRect(); left -= dialogRect.left; top -= dialogRect.top;
                }
            }
            tooltipGlobal.style.left = left + 'px'; tooltipGlobal.style.top = top + 'px';
        };

        element.addEventListener('mouseenter', (e) => {
            if (!document.documentElement.contains(element)) return;
            lastX = e.clientX; lastY = e.clientY;
            hoverTimer = setTimeout(() => {
                // Revalida que o elemento ainda está vivo na DOM: se o widget foi re-renderizado
                // (cache expirou, idioma mudou, etc.) durante esses 300ms, este elemento e o
                // "htmlContent" capturado na closure ficaram obsoletos — não exibe o tooltip antigo.
                if (!document.documentElement.contains(element)) return;
                const dialogParent = element.closest('dialog');
                if (dialogParent) dialogParent.appendChild(tooltipGlobal); else document.body.appendChild(tooltipGlobal);
                tooltipGlobal.innerHTML = htmlContent;
                refreshTooltipTimers();
                tooltipGlobal.classList.add('show'); safeShowPopover(tooltipGlobal); updatePos();
            }, 300); // 300ms de atraso para abrir o Tooltip (UX mais suave)
        });

        element.addEventListener('mousemove', (e) => { lastX = e.clientX; lastY = e.clientY; if (tooltipGlobal.classList.contains('show')) updatePos(); });
        element.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal, 100); });
    }

    // ========================================================================
    // MÓDULO 6: API CONTROLLERS (Gerenciamento Lógico de Consultas Steam e Mirrors)
    // ========================================================================
    let steamDateCache  = {};
    let localSteamCache = {};
    let pendingSteamIDs = new Set();
    let isFetchingBatch = false;
    let steamQueueTimeout = null;
    let steamCallbacks = new Map();

    function saveSteamCache() {
        const now = Date.now();
        let size = 0;
        for (const id in localSteamCache) {
            if (localSteamCache[id].exp < now) delete localSteamCache[id];
            else size++;
        }
        // Garbage Collector: Remove excessos se o limite de chaves for extrapolado (max: 5000)
        if (size > 5000) {
            const entries = Object.entries(localSteamCache).sort((a, b) => a[1].exp - b[1].exp);
            for(let i = 0; i < entries.length - 5000; i++) delete localSteamCache[entries[i][0]];
        }
        CacheManager.set(STEAM_CACHE_KEY, localSteamCache);
    }

    const storedSteam = CacheManager.get(STEAM_CACHE_KEY);
    if (storedSteam) {
        const now = Date.now();
        for (const id in storedSteam) {
            if (storedSteam[id] && storedSteam[id].exp && now < storedSteam[id].exp) localSteamCache[id] = storedSteam[id];
        }
        saveSteamCache();
    }

    // Processamento em lote (Batching): Em páginas que contêm dezenas de mods na tela de uma vez,
    // consolida as múltiplas consultas em apenas UMA requisição (ISteamRemoteStorage/GetPublishedFileDetails).
    function triggerSteamFetch() {
        if (!isFetchingBatch && pendingSteamIDs.size > 0) {
            clearTimeout(steamQueueTimeout);
            steamQueueTimeout = setTimeout(processSteamQueue, 100);
        }
    }

    function handleSteamError(ids) {
        const now = Date.now();
        ids.forEach(id => {
            steamDateCache[id] = STEAM_FETCH_ERROR;
            localSteamCache[id] = { date: STEAM_FETCH_ERROR, exp: now + CACHE_TIME_STEAM_MS };
            pendingSteamIDs.delete(id);
            if (steamCallbacks.has(id)) { steamCallbacks.get(id).forEach(cb => cb()); steamCallbacks.delete(id); }
        });
        saveSteamCache();
        isFetchingBatch = false; triggerSteamFetch();
    }

    async function processSteamQueue() {
        if (isFetchingBatch || pendingSteamIDs.size === 0) return;
        isFetchingBatch = true;

        // Empacota até 100 IDs em uma mesma requisição POST
        const idsToFetch = Array.from(pendingSteamIDs).slice(0, 100);

        const formData = new URLSearchParams();
        formData.append('itemcount', idsToFetch.length.toString());
        idsToFetch.forEach((id, index) => formData.append(`publishedfileids[${index}]`, id));

        try {
            const response = await ApiClient.fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
                method: 'POST',
                data: formData.toString(),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const now = Date.now();
            const handledIds = new Set();
            const data = JSON.parse(response.responseText);
            if (data.response?.publishedfiledetails) {
                data.response.publishedfiledetails.forEach(details => {
                    if (details.publishedfileid) {
                        const id = details.publishedfileid;
                        // Prioriza data de atualização, com fallback para data de criação nativa
                        const timestamp = details.time_updated || details.time_created;
                        const dateVal = timestamp ? new Date(timestamp * 1000) : STEAM_NO_DATE;

                        steamDateCache[id] = dateVal;
                        localSteamCache[id] = {
                            date: dateVal === STEAM_NO_DATE ? STEAM_NO_DATE : dateVal.toISOString(),
                            exp: now + CACHE_TIME_STEAM_MS
                        };
                        handledIds.add(id);
                    }
                });
            }

            idsToFetch.forEach(id => {
                if (!handledIds.has(id)) {
                    steamDateCache[id] = STEAM_NO_DATE;
                    localSteamCache[id] = { date: STEAM_NO_DATE, exp: now + CACHE_TIME_STEAM_MS };
                }
                pendingSteamIDs.delete(id);
                // Libera todas as Promises na fila
                if (steamCallbacks.has(id)) { steamCallbacks.get(id).forEach(cb => cb()); steamCallbacks.delete(id); }
            });

            saveSteamCache();
            isFetchingBatch = false; triggerSteamFetch();

        } catch (error) {
            handleSteamError(idsToFetch);
        }
    }

    /**
     * Requisita, de forma assíncrona segura, a última atualização de um ID na API da Steam.
     */
    function getSteamDateAsync(modId) {
        return new Promise(resolve => {
            if (localSteamCache[modId] && Date.now() >= localSteamCache[modId].exp) {
                delete steamDateCache[modId];
            }

            let dateSteam = steamDateCache[modId];
            if (dateSteam === undefined && localSteamCache[modId] && Date.now() < localSteamCache[modId].exp) {
                const cachedVal = localSteamCache[modId].date;
                dateSteam = steamDateCache[modId] = (cachedVal === STEAM_NO_DATE || cachedVal === STEAM_FETCH_ERROR) ? cachedVal : new Date(cachedVal);
            }

            if (dateSteam !== undefined) return resolve(dateSteam);

            pendingSteamIDs.add(modId);
            if (!steamCallbacks.has(modId)) steamCallbacks.set(modId, new Set());
            steamCallbacks.get(modId).add(() => resolve(steamDateCache[modId]));
            triggerSteamFetch();
        });
    }

    const memoryMirrorCache = {};
    const pendingMirrorRequests = {};

    /**
     * Orquestrador de requisições a Mirrors Paralelos
     */
    async function fetchMirrorAsync(mirrorConfig, modId = null) {
        const cacheKey = mirrorConfig.type === 'per_mod' ? `${CACHE_PREFIX}Mirror_${mirrorConfig.id}_${modId}` : `${CACHE_PREFIX}Mirror_${mirrorConfig.id}`;
        const requestKey = mirrorConfig.type === 'per_mod' ? `${mirrorConfig.id}_${modId}` : mirrorConfig.id;
        const now = Date.now();

        if (!memoryMirrorCache[mirrorConfig.id]) memoryMirrorCache[mirrorConfig.id] = {};

        // 1º Nível: Checa o Cache em Memória RAM (Mais Rápido)
        if (mirrorConfig.type === 'per_mod') {
            if (memoryMirrorCache[mirrorConfig.id][modId] && memoryMirrorCache[mirrorConfig.id][modId].exp > now) return memoryMirrorCache[mirrorConfig.id][modId];
        } else {
            if (memoryMirrorCache[mirrorConfig.id] && memoryMirrorCache[mirrorConfig.id].exp > now) return memoryMirrorCache[mirrorConfig.id];
        }

        // Se já existe uma requisição web na fila idêntica, atrela-se a ela
        if (pendingMirrorRequests[requestKey]) return pendingMirrorRequests[requestKey];

        // 2º Nível: Checa Cache Persistido Local (LocalStorage)
        const stored = CacheManager.get(cacheKey);
        if (stored && stored.exp > now) {
            // Reparse datas convertendo a string ISO gerada pelo stringify para o Objeto Date adequado
            if (mirrorConfig.type === 'per_mod' && stored.data) {
                if (stored.data.date) stored.data.date = new Date(stored.data.date);
                if (stored.data.fallbackDate) stored.data.fallbackDate = new Date(stored.data.fallbackDate);
                memoryMirrorCache[mirrorConfig.id][modId] = stored;
            } else if (stored.data) {
                for(let k in stored.data) {
                    if(stored.data[k].date) stored.data[k].date = new Date(stored.data[k].date);
                    if(stored.data[k].fallbackDate) stored.data[k].fallbackDate = new Date(stored.data[k].fallbackDate);
                }
                memoryMirrorCache[mirrorConfig.id] = stored;
            }
            return stored;
        }

        // 3º Nível: Realiza a requisição ao mirror externo
        const requestPromise = (async () => {
            try {
                const targetUrl = mirrorConfig.type === 'per_mod' ? mirrorConfig.url(modId) : mirrorConfig.url;
                // Anexa parâmetro '_t' com Date.now() para burlar caching restritivo do servidor
                const finalUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + '_t=' + now;
                const res = await ApiClient.fetch(finalUrl);

                const parsedData = mirrorConfig.type === 'per_mod' ? mirrorConfig.parser(res.responseText, modId) : mirrorConfig.parser(res.responseText);
                const cacheObj = { data: parsedData, exp: now + mirrorConfig.cacheTime, creation: now };

                if (mirrorConfig.type === 'per_mod') memoryMirrorCache[mirrorConfig.id][modId] = cacheObj;
                else memoryMirrorCache[mirrorConfig.id] = cacheObj;

                CacheManager.set(cacheKey, cacheObj);
                delete pendingMirrorRequests[requestKey];
                return cacheObj;
            } catch (e) {
                console.error(`[SWDD] Fallback Error (Mirror: ${mirrorConfig.name}):`, e);
                delete pendingMirrorRequests[requestKey];
                return null;
            }
        })();

        pendingMirrorRequests[requestKey] = requestPromise;
        return requestPromise;
    }

    /**
     * Varre todos os espelhos e resolve se a melhor versão hospedada está em dia com a Steam.
     */
    async function getBestModFromMirrors(modId, dateSteam) {
        const consultedMirrors = [];
        let bestOutdated = null;

        for (const mirrorConfig of GAME.mirrors) {
            let mirrorCacheObj = await fetchMirrorAsync(mirrorConfig, mirrorConfig.type === 'per_mod' ? modId : null);
            let modData = null;

            if (mirrorCacheObj && mirrorCacheObj.data) {
                modData = mirrorConfig.type === 'per_mod' ? mirrorCacheObj.data : mirrorCacheObj.data[modId];
            }

            // "theme" reflete o status individual DESTE mirror (cor da bolinha em createMirrorCheckNotice):
            // error = indisponível/sem o mod, warning = desatualizado, success = em dia.
            let mirrorTheme = 'error';
            let isUpdated = false;

            if (!mirrorCacheObj) {
                mirrorTheme = 'error';
            } else if (modData) {
                let dateMirror = modData.date;

                if (dateSteam === STEAM_NO_DATE || dateSteam === STEAM_FETCH_ERROR) {
                    isUpdated = true;
                } else if (!dateMirror) {
                    isUpdated = false;
                } else if (utils.isUpToDate(dateMirror, dateSteam)) {
                    isUpdated = true;
                } else if (modData.fallbackDate && utils.isUpToDate(modData.fallbackDate, dateSteam)) {
                    // Estrutura de Proteção (FallbackDate)
                    // Se a data primária indicou que está desatualizado, mas a data de metadados secundária
                    // garantir que o arquivo lá contido é recente, ele subscreve o display e libera botão verde.
                    isUpdated = true;
                    modData = { ...modData, date: modData.fallbackDate, exactTime: modData.fallbackExact };
                }

                mirrorTheme = isUpdated ? 'success' : 'warning';
            }

            // Popula rastreamento de cache (Usado para o Painel de Debug Tooltip)
            consultedMirrors.push({
                id: mirrorConfig.id,
                name: mirrorConfig.name,
                exp: mirrorCacheObj ? mirrorCacheObj.exp : 0,
                creation: mirrorCacheObj ? mirrorCacheObj.creation : 0,
                error: !mirrorCacheObj,
                theme: mirrorTheme
            });

            if (modData) {
                if (isUpdated) {
                    return { mirrorId: mirrorConfig.id, mirrorName: mirrorConfig.name, modData: modData, exp: mirrorCacheObj.exp, creation: mirrorCacheObj.creation, consultedMirrors: consultedMirrors };
                } else {
                    let dateMirror = modData.date;
                    if (!bestOutdated || !bestOutdated.modData.date || (dateMirror && dateMirror > bestOutdated.modData.date)) {
                        bestOutdated = { mirrorId: mirrorConfig.id, mirrorName: mirrorConfig.name, modData: modData, exp: mirrorCacheObj.exp, creation: mirrorCacheObj.creation };
                    }
                }
            }
        }

        if (bestOutdated) { bestOutdated.consultedMirrors = consultedMirrors; return bestOutdated; }
        return { consultedMirrors: consultedMirrors, notFound: true };
    }

    // ========================================================================
    // MÓDULO 7: RENDERIZAÇÃO LÓGICA DO WIDGET (Usando Sistema Modular)
    // Toma as decisões de exibição combinando as respostas extraídas e
    // chama o TemplateEngine para rechear o elemento DOM pai passado.
    // ========================================================================
    async function renderWidget(container, modId, isCard) {
        container.innerHTML = TemplateEngine.createLoadingBtn(isCard);

        const isGameSupported = await gameSupportedPromise;
        if (!isGameSupported) { container.remove(); activeWidgets.delete(container); return; }

        const dateSteam = await getSteamDateAsync(modId);
        const mirrorResult = await getBestModFromMirrors(modId, dateSteam);

        const steamCacheExp = localSteamCache[modId] ? localSteamCache[modId].exp : 0;
        const creationTimeSteam = steamCacheExp ? (steamCacheExp - CACHE_TIME_STEAM_MS) : Date.now();
        const consultedMirrors = mirrorResult ? mirrorResult.consultedMirrors : [];

        // Helper local: amarra os dados de mirror/cache de ANTEMÃO, então cada branch
        // abaixo só precisa descrever o que é específico do seu estado (título, ícone,
        // corpo). "Mirrors verificados" e "Status do Cache" saem de graça em todo lugar.
        const buildTooltip = (cfg) => TemplateEngine.createTooltip({
            consultedMirrors,
            creationTimeSteam,
            steamCacheExp,
            ...cfg
        });

        if (!mirrorResult || mirrorResult.notFound) {
            // CONFIGURAÇÃO MODULAR: Cenário Sem Mod Encontrado
            const btnConfig = {
                icon: GAME.forumUrl ? '➕' : '🚫',
                text: GAME.forumUrl ? t.requestMod : t.modUnavailable,
                link: GAME.forumUrl,
                stateClass: TemplateEngine.THEMES.error.stateClass,
                disabled: !GAME.forumUrl,
                dropdown: [
                    {
                        text: t.clearCache,
                        icon: '🔄',
                        action: 'clearCache',
                        condition: true,
                        tooltip: t.clearCacheTip
                    }
                ]
            };

            const subTipText = GAME.forumUrl ? t.modNotListedSubTip : t.modUnavailableSubTip;
            // Aviso de "leia as regras" usa amarelo (cor de warning) para chamar mais atenção;
            // o caso de mirror indisponível mantém o cinza neutro de informação.
            const subTipColor = GAME.forumUrl ? '#F59E0B' : '#8f98a0';
            const subTipHtml = subTipText ? `<div style="color: ${subTipColor}; font-size: 11px; margin-top: 4px; white-space: normal !important; line-height: 1.4;">${subTipText}</div>` : '';

            const tooltipHtmlStr = buildTooltip({
                stateClass: 'error',
                icon: GAME.forumUrl ? '❌' : '🚫',
                titleText: GAME.forumUrl ? t.modNotListed : t.modUnavailableTip,
                bodyHtml: subTipHtml,
                // Nada foi encontrado/selecionado aqui — mostrar "melhor versão
                // selecionada" junto do título de erro seria contraditório.
                showBestAvailable: false
            });

            container.dataset.activeMirrorIds = JSON.stringify(consultedMirrors.map(m => m.id));

            container.innerHTML = TemplateEngine.createModularButton(isCard, btnConfig);

            bindTooltip(container.firstElementChild, tooltipHtmlStr);
            if (container.matches(':hover')) { tooltipGlobal.innerHTML = tooltipHtmlStr; refreshTooltipTimers(); tooltipGlobal.classList.add('show'); safeShowPopover(tooltipGlobal); }
            return;
        }

        const { mirrorName, modData } = mirrorResult;
        const dateMirror = modData.date;
        const exactTime = modData.exactTime !== false;

        container.dataset.activeMirrorIds = JSON.stringify(consultedMirrors.map(m => m.id));

        let strMirror = 'N/A';
        if (dateMirror) strMirror = exactTime ? dateMirror.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : dateMirror.toLocaleString([], {dateStyle: 'short'});
        const strSteam  = (dateSteam && dateSteam !== STEAM_NO_DATE && dateSteam !== STEAM_FETCH_ERROR) ? dateSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';

        // Verifica protocolo HTTP/HTTPS rigorosamente para mitigar injeções perigosas em URL (ex: javascript:alert(1))
        let safeLink = '#';
        try { if (modData.link) { const parsedUrl = new URL(modData.link); if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') safeLink = parsedUrl.href; } } catch(e) {}

        // O mirror retornou um campo "link" (não veio vazio/ausente), mas ele não sobreviveu
        // à validação de protocolo acima (ex: "javascript:...", URL malformada). Sem isso,
        // o botão ficava com aparência de sucesso normal e, ao clicar, abria uma aba em
        // background apontando de volta para a própria página (href="#") — sem nenhum aviso
        // ao usuário de que o link do mirror estava quebrado/inseguro.
        const linkInvalid = !!modData.link && safeLink === '#';

        let exactTimeWarningHtml = '';
        if (!exactTime && dateMirror && dateSteam && dateSteam !== STEAM_NO_DATE && dateSteam !== STEAM_FETCH_ERROR) {
            // Se o dia coincidir (mesmo sem hora exata para comparar), solta o alerta amarelo
            const isSameDay = dateMirror.getFullYear() === dateSteam.getFullYear() && dateMirror.getMonth() === dateSteam.getMonth() && dateMirror.getDate() === dateSteam.getDate();
            if (isSameDay) {
                exactTimeWarningHtml = `<div style="color: #F59E0B; font-size: 11px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #3d4450; white-space: normal !important; line-height: 1.4;">⚠️ ${t.exactTimeWarn}</div>`;
            }
        }

        // ========================================================================
        // CONFIGURAÇÃO MODULAR DO BOTÃO PRINCIPAL (Estado de Download)
        // ========================================================================
        // O mod só é considerado "desatualizado" quando existe uma data de mirror válida
        // E a consulta à Steam não falhou E essa data é anterior à da Steam.
        // Isso evita que a opção "Pedir Atualização" apareça quando o mod já está em dia,
        // quando o mirror não possui data, ou quando a Steam não pôde ser consultada.
        const isOutdated = !!dateMirror && dateSteam !== STEAM_FETCH_ERROR && !utils.isUpToDate(dateMirror, dateSteam);

        let tooltipHtmlStr;
        let btnConfig = {
            link: safeLink,
            dropdown: [
                {
                    text: t.clearCache,
                    icon: '🔄',
                    action: 'clearCache',
                    condition: true,
                    tooltip: t.clearCacheTip
                },
                {
                    text: t.requestUpdate,
                    icon: '💬',
                    link: GAME.forumUrl,
                    condition: isOutdated,
                    // Fórum bloqueado caso as configurações do jogo não definam uma URL
                    disabled: !GAME.forumUrl,
                    tooltip: GAME.forumUrl
                        ? t.requestUpdateTip
                        : t.noForumTip,
                    // Sinaliza que esse tooltip é o aviso de "leia as regras" (amarelo),
                    // e não o erro neutro de "nenhum fórum cadastrado".
                    tooltipWarn: !!GAME.forumUrl
                }
            ]
        };

        if (linkInvalid) {
            // Estado: o mirror respondeu e "encontrou" o mod, mas o link fornecido não é um
            // HTTP/HTTPS válido. Prioridade máxima sobre os demais estados — não faz sentido
            // dizer "atualizado"/"desatualizado" sobre um link que não pode ser aberto com segurança.
            // Botão fica bloqueado (sem href) para não abrir uma aba vazia silenciosamente.
            btnConfig.icon = '⚠️';
            btnConfig.text = t.invalidLink;
            btnConfig.stateClass = TemplateEngine.THEMES.error.stateClass;
            btnConfig.disabled = true;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'error',
                icon: '🚫',
                titleText: t.invalidLinkTip,
                bodyHtml: TemplateEngine.createTooltipGrid(true, strSteam, true, mirrorName, strMirror, exactTimeWarningHtml)
            });
        } else if (dateSteam === STEAM_FETCH_ERROR) {
            // Estado: Steam inacessível (não dá pra confirmar se o mirror está em dia)
            btnConfig.icon = '⚠️';
            btnConfig.text = t.steamError;
            btnConfig.stateClass = TemplateEngine.THEMES.error.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'error',
                icon: '🔌',
                titleText: t.steamErrorTip,
                bodyHtml: TemplateEngine.createTooltipGrid(false, strSteam, true, mirrorName, strMirror, exactTimeWarningHtml)
            });
        } else if (!dateMirror) {
            // Estado: mod encontrado no mirror, mas sem data de versão pra comparar
            btnConfig.icon = '⚠️';
            btnConfig.text = t.downloadWarning;
            btnConfig.stateClass = TemplateEngine.THEMES.warning.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'warning',
                icon: '⚠️',
                titleText: t.mirrorNoDate,
                bodyHtml: `<div class="swdd-tooltip-row">${escapeHTML(t.mirrorNoDateTip)}</div>`
            });
        } else if (utils.isUpToDate(dateMirror, dateSteam)) {
            // Estado: mirror está na mesma versão (ou mais recente) que a Steam
            btnConfig.icon = '✅';
            btnConfig.text = t.download;
            btnConfig.stateClass = TemplateEngine.THEMES.success.stateClass;
            // Exemplo de Timer: Poderíamos adicionar um atraso para leitura do aviso de versão defasada
            // btnConfig.timerExp = Date.now() + 5000;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'success',
                icon: '✅',
                titleText: t.modUpdated,
                bodyHtml: TemplateEngine.createTooltipGrid(true, strSteam, true, mirrorName, strMirror, exactTimeWarningHtml)
            });
        } else {
            // Estado: mirror existe mas está desatualizado em relação à Steam
            btnConfig.icon = '⚠️';
            btnConfig.text = t.downloadWarning;
            btnConfig.stateClass = TemplateEngine.THEMES.warning.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'warning',
                icon: '⚠️',
                titleText: t.modOutdated,
                bodyHtml: TemplateEngine.createTooltipGrid(true, strSteam, true, mirrorName, strMirror, exactTimeWarningHtml)
            });
        }

        container.innerHTML = TemplateEngine.createModularButton(isCard, btnConfig);

        bindTooltip(container.querySelector('.swdd-btn-group') || container.firstElementChild, tooltipHtmlStr);
        if (container.matches(':hover')) { tooltipGlobal.innerHTML = tooltipHtmlStr; refreshTooltipTimers(); tooltipGlobal.classList.add('show'); safeShowPopover(tooltipGlobal); }
    }

    // ========================================================================
    // MÓDULO 8: UI INJECTORS (Estratégias de Injeção na DOM do Steam)
    // Desacopla as diferentes partes do HTML que o script deve vigiar (Botões, Listas, etc)
    // facilitando reparações caso a Valve mude a estrutura do site.
    // ========================================================================
    function stopCardNav(el) {
        const stop = (e) => e.stopPropagation();
        ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(evt => el.addEventListener(evt, stop));
    }

    const UI_INJECTORS = [
        {
            name: "ModDetailPage",
            match: () => window.location.href.includes("/sharedfiles/filedetails") || window.location.href.includes("/workshop/filedetails"),
            inject: () => {
                const steamBtn = document.getElementById('SubscribeItemBtn');
                if (!steamBtn || steamBtn.dataset.swddInjected) return;

                const modId = new URLSearchParams(window.location.search).get('id');
                const subscribeControls = steamBtn.parentElement;

                if (modId && /^\d+$/.test(modId) && subscribeControls) {
                    steamBtn.dataset.swddInjected = 'true';
                    const gameArea = subscribeControls.parentElement;
                    if (gameArea && gameArea.classList.contains('game_area_purchase_game')) {
                        gameArea.style.display = 'flex'; gameArea.style.flexWrap = 'wrap'; gameArea.style.alignItems = 'center'; gameArea.style.justifyContent = 'space-between'; gameArea.style.gap = '15px';
                        const titleH1 = gameArea.querySelector('h1');
                        if (titleH1) { titleH1.style.float = 'none'; titleH1.style.width = 'auto'; titleH1.style.flex = '1 1 auto'; titleH1.style.margin = '0'; }
                    }

                    subscribeControls.style.float = 'none'; subscribeControls.style.display = 'flex'; subscribeControls.style.flexWrap = 'wrap'; subscribeControls.style.alignItems = 'center'; subscribeControls.style.justifyContent = 'flex-end'; subscribeControls.style.gap = '10px';
                    steamBtn.style.flexShrink = '0'; steamBtn.style.margin = '0';

                    const container = document.createElement('div');
                    container.id = 'swdd-widget-main'; container.dataset.modid = modId; container.dataset.iscard = 'false';
                    steamBtn.insertAdjacentElement('beforebegin', container);
                    stopCardNav(container); activeWidgets.add(container);
                    renderWidget(container, modId, false);
                }
            }
        },
        {
            name: "TitleLinks",
            match: () => true,
            inject: () => {
                document.querySelectorAll('h2 a[href*="?id="]').forEach(titleLink => {
                    if (titleLink.dataset.swddInjected) return;
                    const href = titleLink.getAttribute('href');
                    if (!href.includes('sharedfiles/filedetails') && !href.includes('workshop/filedetails')) return;

                    titleLink.dataset.swddInjected = 'true';
                    let modalRoot = titleLink;
                    for(let i = 0; i < 6; i++) { if(modalRoot.parentElement) modalRoot = modalRoot.parentElement; }

                    const subscribeBtn = Array.from(modalRoot.querySelectorAll('button')).find(b => b.getAttribute('data-accent-color') === 'green' || b.querySelector('.SVGIcon_Plus'));
                    if (!subscribeBtn) return;

                    const anchor = subscribeBtn.closest('.tool-tip-source') || subscribeBtn;
                    if (!anchor || !anchor.parentElement) return;
                    if (!anchor.parentElement.querySelector('.swdd-widget-container')) {
                        const modId = new URL(titleLink.href).searchParams.get('id');
                        if (modId && /^\d+$/.test(modId)) {
                            const container = document.createElement('div');
                            container.className = 'swdd-widget-container'; container.style.marginRight = '8px';
                            container.dataset.modid = modId; container.dataset.iscard = 'false';
                            stopCardNav(container); anchor.insertAdjacentElement('beforebegin', container);
                            activeWidgets.add(container); renderWidget(container, modId, false);
                        }
                    }
                });
            }
        },
        {
            name: "CardZoomIcons",
            match: () => true,
            inject: () => {
                document.querySelectorAll('.SVGIcon_MagnifyingGlass').forEach(zoomIcon => {
                    if (zoomIcon.dataset.swddInjected) return;
                    zoomIcon.dataset.swddInjected = 'true';

                    const actionRow = (zoomIcon.closest('[role="button"]') || zoomIcon.parentElement)?.parentElement;
                    if (!actionRow || actionRow.querySelector('.swdd-widget-container')) return;

                    let cardContainer = actionRow.parentElement, modLink = null;
                    for (let i = 0; i < 5; i++) {
                        if (!cardContainer) break;
                        modLink = cardContainer.querySelector('a[href*="?id="]');
                        if (modLink) break;
                        cardContainer = cardContainer.parentElement;
                    }
                    if (!modLink || modLink.parentElement.tagName === 'H2') return;
                    const href = modLink.getAttribute('href');
                    if (!href.includes('sharedfiles/filedetails') && !href.includes('workshop/filedetails')) return;

                    const modId = new URL(modLink.href).searchParams.get('id');
                    if (modId && /^\d+$/.test(modId)) {
                        actionRow.style.setProperty('opacity', '1', 'important'); actionRow.style.setProperty('visibility', 'visible', 'important');
                        actionRow.style.display = 'flex'; actionRow.style.alignItems = 'center'; actionRow.style.gap = '6px';

                        const container = document.createElement('div');
                        container.className = 'swdd-widget-container'; container.dataset.modid = modId; container.dataset.iscard = 'true';
                        stopCardNav(container); actionRow.prepend(container); activeWidgets.add(container);
                        renderWidget(container, modId, true);
                    }
                });
            }
        }
    ];

    function runInjectors() {
        if (gameUnsupported || !gameSupportConfirmed) return;
        try {
            for (const strategy of UI_INJECTORS) {
                if (strategy.match()) strategy.inject();
            }
        } catch (error) {
            console.error('[SWDD] Erro ao tentar injetar widgets da Steam:', error);
        }
    }

    let domCheckTimeout;
    const observerTarget = document.body || document.documentElement;

    // MutationObserver: Fica de olho nas alterações do site da Steam e roda os injetores automaticamente.
    const observer = new MutationObserver((mutations) => {
        let hasElementNodes = false;
        // Laço otimizado evitando alocações e iterações pesadas de Array para não gerar gargalo na navegação nativa
        for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                if (added[j].nodeType === 1) { hasElementNodes = true; break; }
            }
            if (hasElementNodes) break;
        }
        if (hasElementNodes) { clearTimeout(domCheckTimeout); domCheckTimeout = setTimeout(runInjectors, 150); }
    });

    observer.observe(observerTarget, { childList: true, subtree: true });
    runInjectors(); // Primeira injeção síncrona manual ao carregar

})();
