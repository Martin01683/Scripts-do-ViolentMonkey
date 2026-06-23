// ==UserScript==
// @name         Steam Workshop Direct Download 2
// @namespace    http://tampermonkey.net/
// @version      1.5.2
// @description  Link direto modular com suporte universal a jogos, detecção automática, i18n, fallback de banco de dados e sistema de botões modulares.
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

    // Dicionário Global de Ícones SVG
    const SVGs = {
        check: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        cross: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        loading: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="swdd-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>',
        sparkles: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>',
        search: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
        warning: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        sync: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>',
        pause: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',
        active: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"></circle></svg>',
        plus: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        block: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>',
        chat: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        plug: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"></path><path d="M9 8V2"></path><path d="M15 8V2"></path><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"></path></svg>',
        chevron: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>'
    };

    /**
     * Inicialização e Configurações de Usuário
     * Permite ao usuário alternar a visibilidade das informações detalhadas de cache no tooltip.
     */
    let showCacheInfo = GM_getValue('showCacheInfo', 1);

    GM_registerMenuCommand(showCacheInfo ? '[ - ] Ocultar Info de Cache' : '[ + ] Mostrar Info de Cache', () => {
        showCacheInfo = showCacheInfo ? 0 : 1;
        GM_setValue('showCacheInfo', showCacheInfo);
        alert('Configuração salva! A página será recarregada para aplicar as mudanças.');
        window.location.reload();
    });

    /**
     * Utilitário de Segurança (Sanitização)
     * Previne ataques de Cross-Site Scripting (XSS) convertendo caracteres especiais em entidades HTML.
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
    // ========================================================================
    const CacheManager = {
        set(key, dataObj) {
            try {
                localStorage.setItem(key, JSON.stringify(dataObj));
            } catch(e) {
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
    // ========================================================================
    const ApiClient = {
        fetch(url, options = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    data: options.data,
                    headers: options.headers,
                    timeout: options.timeout || 15000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) resolve(res);
                        else reject({ status: res.status, responseText: res.responseText });
                    },
                    onerror: () => reject(new Error('Network Error')),
                    ontimeout: () => reject(new Error('Timeout'))
                });
            });
        }
    };

    // ========================================================================
    //  MÓDULO 1: CONFIGURAÇÕES E PARSERS (Utilitários de Extração de Dados)
    // ========================================================================
    const utils = {
        addOrUpdateMod: function(resultObj, id, link, parsedDateObj) {
            const newDate = parsedDateObj ? parsedDateObj.date : null;
            const currentData = resultObj[id];
            if (!currentData || (newDate && (!currentData.date || newDate > currentData.date))) {
                resultObj[id] = {
                    link: link,
                    date: newDate,
                    exactTime: parsedDateObj ? parsedDateObj.exact : true
                };
            }
        },
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
                        exact = true;
                    } else {
                        parsedDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
                    }

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
    // MÓDULO 1.1: TEMPLATES DE BANCO DE DADOS (Arquitetura Escalável)
    // ========================================================================
    const DB_TEMPLATES = {
        skymods: (appId) => {
            const isCitiesSkylines = appId === '255710';
            return {
                id: `smods_${appId}`,
                name: "Skymods",
                type: "per_mod",
                url: (modId) => isCitiesSkylines
                    ? `https://smods.ru/?s=${modId}`
                    : `https://catalogue.smods.ru/?s=${modId}&app=${appId}`,

                cacheTime: 60 * 60 * 1000,
                parser: (responseText, modId) => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(responseText, "text/html");
                    let bestMatch = null;
                    const posts = doc.querySelectorAll('article.post');

                    for (const post of posts) {
                        const possibleDates = [];

                        post.querySelectorAll('.updated, .published, .skymods-item-date').forEach(el => {
                            const textOrAttr = el.getAttribute('datetime') || el.textContent;
                            const res = utils.parseSmodsDate(textOrAttr);
                            if (res && res.date && !isNaN(res.date.getTime())) possibleDates.push({ date: res.date, time: res.date.getTime(), exact: res.exact });
                        });

                        let fallbackDateObj = null;
                        if (possibleDates.length > 0) {
                            const maxObj = possibleDates.reduce((prev, curr) => (prev.time > curr.time) ? prev : curr);
                            fallbackDateObj = { date: new Date(maxObj.time), exact: maxObj.exact };
                        }

                        let revDateObj = null;
                        const textContent = post.textContent;
                        const revMatch = textContent.match(/Last revision:\s*([^\n\r]+)/i);
                        if (revMatch) {
                            const res = utils.parseSmodsDate(revMatch[1].trim());
                            if (res && res.date && !isNaN(res.date.getTime())) revDateObj = { date: res.date, exact: res.exact };
                        }

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
            name: "Insane DB",
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
            cacheTime: 10 * 60 * 1000,
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
    // ========================================================================
    const GAMES_CONFIG = {
        '1118520': { // Paralives
            forumUrl: "https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692",
            databases: [
                DB_TEMPLATES.insane_gh_json('paralives', 'https://raw.githubusercontent.com/AORUS834/947e26abefdb9eb0a9cd292d2ee691d9/refs/heads/main/files.json'),
                DB_TEMPLATES.insane_php('paralives', 'paralives'),
                DB_TEMPLATES.skymods('1118520')
            ]
        },
        '3450310': { // Europa Universalis V
            forumUrl: "https://cs.rin.ru/forum/viewtopic.php?f=10&t=152865",
            databases: [
                DB_TEMPLATES.insane_php('eu5', 'eu5'),
                DB_TEMPLATES.skymods('3450310')
            ]
        }
    };

    // ========================================================================
    // MÓDULO 1.3: BANCOS DE DADOS UNIVERSAIS (Modo Dinâmico / Fallback)
    // ========================================================================
    const UNIVERSAL_DATABASES = (appId) => [
        DB_TEMPLATES.skymods(appId)
    ];

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
        return (id && /^\d+$/.test(id)) ? id : null;
    }

    const currentAppId = getAppId();
    if (!currentAppId) return;

    // ========================================================================
    // MÓDULO 1.4: GERENCIADOR DE SONDAGEM E SUPORTE DINÂMICO (Game Probe)
    // ========================================================================
    const GameSupportManager = {
        CACHE_KEY_PREFIX: 'SWDD_GameSupport_',
        CACHE_TIME_UNSUPPORTED: 7 * 24 * 60 * 60 * 1000,
        CACHE_TIME_SUPPORTED:   30 * 24 * 60 * 60 * 1000,
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

        probe(appId, databases) {
            const cached = this.getStatus(appId);
            if (cached !== null) return Promise.resolve(cached);

            if (this._probePromises[appId]) return this._probePromises[appId];

            const self = this;
            const probePromise = (async () => {
                let definitiveFalse = false;
                for (const db of databases) {
                    if (!db.gameProbe) continue;
                    try {
                        const probeUrl = db.gameProbe.url + (db.gameProbe.url.includes('?') ? '&' : '?') + '_t=' + Date.now();
                        const res = await ApiClient.fetch(probeUrl, { method: 'GET' });
                        let result;
                        try { result = db.gameProbe.parser(res.responseText); }
                        catch(e) { result = null; }

                        if (result === true) {
                            self.setStatus(appId, true);
                            delete self._probePromises[appId];
                            return true;
                        } else if (result === false) {
                            definitiveFalse = true;
                        }
                    } catch(e) {
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

                delete self._probePromises[appId];
                return true;
            })();

            this._probePromises[appId] = probePromise;
            return probePromise;
        }
    };

    function resolveGameConfig(appId) {
        if (GAMES_CONFIG[appId]) return { config: GAMES_CONFIG[appId], isDynamic: false };

        const dynamicDbs = UNIVERSAL_DATABASES(appId);
        if (dynamicDbs.length === 0) return { config: null, isDynamic: true };

        const fallbackForumUrl = dynamicDbs.find(db => db.requestUrl)?.requestUrl || null;
        return { config: { forumUrl: fallbackForumUrl, databases: dynamicDbs }, isDynamic: true };
    }

    const { config: GAME, isDynamic: isGameDynamic } = resolveGameConfig(currentAppId);

    if (!GAME) return;

    if (isGameDynamic && GameSupportManager.getStatus(currentAppId) === false) return;

    const gameSupportedPromise = isGameDynamic
        ? GameSupportManager.probe(currentAppId, GAME.databases)
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
    const CACHE_TIME_STEAM_MS = 10 * 60 * 1000;
    const STEAM_NO_DATE = 'NO_DATE';
    const STEAM_FETCH_ERROR = 'FETCH_ERROR';
    const STEAM_CACHE_KEY = `${CACHE_PREFIX}Steam`;

    // ========================================================================
    // MÓDULO 2: INTERNACIONALIZAÇÃO (I18N)
    // ========================================================================
    const translations = {
        en: { checkingVersion: 'Checking Version...', dbError: 'Mirror DB Error', requestMod: 'Request Mod', modNotListed: 'Mod not listed. Click to request.', download: 'Download', downloadWarning: 'Download', modUpdated: 'MOD UP TO DATE', modOutdated: 'MOD OUTDATED', requestUpdate: 'Request Update', labelSteam: 'Steam:', labelCache: 'Cache Status:', cacheSteam: 'Steam:', justNow: 'just now', minAgo: 'min ago', steamError: 'Unverified', steamErrorTip: 'Steam API unreachable. Version not verified.', mirrorNoDate: 'Unverified Mirror', mirrorNoDateTip: 'Could not verify mirror version date.', updateCache: 'Update Cache', cacheCooldown: 'Update cache ({s}s)', idlePaused: 'Paused (Idle)', idleActive: 'Active', exactTimeWarn: 'Database missing time.<br>Precision uncertain.', modUnavailable: 'Mod Unavailable', modUnavailableTip: 'Not found in the database', checkedDbs: 'Databases checked:', bestAvailable: 'Best available version selected', requestUpdateTip: 'Request an update', noForumTip: 'No forum registered to request updates for this game.', updateCacheTip: 'Clears verification data and rechecks.' },
        pt: { checkingVersion: 'Verificando versão...', dbError: 'Erro na Base', requestMod: 'Pedir Mod', modNotListed: 'Mod não listado. Clique para pedir.', download: 'Baixar', downloadWarning: 'Baixar', modUpdated: 'MOD ATUALIZADO', modOutdated: 'MOD DESATUALIZADO', requestUpdate: 'Pedir Atualização', labelSteam: 'Steam:', labelCache: 'Status do Cache:', cacheSteam: 'Steam:', justNow: 'agora', minAgo: 'min atrás', steamError: 'Sem Verificar', steamErrorTip: 'Falha na API Steam. Versão não verificada.', mirrorNoDate: 'Mirror sem data', mirrorNoDateTip: 'Não foi possível verificar a versão do mirror.', updateCache: 'Atualizar Cache', cacheCooldown: 'Atualizar cache ({s}s)', idlePaused: 'Pausado (Inativo)', idleActive: 'Ativo', exactTimeWarn: 'Banco de dados não contem hora.<br>Precisão incerta.', modUnavailable: 'Mod Indisponível', modUnavailableTip: 'Não encontrado no banco de dados', checkedDbs: 'Bancos verificados:', bestAvailable: 'Melhor versão disponível selecionada', requestUpdateTip: 'Pedir atualização', noForumTip: 'Nenhum fórum cadastrado para solicitar atualizações deste jogo.', updateCacheTip: 'Limpa os dados de verificação e refaz a checagem.' },
        es: { checkingVersion: 'Comprobando versión...', dbError: 'Error de base', requestMod: 'Pedir mod', modNotListed: 'Mod no listado. Haz clic para pedirlo.', download: 'Descargar', downloadWarning: 'Descargar', modUpdated: 'MOD ACTUALIZADO', modOutdated: 'MOD DESACTUALIZADO', requestUpdate: 'Pedir actualización', labelSteam: 'Steam:', labelCache: 'Estado del caché:', cacheSteam: 'Steam:', justNow: 'ahora', minAgo: 'min atrás', steamError: 'No verificado', steamErrorTip: 'Fallo en la API de Steam. Versión no verificada.', mirrorNoDate: 'Mirror sin fecha', mirrorNoDateTip: 'No se pudo verificar la versión del mirror.', updateCache: 'Actualizar caché', cacheCooldown: 'Actualizar caché ({s}s)', idlePaused: 'Pausado (Inactivo)', idleActive: 'Activo', exactTimeWarn: 'Base de datos sin hora.<br>Precisión incierta.', modUnavailable: 'Mod no disponible', modUnavailableTip: 'No encontrado en la base de datos', checkedDbs: 'Bases verificadas:', bestAvailable: 'Mejor versión disponible seleccionada', requestUpdateTip: 'Pedir una actualización', noForumTip: 'No hay foro registrado para solicitar actualizaciones de este juego.', updateCacheTip: 'Borra los datos de verificación y vuelve a comprobar.' },
        fr: { checkingVersion: 'Vérification de la version...', dbError: 'Erreur de base', requestMod: 'Demander le mod', modNotListed: 'Mod non listé. Cliquez pour le demander.', download: 'Télécharger', downloadWarning: 'Télécharger', modUpdated: 'MOD À JOUR', modOutdated: 'MOD OBSOLÈTE', requestUpdate: 'Demander une mise à jour', labelSteam: 'Steam:', labelCache: 'État du cache:', cacheSteam: 'Steam:', justNow: 'à l\'instant', minAgo: 'min', steamError: 'Non vérifié', steamErrorTip: 'Erreur de l\'API Steam. Version non vérifiée.', mirrorNoDate: 'Mirror sans date', mirrorNoDateTip: 'Impossible de vérifier la version du mirror.', updateCache: 'Mettre à jour le cache', cacheCooldown: 'Mettre à jour ({s}s)', idlePaused: 'En pause (Inactif)', idleActive: 'Actif', exactTimeWarn: 'Heure manquante.<br>Précision incertaine.', modUnavailable: 'Mod indisponible', modUnavailableTip: 'Introuvable dans la base de données', checkedDbs: 'Bases vérifiées:', bestAvailable: 'Meilleure version disponible sélectionnée', requestUpdateTip: 'Demander une mise à jour', noForumTip: "Aucun forum enregistré pour demander des mises à jour de ce jeu.", updateCacheTip: 'Efface les données de vérification et relance la vérification.' },
        de: { checkingVersion: 'Version wird geprüft...', dbError: 'Datenbankfehler', requestMod: 'Mod anfragen', modNotListed: 'Mod nicht gelistet. Zum Anfragen klicken.', download: 'Herunterladen', downloadWarning: 'Herunterladen', modUpdated: 'MOD AKTUELL', modOutdated: 'MOD VERALTET', requestUpdate: 'Update anfragen', labelSteam: 'Steam:', labelCache: 'Cache-Status:', cacheSteam: 'Steam:', justNow: 'gerade eben', minAgo: 'Min. her', steamError: 'Nicht verifiziert', steamErrorTip: 'Steam API nicht erreichbar. Version nicht verifiziert.', mirrorNoDate: 'Mirror ohne Datum', mirrorNoDateTip: 'Mirror-Version konnte nicht verifiziert werden.', updateCache: 'Cache aktualisieren', cacheCooldown: 'Cache aktualisieren ({s}s)', idlePaused: 'Pausiert (Inaktiv)', idleActive: 'Aktiv', exactTimeWarn: 'Datenbank ohne Uhrzeit.<br>Präzision ungewiss.', modUnavailable: 'Mod nicht verfügbar', modUnavailableTip: 'Nicht in der Datenbank gefunden', checkedDbs: 'Überprüfte Datenbanken:', bestAvailable: 'Beste verfügbare Version ausgewählt', requestUpdateTip: 'Update anfragen', noForumTip: 'Für dieses Spiel ist kein Forum für Update-Anfragen registriert.', updateCacheTip: 'Löscht die Überprüfungsdaten und prüft erneut.' },
        it: { checkingVersion: 'Controllo versione...', dbError: 'Errore database', requestMod: 'Richiedi mod', modNotListed: 'Mod non presente. Clicca per richiederla.', download: 'Scarica', downloadWarning: 'Scarica', modUpdated: 'MOD AGGIORNATA', modOutdated: 'MOD NON AGGIORNATA', requestUpdate: 'Richiedi aggiornamento', labelSteam: 'Steam:', labelCache: 'Stato cache:', cacheSteam: 'Steam:', justNow: 'adesso', minAgo: 'min fa', steamError: 'Non verificato', steamErrorTip: 'API Steam non raggiungibile. Versione non verificata.', mirrorNoDate: 'Mirror senza data', mirrorNoDateTip: 'Impossibile verificare la versione del mirror.', updateCache: 'Aggiorna cache', cacheCooldown: 'Aggiorna cache ({s}s)', idlePaused: 'In pausa (Inattivo)', idleActive: 'Attivo', exactTimeWarn: 'Database senza ora.<br>Precisione incerta.', modUnavailable: 'Mod non disponibile', modUnavailableTip: 'Non trovato nel database', checkedDbs: 'Database controllati:', bestAvailable: 'Migliore versione disponibile selezionata', requestUpdateTip: 'Richiedi un aggiornamento', noForumTip: 'Nessun forum registrato per richiedere aggiornamenti di questo gioco.', updateCacheTip: 'Cancella i dati di verifica e ricontrolla.' },
        nl: { checkingVersion: 'Versie controleren...', dbError: 'Databasefout', requestMod: 'Mod aanvragen', modNotListed: 'Mod staat niet in de lijst. Klik om aan te vragen.', download: 'Downloaden', downloadWarning: 'Downloaden', modUpdated: 'MOD IS UP-TO-DATE', modOutdated: 'MOD IS VEROUDERD', requestUpdate: 'Update aanvragen', labelSteam: 'Steam:', labelCache: 'Cache-status:', cacheSteam: 'Steam:', justNow: 'zojuist', minAgo: 'min geleden', steamError: 'Ongecontroleerd', steamErrorTip: 'Steam API onbereikbaar. Versie niet gecontroleerd.', mirrorNoDate: 'Mirror zonder datum', mirrorNoDateTip: 'Kon de mirrorversie niet verifiëren.', updateCache: 'Cache bijwerken', cacheCooldown: 'Cache bijwerken ({s}s)', idlePaused: 'Gepauzeerd (Inactief)', idleActive: 'Actief', exactTimeWarn: 'Database mist tijd.<br>Precisie onzeker.', modUnavailable: 'Mod niet beschikbaar', modUnavailableTip: 'Niet gevonden in de database', checkedDbs: 'Gecontroleerde databases:', bestAvailable: 'Beste beschikbare versie geselecteerd', requestUpdateTip: 'Een update aanvragen', noForumTip: 'Geen forum geregistreerd om updates voor dit spel aan te vragen.', updateCacheTip: 'Wist de verificatiegegevens en controleert opnieuw.' },
        pl: { checkingVersion: 'Sprawdzanie wersji...', dbError: 'Błąd bazy', requestMod: 'Poproś o mod', modNotListed: 'Mod nie jest na liście. Kliknij, aby poprosić.', download: 'Pobierz', downloadWarning: 'Pobierz', modUpdated: 'MOD AKTUALNY', modOutdated: 'MOD NIEAKTUALNY', requestUpdate: 'Poproś o aktualizację', labelSteam: 'Steam:', labelCache: 'Stan pamięci podręcznej:', cacheSteam: 'Steam:', justNow: 'właśnie teraz', minAgo: 'min temu', steamError: 'Niezweryfikowane', steamErrorTip: 'API Steam niedostępne. Wersja niezweryfikowana.', mirrorNoDate: 'Mirror bez daty', mirrorNoDateTip: 'Nie można zweryfikować wersji mirrora.', updateCache: 'Zaktualizuj pamięć', cacheCooldown: 'Zaktualizuj pamięć ({s}s)', idlePaused: 'Wstrzymano (Bezczynny)', idleActive: 'Aktywny', exactTimeWarn: 'Brak godziny w bazie.<br>Precyzja niepewna.', modUnavailable: 'Mod niedostępny', modUnavailableTip: 'Nie znaleziono w bazie danych', checkedDbs: 'Sprawdzone bazy danych:', bestAvailable: 'Wybrano najlepszą dostępną wersję', requestUpdateTip: 'Poproś o aktualizację', noForumTip: 'Brak zarejestrowanego forum do proszenia o aktualizacje tej gry.', updateCacheTip: 'Czyści dane weryfikacji i sprawdza ponownie.' },
        ru: { checkingVersion: 'Проверка версии...', dbError: 'Ошибка базы', requestMod: 'Запросить мод', modNotListed: 'Мода нет в списке. Нажмите, чтобы запросить.', download: 'Скачать', downloadWarning: 'Скачать', modUpdated: 'МОД АКТУАЛЕН', modOutdated: 'МОД УСТАРЕЛ', requestUpdate: 'Запросить обновление', labelSteam: 'Steam:', labelCache: 'Статус кэша:', cacheSteam: 'Steam:', justNow: 'только что', minAgo: 'мин назад', steamError: 'Не проверено', steamErrorTip: 'API Steam недоступен. Версия не проверена.', mirrorNoDate: 'Зеркало без даты', mirrorNoDateTip: 'Не удалось проверить версию зеркала.', updateCache: 'Обновить кэш', cacheCooldown: 'Обновить кэш ({s}s)', idlePaused: 'Пауза (Бездействие)', idleActive: 'Активно', exactTimeWarn: 'В базе нет времени.<br>Точность не гарантируется.', modUnavailable: 'Мод недоступен', modUnavailableTip: 'Не найдено в базе данных', checkedDbs: 'Проверенные базы данных:', bestAvailable: 'Выбрана лучшая доступная версия', requestUpdateTip: 'Запросить обновление', noForumTip: 'Для этой игры не зарегистрирован форум для запроса обновлений.', updateCacheTip: 'Очищает данные проверки и выполняет проверку заново.' },
        tr: { checkingVersion: 'Sürüm kontrol ediliyor...', dbError: 'Veritabanı hatası', requestMod: 'Mod iste', modNotListed: 'Mod listede yok. İstemek için tıkla.', download: 'İndir', downloadWarning: 'İndir', modUpdated: 'MOD GÜNCEL', modOutdated: 'MOD ESKİ', requestUpdate: 'Güncelleme iste', labelSteam: 'Steam:', labelCache: 'Önbellek Durumu:', cacheSteam: 'Steam:', justNow: 'şimdi', minAgo: 'dk önce', steamError: 'Doğrulanmadı', steamErrorTip: 'Steam API\'sine ulaşılamıyor. Sürüm doğrulanmadı.', mirrorNoDate: 'Tarihsiz Mirror', mirrorNoDateTip: 'Mirror sürümü doğrulanamadı.', updateCache: 'Önbelleği Güncelle', cacheCooldown: 'Önbelleği güncelle ({s}s)', idlePaused: 'Duraklatıldı (Boşta)', idleActive: 'Aktif', exactTimeWarn: 'Veritabanında saat yok.<br>Kesinlik belirsiz.', modUnavailable: 'Mod mevcut değil', modUnavailableTip: 'Veritabanında bulunamadı', checkedDbs: 'Kontrol edilen veritabanları:', bestAvailable: 'Mevcut en iyi sürüm seçildi', requestUpdateTip: 'Güncelleme iste', noForumTip: 'Bu oyun için güncelleme istemek üzere kayıtlı forum yok.', updateCacheTip: 'Doğrulama verilerini temizler ve yeniden kontrol eder.' },
        zh: { checkingVersion: '正在检查版本...', dbError: '数据库错误', requestMod: '请求 Mod', modNotListed: 'Mod 未收录。点击请求。', download: '下载', downloadWarning: '下载', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已过期', requestUpdate: '请求更新', labelSteam: 'Steam:', labelCache: '缓存状态:', cacheSteam: 'Steam:', justNow: '刚刚', minAgo: '分钟前', steamError: '未验证', steamErrorTip: 'Steam API 无法访问。版本未验证。', mirrorNoDate: '镜像无日期', mirrorNoDateTip: '无法验证镜像版本。', updateCache: '更新缓存', cacheCooldown: '更新缓存 ({s}s)', idlePaused: '已暂停（空闲）', idleActive: '活跃', exactTimeWarn: '数据库缺少时间。<br>精度不确定。', modUnavailable: '模组不可用', modUnavailableTip: '数据库中未找到', checkedDbs: '已检查的数据库:', bestAvailable: '已选择最佳可用版本', requestUpdateTip: '请求更新', noForumTip: '此游戏没有注册可请求更新的论坛。', updateCacheTip: '清除验证数据并重新检查。' },
        zh_tw: { checkingVersion: '正在檢查版本...', dbError: '資料庫錯誤', requestMod: '請求 Mod', modNotListed: 'Mod 未收錄。點擊請求。', download: '下載', downloadWarning: '下載', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已過期', requestUpdate: '請求更新', labelSteam: 'Steam:', labelCache: '快取狀態:', cacheSteam: 'Steam:', justNow: '剛剛', minAgo: '分鐘前', steamError: '未驗證', steamErrorTip: 'Steam API 無法訪問。版本未驗證。', mirrorNoDate: '鏡像無日期', mirrorNoDateTip: '無法驗證鏡像版本。', updateCache: '更新快取', cacheCooldown: '更新快取 ({s}s)', idlePaused: '已暫停（閒置）', idleActive: '活躍', exactTimeWarn: '資料庫缺少時間。<br>精度不確定。', modUnavailable: '模組不可用', modUnavailableTip: '資料庫中未找到', checkedDbs: '已檢查的資料庫:', bestAvailable: '已選擇最佳可用版本', requestUpdateTip: '請求更新', noForumTip: '此遊戲沒有註冊可請求更新的論壇。', updateCacheTip: '清除驗證資料並重新檢查。' },
        ja: { checkingVersion: 'バージョン確認中...', dbError: 'DBエラー', requestMod: 'Modをリクエスト', modNotListed: 'Modが未登録です。クリックしてリクエスト。', download: 'ダウンロード', downloadWarning: 'ダウンロード', modUpdated: 'MODは最新です', modOutdated: 'MODは古い可能性があります', requestUpdate: '更新をリクエスト', labelSteam: 'Steam:', labelCache: 'キャッシュ状態:', cacheSteam: 'Steam:', justNow: 'たった今', minAgo: '分前', steamError: '未検証', steamErrorTip: 'Steam APIにアクセスできません。バージョン未検証。', mirrorNoDate: '日付のないミラー', mirrorNoDateTip: 'ミラーのバージョンを確認できませんでした。', updateCache: 'キャッシュを更新', cacheCooldown: 'キャッシュ更新 ({s}s)', idlePaused: '一時停止（アイドル）', idleActive: 'アクティブ', exactTimeWarn: '時間がありません。<br>精度は不確実です。', modUnavailable: 'Mod利用不可', modUnavailableTip: 'データベースに見つかりません', checkedDbs: '確認したデータベース:', bestAvailable: '利用可能な最適なバージョンを選択しました', requestUpdateTip: '更新をリクエスト', noForumTip: 'このゲームには更新をリクエストできる登録済みフォーラムがありません。', updateCacheTip: '検証データを消去して再チェックします。' },
        ko: { checkingVersion: '버전 확인 중...', dbError: 'DB 오류', requestMod: '모드 요청', modNotListed: '모드가 목록에 없습니다. 클릭해서 요청하세요.', download: '다운로드', downloadWarning: '다운로드', modUpdated: 'MOD 최신 상태', modOutdated: 'MOD 오래됨', requestUpdate: '업데이트 요청', labelSteam: 'Steam:', labelCache: '캐시 상태:', cacheSteam: 'Steam:', justNow: '방금', minAgo: '분 전', steamError: '확인 안 됨', steamErrorTip: 'Steam API에 접근할 수 없습니다. 버전이 확인되지 않았습니다.', mirrorNoDate: '날짜 없는 미러', mirrorNoDateTip: '미러 버전을 확인할 수 없습니다.', updateCache: '캐시 업데이트', cacheCooldown: '캐시 업데이트 ({s}s)', idlePaused: '일시 정지 (유휴)', idleActive: '활성', exactTimeWarn: '데이터베이스에 시간이 없습니다.<br>정확도 불확실.', modUnavailable: '모드 사용 불가', modUnavailableTip: '데이터베이스에서 찾을 수 없습니다', checkedDbs: '확인된 데이터베이스:', bestAvailable: '가장 적합한 버전을 선택했습니다', requestUpdateTip: '업데이트 요청', noForumTip: '이 게임에 대해 업데이트를 요청할 수 있는 등록된 포럼이 없습니다.', updateCacheTip: '확인 데이터를 지우고 다시 확인합니다.' }
    };

    const languageAliases = {
        'pt-br': 'pt', 'pt-pt': 'pt', 'es-es': 'es', 'es-419': 'es',
        'fr-fr': 'fr', 'de-de': 'de', 'it-it': 'it', 'nl-nl': 'nl',
        'pl-pl': 'pl', 'ru-ru': 'ru', 'tr-tr': 'tr',
        'zh-cn': 'zh', 'zh-sg': 'zh', 'zh-hans': 'zh',
        'zh-tw': 'zh_tw', 'zh-hk': 'zh_tw', 'zh-hant': 'zh_tw',
        'ja-jp': 'ja', 'ko-kr': 'ko',
    };

    function getScriptLanguage() {
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
    // ========================================================================
    function applyLanguageChange() {
        const newLang = getScriptLanguage();
        const newDict = translations[newLang];
        if (!newDict || newDict === t) return;

        t = newDict;

        if (dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
        }
        if (tooltipGlobal.classList.contains('show')) {
            clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal);
        }

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

    window.addEventListener('languagechange', applyLanguageChange);

    // ========================================================================
    // MÓDULO 3: TEMPLATE ENGINE (Criação de Interface e Estilização)
    // ========================================================================
    const TemplateEngine = {
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
            return `<a class="swdd-custom-btn ${cClass} swdd-state-loading"><span class="swdd-btn-icon">${SVGs.loading}</span> <span class="swdd-btn-text">${escapeHTML(t.checkingVersion)}</span></a>`;
        },

        createModularButton(isCard, config) {
            const cClass = isCard ? 'swdd-custom-btn-compact' : '';
            const isBlocked = config.disabled || (config.timerExp && config.timerExp > Date.now());

            const hrefAttr = (config.link && !isBlocked) ? `href="${escapeHTML(config.link)}" rel="noopener noreferrer"` : '';
            const origLinkData = config.link ? `data-orig-link="${escapeHTML(config.link)}"` : '';

            const isErrorState = config.stateClass === 'swdd-state-error';
            const blockStyle = isBlocked ? (isErrorState ? 'cursor: not-allowed;' : 'cursor: not-allowed; filter: grayscale(100%) opacity(0.6);') : '';

            const timerData = config.timerExp ? `data-timer-exp="${config.timerExp}"` : '';
            const originalTextData = config.text ? `data-orig-text="${escapeHTML(config.text)}"` : '';
            const iconHtml = config.icon ? `<span class="swdd-btn-icon">${config.icon}</span> ` : '';

            const titleAttr = config.tooltip ? `title="${escapeHTML(config.tooltip)}"` : '';

            let html = `
                <div class="swdd-btn-group" ${titleAttr}>
                    <a ${hrefAttr} ${origLinkData} class="swdd-custom-btn ${cClass} ${config.stateClass} swdd-btn-main" style="${blockStyle}" ${timerData} ${originalTextData}>
                        ${iconHtml}<span class="swdd-btn-text">${escapeHTML(config.text)}</span>
                    </a>`;

            if (config.dropdown && config.dropdown.length > 0) {
                const validItems = config.dropdown.filter(item => item.condition !== false);
                if (validItems.length > 0) {
                    const dropdownData = escapeHTML(JSON.stringify(validItems));
                    html += `<button class="swdd-custom-btn ${cClass} ${config.stateClass} swdd-btn-arrow" data-dropdown-items="${dropdownData}"><span style="display:flex;">${SVGs.chevron}</span></button>`;
                }
            }

            html += `</div>`;
            return html;
        },

        createTooltipGrid(showSteam, strSteam, showMirror, dbName, strMirror, exactTimeWarnHtml, infoLabel = null, infoValue = null) {
            let gridHtml = `<div style="display: grid; grid-template-columns: max-content 1fr; column-gap: 8px; row-gap: 4px; margin: 6px 0;">`;
            if (showSteam) {
                gridHtml += `<span class="swdd-tooltip-label" style="margin:0; min-width:auto;">${escapeHTML(t.labelSteam)}</span><span class="swdd-tooltip-value">${escapeHTML(strSteam)}</span>`;
            }
            if (showMirror) {
                gridHtml += `<span class="swdd-tooltip-label" style="margin:0; min-width:auto;">${escapeHTML(dbName)}:</span><span class="swdd-tooltip-value">${escapeHTML(strMirror)}</span>`;
            }
            if (infoLabel && infoValue) {
                gridHtml += `<span class="swdd-tooltip-label" style="margin:0; min-width:auto;">${escapeHTML(infoLabel)}</span><span class="swdd-tooltip-value">${escapeHTML(infoValue)}</span>`;
            }
            gridHtml += `</div>`;
            return gridHtml + exactTimeWarnHtml;
        },

        createDbCheckNotice(consultedDBs, showBestAvailable = true, needsTopSeparator = true) {
            if (!consultedDBs || consultedDBs.length === 0) return '';

            const dbNamesListHtml = consultedDBs
                .map(db => {
                    const themeObj = this.THEMES[db.theme] || this.THEMES.error;
                    const dotColor = themeObj.color;
                    const dotHtml = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${dotColor}; margin-right: 6px; box-shadow: 0 0 3px ${dotColor}60;"></span>`;
                    return `<span style="display: inline-flex; align-items: center; font-size: 11.5px; color: #E2E8F0; font-weight: 500; white-space: nowrap;">${dotHtml}${escapeHTML(db.name)}</span>`;
                })
                .join('');

            const txtChecked = t.checkedDbs || 'Bancos verificados:';

            let bestAvailableHtml = '';
            if (showBestAvailable) {
                const txtBest = t.bestAvailable || 'Melhor versão disponível selecionada';
                const successColor = this.THEMES.success.color;
                bestAvailableHtml = `
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 11.5px; color: ${successColor};">
                    <span style="display:flex; font-size:14px;">${SVGs.sparkles}</span>
                    <span style="font-weight: 500;">${escapeHTML(txtBest)}</span>
                </div>`;
            }

            const separatorStyle = needsTopSeparator
                ? 'margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;'
                : 'margin-top: 0;';

            return `
            <div class="swdd-tooltip-row" style="${separatorStyle}">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 11.5px; color: #8f98a0;">
                    <span style="display:flex; font-size:12px;">${SVGs.search}</span>
                    <span>${escapeHTML(txtChecked)}</span>
                </div>
                <div style="display: flex; flex-direction: row; flex-wrap: wrap; row-gap: 5px; column-gap: 14px; margin-left: 16px;">
                    ${dbNamesListHtml}
                </div>${bestAvailableHtml}
            </div>`;
        },

        createCacheBlock(creationTimeSteam, steamCacheExp, consultedDBs) {
            if (!showCacheInfo) return '';

            const strSteamCache  = this.formatCacheAge(Date.now() - creationTimeSteam);
            const strSteamReset  = this.formatTimeLeft(steamCacheExp);

            let dbCacheRowsHtml = '';
            for (const cdb of consultedDBs) {
                if (cdb.error) {
                    dbCacheRowsHtml += `<span class="swdd-tooltip-value" style="display:flex; align-items:center; gap:4px; font-size:11px; color:#ff6b6b;">${escapeHTML(cdb.name)}: <span style="display:flex;">${SVGs.warning}</span> ${escapeHTML(t.dbError)}</span>`;
                } else {
                    const strMirrorCache = this.formatCacheAge(Date.now() - cdb.creation);
                    const strMirrorReset = this.formatTimeLeft(cdb.exp);
                    dbCacheRowsHtml += `<span class="swdd-tooltip-value" style="display:flex; align-items:center; gap:4px; font-size:11px; color:#8f98a0;">${escapeHTML(cdb.name)}: <span class="swdd-cache-age" data-created="${cdb.creation}">${escapeHTML(strMirrorCache)}</span> (<span style="display:flex;">${SVGs.sync}</span> <span class="swdd-cache-countdown" data-exp="${cdb.exp}">${escapeHTML(strMirrorReset)}</span>)</span>`;
                }
            }

            return `
            <div class="swdd-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <span>${escapeHTML(t.labelCache)}</span><span class="swdd-idle-status" style="font-size:11px; font-weight:normal;"></span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span class="swdd-tooltip-value" style="display:flex; align-items:center; gap:4px; font-size:11px; color:#8f98a0;">${escapeHTML(t.cacheSteam)} <span class="swdd-cache-age" data-created="${creationTimeSteam}">${escapeHTML(strSteamCache)}</span> (<span style="display:flex;">${SVGs.sync}</span> <span class="swdd-cache-countdown" data-exp="${steamCacheExp}">${escapeHTML(strSteamReset)}</span>)</span>
                    ${dbCacheRowsHtml}
                </div>
            </div>`;
        },

        createTooltip(config) {
            const titleHtml = `<div class="swdd-tooltip-title swdd-tooltip-${config.stateClass}"><span style="display:flex; margin-right:4px;">${config.icon}</span> ${escapeHTML(config.titleText)}</div>`;
            const bodyHtml = config.bodyHtml || '';

            const dbCheckHtml = (config.showDbCheck !== false) ? this.createDbCheckNotice(config.consultedDBs, config.showBestAvailable !== false, !!bodyHtml) : '';
            const cacheHtml = (config.showCache !== false) ? this.createCacheBlock(config.creationTimeSteam, config.steamCacheExp, config.consultedDBs) : '';

            return `${titleHtml}${bodyHtml}${dbCheckHtml}${cacheHtml}`;
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

        .swdd-btn-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .swdd-dropdown-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .swdd-spin { animation: swdd-spin 1.2s linear infinite; }
        @keyframes swdd-spin { 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    // ========================================================================
    // MÓDULO 4: EVENTOS NATIVOS E INTERFACE DE USUÁRIO (Event Delegation)
    // ========================================================================

    let popoverHideTimeouts = new Map();

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
            if (iconSpan) iconSpan.innerHTML = SVGs.loading;
            if (textSpan) textSpan.innerHTML = escapeHTML(t.cacheCooldown.replace('{s}', s));
        } else {
            cacheBtn.style.cursor = 'pointer';
            cacheBtn.style.opacity = '1';
            if (iconSpan) iconSpan.innerHTML = SVGs.sync;
            if (textSpan) textSpan.innerHTML = escapeHTML(t.updateCache);
        }
    }

    document.addEventListener('click', (e) => {
        const clearCacheBtn = e.target.closest('#swdd-clear-cache');
        if (clearCacheBtn) {
            e.preventDefault(); e.stopPropagation();
            if (Date.now() >= globalCacheCooldown) {
                setGlobalCacheCooldown(30000);

                CacheManager.remove(STEAM_CACHE_KEY);
                CacheManager.remove(GameSupportManager.CACHE_KEY_PREFIX + currentAppId);

                steamCallbacks.forEach((callbacks, id) => {
                    steamDateCache[id] = STEAM_FETCH_ERROR;
                    callbacks.forEach(cb => cb());
                });

                steamDateCache = {};
                localSteamCache = {};

                pendingSteamIDs.clear();
                steamCallbacks.clear();

                GAME.databases.forEach(db => {
                    if (db.type === 'per_mod') {
                        CacheManager.clearByPrefix(`${CACHE_PREFIX}DB_${db.id}_`);
                        memoryDBCache[db.id] = {};
                    } else {
                        CacheManager.remove(`${CACHE_PREFIX}DB_${db.id}`);
                        if (memoryDBCache[db.id]) memoryDBCache[db.id].exp = 0;
                    }
                });

                updateDropdownCacheText();
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
                if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }

                for (const container of activeWidgets) {
                    if (!document.documentElement.contains(container)) {
                        activeWidgets.delete(container); continue;
                    }
                    if (container.dataset.modid) renderWidget(container, container.dataset.modid, container.dataset.iscard === 'true');
                }
            }
            return;
        }

        const scriptLink = e.target.closest('a.swdd-custom-btn, a.swdd-bg-link');
        if (scriptLink && scriptLink.hasAttribute('href') && e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (typeof GM_openInTab === 'function') GM_openInTab(scriptLink.href, { active: false, insert: true });
            else window.open(scriptLink.href, '_blank', 'noopener');

            if (scriptLink.classList.contains('swdd-bg-link') && dropdownGlobal.classList.contains('show')) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
                if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }
            }
            return;
        }

        const arrowBtn = e.target.closest('.swdd-btn-arrow');
        if (arrowBtn) {
            e.preventDefault(); e.stopPropagation();
            if (dropdownGlobal.classList.contains('show') && dropdownGlobal.lastArrow === arrowBtn) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
                if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }
                return;
            }

            const dialogParent = arrowBtn.closest('dialog');
            const rect = arrowBtn.getBoundingClientRect();
            let topPos = rect.bottom, leftPos = rect.right - 220;

            if (dialogParent) dialogParent.appendChild(dropdownGlobal); else document.body.appendChild(dropdownGlobal);
            if (typeof dropdownGlobal.showPopover !== 'function' && dialogParent) {
                const style = window.getComputedStyle(dialogParent);
                if (style.transform !== 'none') { const dialogRect = dialogParent.getBoundingClientRect(); topPos -= dialogRect.top; leftPos -= dialogRect.left; }
            }

            const dropdownData = arrowBtn.getAttribute('data-dropdown-items');
            let items = [];
            try { items = JSON.parse(dropdownData); } catch(err) {}

            let menuHtml = '';
            items.forEach(item => {
                const isBlocked = item.disabled === true;
                const blockStyle = isBlocked ? 'cursor: not-allowed; opacity: 0.4; text-decoration: none;' : 'cursor: pointer;';
                const idAttr = item.action === 'clearCache' ? 'id="swdd-clear-cache"' : '';
                const hrefAttr = (!isBlocked && item.link) ? `href="${escapeHTML(item.link)}" rel="noopener noreferrer"` : '';
                const classAttr = `class="${item.action !== 'clearCache' && !isBlocked ? 'swdd-bg-link' : ''}"`;
                const tooltipDataAttr = item.tooltip ? `data-swdd-tooltip="${escapeHTML(item.tooltip)}"` : '';

                menuHtml += `
                    <a ${idAttr} ${hrefAttr} ${classAttr} ${tooltipDataAttr} style="${blockStyle}">
                        ${item.icon ? `<span class="swdd-dropdown-icon">${item.icon}</span> ` : ''}<span class="swdd-dropdown-text">${escapeHTML(item.text)}</span>
                    </a>
                `;
            });

            dropdownGlobal.innerHTML = menuHtml;
            updateDropdownCacheText();
            clearStaleDropdownSelection();

            dropdownGlobal.style.top = topPos + 'px'; dropdownGlobal.style.left = leftPos + 'px';
            dropdownGlobal.classList.add('show'); safeShowPopover(dropdownGlobal); dropdownGlobal.lastArrow = arrowBtn;

            dropdownGlobal.querySelectorAll('a[data-swdd-tooltip]').forEach(link => {
                const tooltipText = link.getAttribute('data-swdd-tooltip');
                const tooltipHtml = `<div class="swdd-tooltip-row" style="white-space: normal !important; max-width: 220px; line-height: 1.4;">${escapeHTML(tooltipText)}</div>`;
                bindTooltip(link, tooltipHtml);
            });

            return;
        }

        if (!e.target.closest('.swdd-global-dropdown') && dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; clearStaleDropdownSelection();
            if (tooltipGlobal.classList.contains('show')) { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); }
        }
    }, true);

    window.addEventListener('scroll', () => {
        if (dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show');
            safeHidePopover(dropdownGlobal);
            dropdownGlobal.lastArrow = null;
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
    let hoverTimer;

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
            idleStatusEl.innerHTML = (isIdleNow() || wasIdleRecently)
                ? `<span style="color:#F59E0B; display:flex; align-items:center; gap:4px;">${SVGs.pause} ${escapeHTML(t.idlePaused)}</span>`
                : `<span style="color:#A3E33B; display:flex; align-items:center; gap:4px;">${SVGs.active} ${escapeHTML(t.idleActive)}</span>`;
        }
    }

    // ========================================================================
    // MÓDULO 5: OCIOSIDADE (IDLE) E SINCRONIZAÇÃO ENTRE ABAS E TIMERS
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

        if (e.key && e.key.startsWith(`${CACHE_PREFIX}DB_`) && e.newValue === null) {
            GAME.databases.forEach(db => {
                if (db.type === 'per_mod') {
                    if (e.key.startsWith(`${CACHE_PREFIX}DB_${db.id}_`)) {
                        const modId = e.key.replace(`${CACHE_PREFIX}DB_${db.id}_`, '');
                        if (memoryDBCache[db.id] && memoryDBCache[db.id][modId]) memoryDBCache[db.id][modId].exp = 0;
                        globalCacheCleared = true;
                    }
                } else {
                    if (e.key === `${CACHE_PREFIX}DB_${db.id}`) {
                        if (memoryDBCache[db.id]) memoryDBCache[db.id].exp = 0;
                        globalCacheCleared = true;
                    }
                }
            });
        }
    });

    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    let lastActivityTime = Date.now();
    let activityTimeout; let wasIdleRecently = false;

    function isIdleNow() { return (Date.now() - lastActivityTime) > IDLE_TIMEOUT_MS; }

    function resetActivity() {
        if (!activityTimeout) {
            const now = Date.now();
            if (isIdleNow()) { wasIdleRecently = true; setTimeout(() => { wasIdleRecently = false; refreshTooltipTimers(); }, 4000); }
            lastActivityTime = now;
            activityTimeout = setTimeout(() => { activityTimeout = null; }, 1000);
        }
    }
    ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(evt => window.addEventListener(evt, resetActivity, { passive: true }));

    const activeWidgets = new Set();

    setInterval(() => {
        if (dropdownGlobal.classList.contains('show')) updateDropdownCacheText();
        if (tooltipGlobal.classList.contains('show')) refreshTooltipTimers();

        document.querySelectorAll('.swdd-btn-main[data-timer-exp]').forEach(btn => {
            const exp = parseInt(btn.getAttribute('data-timer-exp'), 10);
            const now = Date.now();
            const textSpan = btn.querySelector('.swdd-btn-text');
            const origText = btn.getAttribute('data-orig-text');

            if (exp > now) {
                const left = Math.ceil((exp - now) / 1000);
                if (textSpan) textSpan.innerText = `${origText} (${left}s)`;
            } else {
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

        if (!document.hidden && !isIdleNow()) {
            const now = Date.now();
            const forceUpdate = globalCacheCleared;
            if (forceUpdate) globalCacheCleared = false;

            for (const container of activeWidgets) {
                if (!document.documentElement.contains(container)) { activeWidgets.delete(container); continue; }

                const modId = container.dataset.modid;
                if (modId) {
                    const steamExpired = localSteamCache[modId] ? (now >= localSteamCache[modId].exp) : false;
                    if (steamExpired) delete steamDateCache[modId];

                    let dbExpired = false;
                    if (container.dataset.activeDbIds) {
                        try {
                            const dbIds = JSON.parse(container.dataset.activeDbIds);
                            for (const dbId of dbIds) {
                                const dbConfig = GAME.databases.find(d => d.id === dbId);
                                if (dbConfig) {
                                    if (dbConfig.type === 'per_mod') {
                                        if (memoryDBCache[dbId] && memoryDBCache[dbId][modId] && now >= memoryDBCache[dbId][modId].exp) { dbExpired = true; break; }
                                    } else {
                                        if (memoryDBCache[dbId] && now >= memoryDBCache[dbId].exp) { dbExpired = true; break; }
                                    }
                                }
                            }
                        } catch(e) {}
                    }

                    if ((dbExpired || steamExpired || forceUpdate) && !container.querySelector('.swdd-state-loading')) {
                        renderWidget(container, modId, container.dataset.iscard === 'true');
                    }
                }
            }
        }
    }, 1000);

    function bindTooltip(element, htmlContent) {
        let lastX = 0, lastY = 0;
        const updatePos = () => {
            let left = lastX + 15, top = lastY + 15;
            const tooltipWidth = tooltipGlobal.offsetWidth || 200, tooltipHeight = tooltipGlobal.offsetHeight || 100;
            if (left + tooltipWidth > window.innerWidth - 10) left = lastX - tooltipWidth - 15;
            if (top + tooltipHeight > window.innerHeight - 10) top = lastY - tooltipHeight - 15;

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
                const dialogParent = element.closest('dialog');
                if (dialogParent) dialogParent.appendChild(tooltipGlobal); else document.body.appendChild(tooltipGlobal);
                tooltipGlobal.innerHTML = htmlContent;
                refreshTooltipTimers();
                tooltipGlobal.classList.add('show'); safeShowPopover(tooltipGlobal); updatePos();
            }, 300);
        });

        element.addEventListener('mousemove', (e) => { lastX = e.clientX; lastY = e.clientY; if (tooltipGlobal.classList.contains('show')) updatePos(); });
        element.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal, 100); });
    }

    // ========================================================================
    // MÓDULO 6: API CONTROLLERS (Gerenciamento Lógico de Consultas Steam e Bancos)
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
                if (steamCallbacks.has(id)) { steamCallbacks.get(id).forEach(cb => cb()); steamCallbacks.delete(id); }
            });

            saveSteamCache();
            isFetchingBatch = false; triggerSteamFetch();

        } catch (error) {
            handleSteamError(idsToFetch);
        }
    }

    function getSteamDateAsync(modId) {
        return new Promise(resolve => {
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

    const memoryDBCache = {};
    const pendingDBRequests = {};

    async function fetchDatabaseAsync(dbConfig, modId = null) {
        const cacheKey = dbConfig.type === 'per_mod' ? `${CACHE_PREFIX}DB_${dbConfig.id}_${modId}` : `${CACHE_PREFIX}DB_${dbConfig.id}`;
        const requestKey = dbConfig.type === 'per_mod' ? `${dbConfig.id}_${modId}` : dbConfig.id;
        const now = Date.now();

        if (!memoryDBCache[dbConfig.id]) memoryDBCache[dbConfig.id] = {};

        if (dbConfig.type === 'per_mod') {
            if (memoryDBCache[dbConfig.id][modId] && memoryDBCache[dbConfig.id][modId].exp > now) return memoryDBCache[dbConfig.id][modId];
        } else {
            if (memoryDBCache[dbConfig.id] && memoryDBCache[dbConfig.id].exp > now) return memoryDBCache[dbConfig.id];
        }

        if (pendingDBRequests[requestKey]) return pendingDBRequests[requestKey];

        const stored = CacheManager.get(cacheKey);
        if (stored && stored.exp > now) {
            if (dbConfig.type === 'per_mod' && stored.data) {
                if (stored.data.date) stored.data.date = new Date(stored.data.date);
                if (stored.data.fallbackDate) stored.data.fallbackDate = new Date(stored.data.fallbackDate);
                memoryDBCache[dbConfig.id][modId] = stored;
            } else if (stored.data) {
                for(let k in stored.data) {
                    if(stored.data[k].date) stored.data[k].date = new Date(stored.data[k].date);
                    if(stored.data[k].fallbackDate) stored.data[k].fallbackDate = new Date(stored.data[k].fallbackDate);
                }
                memoryDBCache[dbConfig.id] = stored;
            }
            return stored;
        }

        const requestPromise = (async () => {
            try {
                const targetUrl = dbConfig.type === 'per_mod' ? dbConfig.url(modId) : dbConfig.url;
                const finalUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + '_t=' + now;
                const res = await ApiClient.fetch(finalUrl);

                const parsedData = dbConfig.type === 'per_mod' ? dbConfig.parser(res.responseText, modId) : dbConfig.parser(res.responseText);
                const cacheObj = { data: parsedData, exp: now + dbConfig.cacheTime, creation: now };

                if (dbConfig.type === 'per_mod') memoryDBCache[dbConfig.id][modId] = cacheObj;
                else memoryDBCache[dbConfig.id] = cacheObj;

                CacheManager.set(cacheKey, cacheObj);
                delete pendingDBRequests[requestKey];
                return cacheObj;
            } catch (e) {
                console.error(`[SWDD] Fallback Error (DB: ${dbConfig.name}):`, e);
                delete pendingDBRequests[requestKey];
                return null;
            }
        })();

        pendingDBRequests[requestKey] = requestPromise;
        return requestPromise;
    }

    async function getBestModFromDatabases(modId, dateSteam) {
        const consultedDBs = [];
        let bestOutdated = null;

        for (const dbConfig of GAME.databases) {
            let dbCacheObj = await fetchDatabaseAsync(dbConfig, dbConfig.type === 'per_mod' ? modId : null);
            let modData = null;

            if (dbCacheObj && dbCacheObj.data) {
                modData = dbConfig.type === 'per_mod' ? dbCacheObj.data : dbCacheObj.data[modId];
            }

            let dbTheme = 'error';
            let isUpdated = false;

            if (!dbCacheObj) {
                dbTheme = 'error';
            } else if (modData) {
                let dateMirror = modData.date;

                if (dateSteam === STEAM_NO_DATE || dateSteam === STEAM_FETCH_ERROR) {
                    isUpdated = true;
                } else if (!dateMirror) {
                    isUpdated = false;
                } else if (utils.isUpToDate(dateMirror, dateSteam)) {
                    isUpdated = true;
                } else if (modData.fallbackDate && utils.isUpToDate(modData.fallbackDate, dateSteam)) {
                    isUpdated = true;
                    modData = { ...modData, date: modData.fallbackDate, exactTime: modData.fallbackExact };
                }

                dbTheme = isUpdated ? 'success' : 'warning';
            }

            consultedDBs.push({
                id: dbConfig.id,
                name: dbConfig.name,
                exp: dbCacheObj ? dbCacheObj.exp : 0,
                creation: dbCacheObj ? dbCacheObj.creation : 0,
                error: !dbCacheObj,
                theme: dbTheme
            });

            if (modData) {
                if (isUpdated) {
                    return { dbId: dbConfig.id, dbName: dbConfig.name, modData: modData, exp: dbCacheObj.exp, creation: dbCacheObj.creation, consultedDBs: consultedDBs };
                } else {
                    let dateMirror = modData.date;
                    if (!bestOutdated || !bestOutdated.modData.date || (dateMirror && dateMirror > bestOutdated.modData.date)) {
                        bestOutdated = { dbId: dbConfig.id, dbName: dbConfig.name, modData: modData, exp: dbCacheObj.exp, creation: dbCacheObj.creation };
                    }
                }
            }
        }

        if (bestOutdated) { bestOutdated.consultedDBs = consultedDBs; return bestOutdated; }
        return { consultedDBs: consultedDBs, notFound: true };
    }

    // ========================================================================
    // MÓDULO 7: RENDERIZAÇÃO LÓGICA DO WIDGET (Usando Sistema Modular)
    // ========================================================================
    async function renderWidget(container, modId, isCard) {
        container.innerHTML = TemplateEngine.createLoadingBtn(isCard);

        const isGameSupported = await gameSupportedPromise;
        if (!isGameSupported) { container.remove(); activeWidgets.delete(container); return; }

        const dateSteam = await getSteamDateAsync(modId);
        const dbResult = await getBestModFromDatabases(modId, dateSteam);

        const steamCacheExp = localSteamCache[modId] ? localSteamCache[modId].exp : 0;
        const creationTimeSteam = steamCacheExp ? (steamCacheExp - CACHE_TIME_STEAM_MS) : Date.now();
        const consultedDBs = dbResult ? dbResult.consultedDBs : [];

        const buildTooltip = (cfg) => TemplateEngine.createTooltip({
            consultedDBs,
            creationTimeSteam,
            steamCacheExp,
            ...cfg
        });

        if (!dbResult || dbResult.notFound) {
            const btnConfig = {
                icon: GAME.forumUrl ? SVGs.plus : SVGs.block,
                text: GAME.forumUrl ? t.requestMod : t.modUnavailable,
                link: GAME.forumUrl,
                stateClass: TemplateEngine.THEMES.error.stateClass,
                disabled: !GAME.forumUrl,
                dropdown: [
                    {
                        text: t.updateCache,
                        icon: SVGs.sync,
                        action: 'clearCache',
                        condition: true,
                        tooltip: t.updateCacheTip
                    }
                ]
            };

            const tooltipHtmlStr = buildTooltip({
                stateClass: 'error',
                icon: GAME.forumUrl ? SVGs.cross : SVGs.block,
                titleText: GAME.forumUrl ? t.modNotListed : t.modUnavailableTip,
                showBestAvailable: false
            });

            container.innerHTML = TemplateEngine.createModularButton(isCard, btnConfig);

            bindTooltip(container.firstElementChild, tooltipHtmlStr);
            if (container.matches(':hover')) { tooltipGlobal.innerHTML = tooltipHtmlStr; refreshTooltipTimers(); tooltipGlobal.classList.add('show'); safeShowPopover(tooltipGlobal); }
            return;
        }

        const { dbName, modData } = dbResult;
        const dateMirror = modData.date;
        const exactTime = modData.exactTime !== false;

        container.dataset.activeDbIds = JSON.stringify(consultedDBs.map(db => db.id));

        let strMirror = 'N/A';
        if (dateMirror) strMirror = exactTime ? dateMirror.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : dateMirror.toLocaleString([], {dateStyle: 'short'});
        const strSteam  = (dateSteam && dateSteam !== STEAM_NO_DATE && dateSteam !== STEAM_FETCH_ERROR) ? dateSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';

        let safeLink = '#';
        try { if (modData.link) { const parsedUrl = new URL(modData.link); if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') safeLink = parsedUrl.href; } } catch(e) {}

        let exactTimeWarningHtml = '';
        if (!exactTime && dateMirror && dateSteam && dateSteam !== STEAM_NO_DATE && dateSteam !== STEAM_FETCH_ERROR) {
            const isSameDay = dateMirror.getFullYear() === dateSteam.getFullYear() && dateMirror.getMonth() === dateSteam.getMonth() && dateMirror.getDate() === dateSteam.getDate();
            if (isSameDay) {
                exactTimeWarningHtml = `<div style="color: #F59E0B; font-size: 11px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #3d4450; white-space: normal !important; line-height: 1.4; display:flex; gap:4px;"><span style="flex-shrink:0; display:flex;">${SVGs.warning}</span> <span>${t.exactTimeWarn}</span></div>`;
            }
        }

        const isOutdated = !!dateMirror && dateSteam !== STEAM_FETCH_ERROR && !utils.isUpToDate(dateMirror, dateSteam);

        let tooltipHtmlStr;
        let btnConfig = {
            link: safeLink,
            dropdown: [
                {
                    text: t.updateCache,
                    icon: SVGs.sync,
                    action: 'clearCache',
                    condition: true,
                    tooltip: t.updateCacheTip
                },
                {
                    text: t.requestUpdate,
                    icon: SVGs.chat,
                    link: GAME.forumUrl,
                    condition: isOutdated,
                    disabled: !GAME.forumUrl,
                    tooltip: GAME.forumUrl ? t.requestUpdateTip : t.noForumTip
                }
            ]
        };

        if (dateSteam === STEAM_FETCH_ERROR) {
            btnConfig.icon = SVGs.warning;
            btnConfig.text = t.steamError;
            btnConfig.stateClass = TemplateEngine.THEMES.error.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'error',
                icon: SVGs.plug,
                titleText: t.steamErrorTip,
                bodyHtml: TemplateEngine.createTooltipGrid(false, strSteam, true, dbName, strMirror, exactTimeWarningHtml)
            });
        } else if (!dateMirror) {
            btnConfig.icon = SVGs.warning;
            btnConfig.text = t.downloadWarning;
            btnConfig.stateClass = TemplateEngine.THEMES.warning.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'warning',
                icon: SVGs.warning,
                titleText: t.mirrorNoDate,
                bodyHtml: `<div class="swdd-tooltip-row">${escapeHTML(t.mirrorNoDateTip)}</div>`
            });
        } else if (utils.isUpToDate(dateMirror, dateSteam)) {
            btnConfig.icon = SVGs.check;
            btnConfig.text = t.download;
            btnConfig.stateClass = TemplateEngine.THEMES.success.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'success',
                icon: SVGs.check,
                titleText: t.modUpdated,
                bodyHtml: TemplateEngine.createTooltipGrid(true, strSteam, true, dbName, strMirror, exactTimeWarningHtml)
            });
        } else {
            btnConfig.icon = SVGs.warning;
            btnConfig.text = t.downloadWarning;
            btnConfig.stateClass = TemplateEngine.THEMES.warning.stateClass;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'warning',
                icon: SVGs.warning,
                titleText: t.modOutdated,
                bodyHtml: TemplateEngine.createTooltipGrid(true, strSteam, true, dbName, strMirror, exactTimeWarningHtml)
            });
        }

        container.innerHTML = TemplateEngine.createModularButton(isCard, btnConfig);

        bindTooltip(container.querySelector('.swdd-btn-group') || container.firstElementChild, tooltipHtmlStr);
        if (container.matches(':hover')) { tooltipGlobal.innerHTML = tooltipHtmlStr; refreshTooltipTimers(); tooltipGlobal.classList.add('show'); safeShowPopover(tooltipGlobal); }
    }

    // ========================================================================
    // MÓDULO 8: UI INJECTORS (Estratégias de Injeção na DOM do Steam)
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

    const observer = new MutationObserver((mutations) => {
        let hasElementNodes = false;
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
    runInjectors();

})();
