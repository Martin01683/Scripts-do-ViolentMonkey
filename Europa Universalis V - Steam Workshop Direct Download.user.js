// ==UserScript==
// @name         Europa Universalis V - Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Link direto
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/3450310/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      insane.x10.mx
// @connect      api.steampowered.com
// @updateURL    https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Europa%20Universalis%20V%20-%20Steam%20Workshop%20Direct%20Download.user.js
// @downloadURL  https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Europa%20Universalis%20V%20-%20Steam%20Workshop%20Direct%20Download.user.js
// ==/UserScript==

(function() {
    'use strict';

    const EU5_APPID = '3450310';
    const CACHE_TIME_MS = 10 * 60 * 1000; // 10 minutos

    // Sentinels para o cache da Steam — mantidos separados intencionalmente:
    //   STEAM_NO_DATE    → API respondeu, mas o item genuinamente não tem timestamp
    //   STEAM_FETCH_ERROR → falha de rede/API; versão não pôde ser verificada
    const STEAM_NO_DATE     = 'NO_DATE';
    const STEAM_FETCH_ERROR = 'FETCH_ERROR';

    const t = document.documentElement.lang.toLowerCase().startsWith('pt') ? {
        loading:         '⏳ Buscando...',
        checkingVersion: '⏳ Checando Versão...',
        dbError:         '⚠️ Erro DB',
        requestMod:      '➕ Pedir Mod',
        modNotListed:    'Mod não listado. Clique para pedir.',
        download:        '✅ Baixar',
        downloadWarning: '⚠️ Baixar',
        modUpdated:      'MOD ATUALIZADO',
        modOutdated:     'MOD DESATUALIZADO',
        requestUpdate:   'Pedir Atualização no Fórum',
        labelSteam:      'Steam:',
        labelInsane:     'Insane:',
        labelCache:      'Status do Cache:',
        cacheSteam:      'Steam:',
        cacheDB:         'Banco de Dados:',
        justNow:         'agora',
        minAgo:          'min atrás',
        steamError:      '⚠️ Sem Verificar',
        steamErrorTip:   'Falha na API Steam. Versão não verificada.'
    } : {
        loading:         '⏳ Loading...',
        checkingVersion: '⏳ Checking Version...',
        dbError:         '⚠️ DB Error',
        requestMod:      '➕ Request Mod',
        modNotListed:    'Mod not listed. Click to request.',
        download:        '✅ Download',
        downloadWarning: '⚠️ Download',
        modUpdated:      'MOD UP TO DATE',
        modOutdated:     'MOD OUTDATED',
        requestUpdate:   'Request Update on Forum',
        labelSteam:      'Steam:',
        labelInsane:     'Insane:',
        labelCache:      'Cache Status:',
        cacheSteam:      'Steam:',
        cacheDB:         'Database:',
        justNow:         'just now',
        minAgo:          'min ago',
        steamError:      '⚠️ Unverified',
        steamErrorTip:   'Steam API unreachable. Version not verified.'
    };

    function formatCacheAge(ms) {
        if (!ms || ms < 0 || isNaN(ms)) ms = 0;
        const minutes = Math.floor(ms / 60000);
        if (minutes < 1) return t.justNow;
        return `${minutes} ${t.minAgo}`;
    }

    function formatTimeLeft(expTimestamp) {
        if (!expTimestamp) return "0s";
        const left = expTimestamp - Date.now();
        if (left <= 0) return "0s";
        const m = Math.floor(left / 60000);
        const s = Math.floor((left % 60000) / 1000);
        return `${m}m ${s}s`;
    }

    function isEU5Page() {
        const url = window.location.href;
        if (url.includes(`appid=${EU5_APPID}`) || url.includes(`/app/${EU5_APPID}/`)) return true;
        if (document.querySelector(`a[href*="${EU5_APPID}"]`) || document.querySelector(`[onclick*="${EU5_APPID}"]`)) return true;
        return false;
    }

    function saveCacheSafely(key, dataObj) {
        try {
            localStorage.setItem(key, JSON.stringify(dataObj));
        } catch(e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                try {
                    localStorage.removeItem(key);
                    localStorage.setItem(key, JSON.stringify(dataObj));
                } catch(err) {}
            }
        }
    }

    // ── FIX: adicionados pointerdown e pointerup para cobrir browsers modernos ──
    function stopCardNav(el) {
        const stop = (e) => e.stopPropagation();
        el.addEventListener('click',       stop);
        el.addEventListener('mousedown',   stop);
        el.addEventListener('mouseup',     stop);
        el.addEventListener('pointerdown', stop);
        el.addEventListener('pointerup',   stop);
    }

    const style = document.createElement('style');
    style.innerHTML = `
        .insane-custom-btn { display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 0 15px !important; font-size: 13px !important; font-weight: bold !important; border-radius: 2px !important; text-decoration: none !important; white-space: nowrap !important; transition: all 0.2s ease-in-out !important; box-sizing: border-box !important; font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important; box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important; gap: 8px !important; z-index: 99 !important; height: 34px !important; text-shadow: 1px 1px 2px rgba(0,0,0,0.5) !important; margin: 0 !important; }
        .insane-custom-btn-compact { padding: 0 8px !important; font-size: 11px !important; border-radius: 2px !important; gap: 4px !important; height: 24px !important; }
        .insane-custom-btn:hover { filter: brightness(1.15) !important; }
        .insane-custom-btn:active { filter: brightness(0.9) !important; }
        .insane-state-loading { background: linear-gradient(to bottom, #343f4d 5%, #222933 95%) !important; color: #acb2b8 !important; border: 1px solid #455366 !important; cursor: wait !important; }
        .insane-state-info { background: linear-gradient(to bottom, #1a3c54 5%, #122436 95%) !important; color: #66c0f4 !important; border: 1px solid #2b5575 !important; cursor: pointer !important; }
        .insane-state-success { background: linear-gradient(to bottom, #3f5c1e 5%, #2c4015 95%) !important; color: #A3E33B !important; border: 1px solid #5a852a !important; cursor: pointer !important; }
        .insane-state-warning { background: linear-gradient(to bottom, #6b410c 5%, #452a08 95%) !important; color: #F59E0B !important; border: 1px solid #995c10 !important; cursor: pointer !important; }
        .insane-state-error { background: linear-gradient(to bottom, #612222 5%, #3d1616 95%) !important; color: #ff6b6b !important; border: 1px solid #8c3232 !important; cursor: pointer !important; }
        .insane-btn-group { position: relative; display: inline-flex; border-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: transform 0.2s; align-items: center; height: 100%; }
        .insane-btn-group:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.4); }
        .insane-btn-main { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; border-right: 1px solid rgba(0,0,0,0.4) !important; margin: 0 !important; box-shadow: none !important; }
        .insane-btn-main:hover { transform: none !important; box-shadow: none !important; }
        .insane-btn-arrow { border-top-left-radius: 0 !important; border-bottom-left-radius: 0 !important; padding: 0 8px !important; margin: 0 !important; box-shadow: none !important; }
        .insane-btn-arrow:hover { transform: none !important; box-shadow: none !important; }
        .insane-global-dropdown { position: fixed !important; background: #171a21; border: 1px solid #3d4450; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.9); display: none; flex-direction: column; min-width: 220px; z-index: 2147483647 !important; overflow: hidden; margin: 0 !important; }
        .insane-global-dropdown.show { display: flex; }
        .insane-global-dropdown:popover-open { bottom: auto; right: auto; margin: 0 !important; }
        .insane-global-dropdown a { padding: 10px 12px; color: #acb2b8; text-decoration: none; font-size: 12px; transition: background 0.2s; font-family: "Motiva Sans", sans-serif; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .insane-global-dropdown a:hover { background: #3d4450; color: #fff; }
        .insane-custom-tooltip { position: fixed !important; margin: 0 !important; z-index: 2147483647 !important; background: #171a21 !important; border: 1px solid #3d4450 !important; border-radius: 6px !important; padding: 12px !important; color: #acb2b8 !important; font-family: "Motiva Sans", Arial, sans-serif !important; font-size: 13px !important; box-shadow: 0 8px 16px rgba(0,0,0,0.9) !important; pointer-events: none !important; opacity: 0; transition: opacity 0.1s; white-space: nowrap !important; }
        .insane-custom-tooltip.show { opacity: 1 !important; }
        .insane-custom-tooltip:popover-open { bottom: auto; right: auto; margin: 0 !important; }
        .insane-tooltip-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #3d4450; display: flex; align-items: center; gap: 6px; }
        .insane-tooltip-success { color: #A3E33B; } .insane-tooltip-warning { color: #F59E0B; } .insane-tooltip-error { color: #ff6b6b; }
        .insane-tooltip-row { margin: 4px 0; } .insane-tooltip-label { color: #8f98a0; display: inline-block; width: 60px; } .insane-tooltip-value { color: #E2E8F0; font-weight: 500; }
        #insane-widget-main { display: inline-flex; height: 34px; align-items: center; }
        .insane-widget-container { position: relative; z-index: 10; display: inline-flex; align-items: center; }
        .insane-widget-container:hover { z-index: 9999; }
    `;
    document.head.appendChild(style);

    let popoverHideTimeouts = new WeakMap();

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

    const dropdownGlobal = document.createElement('div');
    dropdownGlobal.className = 'insane-global-dropdown';
    if (typeof dropdownGlobal.showPopover === 'function') dropdownGlobal.setAttribute('popover', 'manual');

    document.addEventListener('click', (e) => {
        // Interceptar cliques em links do script para forçar abertura sem duplicar abas
        const scriptLink = e.target.closest('a.insane-custom-btn, a.insane-bg-link');
        if (scriptLink && scriptLink.hasAttribute('href')) {
            if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (typeof GM_openInTab === 'function') {
                    GM_openInTab(scriptLink.href, { active: false, insert: true });
                } else {
                    window.open(scriptLink.href, '_blank', 'noopener');
                }

                if (scriptLink.classList.contains('insane-bg-link') && dropdownGlobal.classList.contains('show')) {
                    dropdownGlobal.classList.remove('show');
                    safeHidePopover(dropdownGlobal);
                    dropdownGlobal.lastArrow = null;
                }
                return;
            }
        }

        const arrowBtn = e.target.closest('.insane-btn-arrow');
        if (arrowBtn) {
            e.preventDefault(); e.stopPropagation();
            if (dropdownGlobal.classList.contains('show') && dropdownGlobal.lastArrow === arrowBtn) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null;
                return;
            }
            const dialogParent = arrowBtn.closest('dialog');
            const rect = arrowBtn.getBoundingClientRect();
            let topPos = rect.bottom, leftPos = rect.right - 220;

            if (dialogParent) dialogParent.appendChild(dropdownGlobal);
            else document.body.appendChild(dropdownGlobal);

            if (typeof dropdownGlobal.showPopover !== 'function' && dialogParent) {
                const style = window.getComputedStyle(dialogParent);
                if (style.transform !== 'none') {
                    const dialogRect = dialogParent.getBoundingClientRect();
                    topPos -= dialogRect.top; leftPos -= dialogRect.left;
                }
            }

            dropdownGlobal.innerHTML = `<a href="https://cs.rin.ru/forum/viewtopic.php?f=10&t=152865" rel="noopener noreferrer" class="insane-bg-link"><span>💬</span> ${t.requestUpdate}</a>`;
            dropdownGlobal.style.top = topPos + 'px'; dropdownGlobal.style.left = leftPos + 'px';
            dropdownGlobal.classList.add('show'); safeShowPopover(dropdownGlobal); dropdownGlobal.lastArrow = arrowBtn;
            return;
        }

        if (!e.target.closest('.insane-global-dropdown') && dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null;
        }
    }, true);

    window.addEventListener('scroll', () => { dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; }, { passive: true });

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'insane-custom-tooltip';
    if (typeof tooltipGlobal.showPopover === 'function') tooltipGlobal.setAttribute('popover', 'manual');
    let hoverTimer;

    // --- MOTOR EM TEMPO REAL: TOOLTIP E AUTO-REFRESH ---
    setInterval(() => {
        if (tooltipGlobal.classList.contains('show')) {
            const countdowns = tooltipGlobal.querySelectorAll('.insane-cache-countdown');
            countdowns.forEach(el => {
                const exp = parseInt(el.getAttribute('data-exp'), 10);
                if (exp) el.innerText = formatTimeLeft(exp);
            });
        }

        if (!document.hidden) {
            const now = Date.now();
            const dbExpired = (insaneCacheExp > 0 && now >= insaneCacheExp);

            if (dbExpired) {
                insaneDatabaseCache = null;
            }

            document.querySelectorAll('#insane-widget-main, .insane-widget-container').forEach(container => {
                const modId  = container.dataset.modid;
                const isCard = container.dataset.iscard === 'true';

                if (modId) {
                    const steamExpired = localSteamCache[modId]
                        ? (now >= localSteamCache[modId].exp)
                        : false;

                    if (steamExpired) {
                        delete steamDateCache[modId];
                    }

                    if ((dbExpired || steamExpired) && !container.querySelector('.insane-state-loading')) {
                        if (container.matches(':hover')) {
                            tooltipGlobal.classList.remove('show');
                            safeHidePopover(tooltipGlobal);
                        }
                        renderWidget(container, modId, isCard);
                    }
                }
            });
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
            lastX = e.clientX; lastY = e.clientY;
            hoverTimer = setTimeout(() => {
                const dialogParent = element.closest('dialog');
                if (dialogParent) dialogParent.appendChild(tooltipGlobal); else document.body.appendChild(tooltipGlobal);
                tooltipGlobal.innerHTML = htmlContent;
                tooltipGlobal.classList.add('show');
                safeShowPopover(tooltipGlobal);
                updatePos();
            }, 300);
        });

        element.addEventListener('mousemove', (e) => {
            lastX = e.clientX; lastY = e.clientY;
            if (tooltipGlobal.classList.contains('show')) updatePos();
        });

        element.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            tooltipGlobal.classList.remove('show');
            safeHidePopover(tooltipGlobal, 100);
        });
    }

    // --- SISTEMA DE CACHE: STEAM API ---
    let steamDateCache  = {};
    let localSteamCache = {};
    let pendingSteamIDs = new Set();
    let isFetchingBatch = false;
    let steamQueueTimeout = null;
    let steamCallbacks = new Map();

    try {
        const stored = localStorage.getItem('EU5_SteamCache');
        if (stored) {
            const parsed = JSON.parse(stored);
            const now = Date.now();
            let changed = false;
            for (const id in parsed) {
                if (parsed[id] && parsed[id].exp && now < parsed[id].exp) {
                    localSteamCache[id] = parsed[id];
                } else {
                    changed = true;
                }
            }
            if (changed) saveCacheSafely('EU5_SteamCache', localSteamCache);
        }
    } catch(e) {}

    function triggerSteamFetch() {
        if (!isFetchingBatch && pendingSteamIDs.size > 0) {
            clearTimeout(steamQueueTimeout);
            steamQueueTimeout = setTimeout(processSteamQueue, 100);
        }
    }

    function processSteamQueue() {
        if (!isEU5Page()) return;
        if (isFetchingBatch || pendingSteamIDs.size === 0) return;

        isFetchingBatch = true;
        const idsToFetch = Array.from(pendingSteamIDs).slice(0, 100);
        let dataString = `itemcount=${idsToFetch.length}`;
        idsToFetch.forEach((id, index) => dataString += `&publishedfileids[${index}]=${id}`);

        GM_xmlhttpRequest({
            method: 'POST', url: 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
            data: dataString, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            onload: function(response) {
                const now = Date.now();
                const handledIds = new Set();
                try {
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
                                    exp: now + CACHE_TIME_MS
                                };
                                handledIds.add(id);
                            }
                        });
                    }
                } catch(e) {}

                idsToFetch.forEach(id => {
                    if (!handledIds.has(id)) {
                        steamDateCache[id] = STEAM_NO_DATE;
                        localSteamCache[id] = { date: STEAM_NO_DATE, exp: now + CACHE_TIME_MS };
                    }
                    pendingSteamIDs.delete(id);

                    if (steamCallbacks.has(id)) {
                        steamCallbacks.get(id).forEach(cb => cb());
                        steamCallbacks.delete(id);
                    }
                });

                saveCacheSafely('EU5_SteamCache', localSteamCache);
                isFetchingBatch = false; triggerSteamFetch();
            },
            onerror: () => {
                const now = Date.now();
                idsToFetch.forEach(id => {
                    steamDateCache[id] = STEAM_FETCH_ERROR;
                    localSteamCache[id] = { date: STEAM_FETCH_ERROR, exp: now + CACHE_TIME_MS };
                    pendingSteamIDs.delete(id);

                    if (steamCallbacks.has(id)) {
                        steamCallbacks.get(id).forEach(cb => cb());
                        steamCallbacks.delete(id);
                    }
                });
                saveCacheSafely('EU5_SteamCache', localSteamCache);
                isFetchingBatch = false; triggerSteamFetch();
            }
        });
    }

    // --- SISTEMA DE CACHE: INSANE DB ---
    let insaneDatabaseCache = null;
    let insaneCacheAgeMs   = 0;
    let insaneCacheExp     = 0;
    let isFetchingInsane   = false;
    let fetchQueue         = [];

    function extractJsonArray(text, variableName) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return text;
            if (parsed[variableName]) return JSON.stringify(parsed[variableName]);
        } catch (e) {}

        const regex = new RegExp(`(?:const|let|var)\\s+${variableName}\\s*=\\s*\\[`);
        const match = text.match(regex);
        if (!match) return null;

        const startIdx = match.index + match[0].length - 1;
        let depth = 0;

        for (let i = startIdx; i < text.length; i++) {
            if (text[i] === '[') depth++;
            else if (text[i] === ']') {
                depth--;
                if (depth === 0) return text.substring(startIdx, i + 1);
            }
        }
        return null;
    }

    function fetchInsaneData(callback) {
        if (insaneDatabaseCache !== null && Date.now() < insaneCacheExp) {
            callback(insaneDatabaseCache);
            return;
        }

        try {
            const stored = localStorage.getItem('EU5_InsaneCache');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.data && parsed.exp && Date.now() < parsed.exp) {
                    insaneDatabaseCache = parsed.data;
                    insaneCacheAgeMs   = Date.now() - (parsed.exp - CACHE_TIME_MS);
                    insaneCacheExp     = parsed.exp;
                    callback(insaneDatabaseCache);
                    return;
                }
            }
        } catch(e) {}

        fetchQueue.push(callback);
        if (isFetchingInsane) return;
        isFetchingInsane = true;

        GM_xmlhttpRequest({
            method: "GET", url: "https://insane.x10.mx/eu5.php?_t=" + Date.now(),
            onload: function(response) {
                insaneDatabaseCache = {};
                insaneCacheAgeMs   = 0;
                insaneCacheExp     = 0;
                try {
                    const jsonString = extractJsonArray(response.responseText, 'allMods');
                    if (jsonString) {
                        JSON.parse(jsonString).forEach(mod => {
                            if (mod.name && (mod.link || mod.url)) {
                                const idSteam = mod.name.match(/^(\d+)/);
                                if (idSteam) insaneDatabaseCache[idSteam[1]] = { link: mod.link || mod.url, uploaded: mod.uploaded };
                            }
                        });

                        insaneCacheExp = Date.now() + CACHE_TIME_MS;
                        saveCacheSafely('EU5_InsaneCache', {
                            data: insaneDatabaseCache,
                            exp:  insaneCacheExp
                        });
                    }
                } catch (e) {}

                fetchQueue.forEach(cb => cb(insaneDatabaseCache)); fetchQueue = [];
                isFetchingInsane = false;
            },
            onerror: () => {
                fetchQueue.forEach(cb => cb(null)); fetchQueue = [];
                isFetchingInsane = false;
            }
        });
    }

    function parseDataInsane(dataString) {
        if (!dataString || dataString.startsWith('0000-00-00')) return null;
        const d = new Date(dataString.replace(' ', 'T') + '+01:00');
        return isNaN(d.getTime()) ? null : d;
    }

    function renderWidget(container, modId, isCard) {
        const cClass = isCard ? 'insane-custom-btn-compact' : '';
        container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-loading">${t.loading}</a>`;

        fetchInsaneData((db) => {
            if (db === null) { container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-warning">${t.dbError}</a>`; return; }
            if (!db[modId]) {
                container.innerHTML = `<a href="https://cs.rin.ru/forum/viewtopic.php?f=10&t=152865" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-error">${t.requestMod}</a>`;

                const strInsaneCache = formatCacheAge(insaneCacheAgeMs);
                const strInsaneReset = formatTimeLeft(insaneCacheExp);
                const cacheInfoHtml = `
                    <div class="insane-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                        <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px;">${t.labelCache}</div>
                        <div class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheDB} ${strInsaneCache} (🔄 <span class="insane-cache-countdown" data-exp="${insaneCacheExp}">${strInsaneReset}</span>)</div>
                    </div>`;

                bindTooltip(container.firstElementChild, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> ${t.modNotListed}</div>${cacheInfoHtml}`);
                return;
            }

            const modData   = db[modId];
            const dataInsane = parseDataInsane(modData.uploaded);

            function drawDateComparison() {
                let dataSteam = steamDateCache[modId];

                if (dataSteam === undefined && localSteamCache[modId] && Date.now() < localSteamCache[modId].exp) {
                    const cachedVal = localSteamCache[modId].date;
                    dataSteam = steamDateCache[modId] =
                        (cachedVal === STEAM_NO_DATE || cachedVal === STEAM_FETCH_ERROR)
                            ? cachedVal
                            : new Date(cachedVal);
                }

                if (dataSteam === undefined) {
                    container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-loading">${t.checkingVersion}</a>`;
                    pendingSteamIDs.add(modId);

                    if (!steamCallbacks.has(modId)) steamCallbacks.set(modId, new Set());
                    steamCallbacks.get(modId).add(drawDateComparison);

                    triggerSteamFetch();
                    return;
                }

                let steamCacheAgeMs = 0;
                let steamCacheExp   = 0;
                if (localSteamCache[modId] && localSteamCache[modId].exp) {
                    steamCacheAgeMs = Date.now() - (localSteamCache[modId].exp - CACHE_TIME_MS);
                    steamCacheExp   = localSteamCache[modId].exp;
                }

                const strSteamCache  = formatCacheAge(steamCacheAgeMs);
                const strSteamReset  = formatTimeLeft(steamCacheExp);
                const strInsaneCache = formatCacheAge(insaneCacheAgeMs);
                const strInsaneReset = formatTimeLeft(insaneCacheExp);

                const cacheInfoHtml = `
                    <div class="insane-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                        <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px;">${t.labelCache}</div>
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <span class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheSteam} ${strSteamCache} (🔄 <span class="insane-cache-countdown" data-exp="${steamCacheExp}">${strSteamReset}</span>)</span>
                            <span class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheDB} ${strInsaneCache} (🔄 <span class="insane-cache-countdown" data-exp="${insaneCacheExp}">${strInsaneReset}</span>)</span>
                        </div>
                    </div>`;

                const strInsane = dataInsane ? dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';
                const strSteam  = (dataSteam && dataSteam !== STEAM_NO_DATE && dataSteam !== STEAM_FETCH_ERROR)
                    ? dataSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})
                    : 'N/A';

                if (dataSteam === STEAM_FETCH_ERROR) {
                    container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-error insane-btn-main">${t.steamError}</a><button class="insane-custom-btn ${cClass} insane-state-error insane-btn-arrow">▼</button></div>`;
                    bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-error"><span>🔌</span> ${t.steamErrorTip}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>${cacheInfoHtml}`);
                } else if (dataSteam === STEAM_NO_DATE || !dataInsane || dataInsane >= dataSteam) {
                    container.innerHTML = `<a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-success">${t.download}</a>`;
                    bindTooltip(container.firstElementChild, `<div class="insane-tooltip-title insane-tooltip-success"><span>✅</span> ${t.modUpdated}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>${cacheInfoHtml}`);
                } else {
                    container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-warning insane-btn-main">${t.downloadWarning}</a><button class="insane-custom-btn ${cClass} insane-state-warning insane-btn-arrow">▼</button></div>`;
                    bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> ${t.modOutdated}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>${cacheInfoHtml}`);
                }
            }
            drawDateComparison();
        });
    }

    function injectWidgets() {
        if (!isEU5Page()) return;

        if (window.location.href.includes("steamcommunity.com/sharedfiles/filedetails")) {
            const modId = new URLSearchParams(window.location.search).get('id');
            const steamBtn = document.getElementById('SubscribeItemBtn');
            const subscribeControls = steamBtn ? steamBtn.parentElement : null;

            if (modId && subscribeControls && !document.getElementById('insane-widget-main')) {
                const gameArea = subscribeControls.parentElement;
                if (gameArea && gameArea.classList.contains('game_area_purchase_game')) {
                    gameArea.style.display         = 'flex';
                    gameArea.style.flexWrap        = 'wrap';
                    gameArea.style.alignItems      = 'center';
                    gameArea.style.justifyContent  = 'space-between';
                    gameArea.style.gap             = '15px';
                    const titleH1 = gameArea.querySelector('h1');
                    if (titleH1) {
                        titleH1.style.float  = 'none';
                        titleH1.style.width  = 'auto';
                        titleH1.style.flex   = '1 1 auto';
                        titleH1.style.margin = '0';
                    }
                }

                subscribeControls.style.float          = 'none';
                subscribeControls.style.display        = 'flex';
                subscribeControls.style.flexWrap       = 'wrap';
                subscribeControls.style.alignItems     = 'center';
                subscribeControls.style.justifyContent = 'flex-end';
                subscribeControls.style.gap            = '10px';
                steamBtn.style.flexShrink              = '0';
                steamBtn.style.margin                  = '0';

                const container = document.createElement('div');
                container.id             = 'insane-widget-main';
                container.dataset.modid  = modId;
                container.dataset.iscard = 'false';

                steamBtn.insertAdjacentElement('beforebegin', container);
                stopCardNav(container);
                renderWidget(container, modId, false);
            }
        }

        document.querySelectorAll('h2 a[href*="sharedfiles/filedetails/?id="]').forEach(titleLink => {
            let modalRoot = titleLink;
            for(let i = 0; i < 6; i++) { if(modalRoot.parentElement) modalRoot = modalRoot.parentElement; }

            const subscribeBtn = Array.from(modalRoot.querySelectorAll('button')).find(b => b.getAttribute('data-accent-color') === 'green' || b.querySelector('.SVGIcon_Plus'));
            if (!subscribeBtn) return;

            const anchor = subscribeBtn.closest('.tool-tip-source') || subscribeBtn;
            if (!anchor.parentElement.querySelector('.insane-widget-container')) {
                const container = document.createElement('div');
                container.className      = 'insane-widget-container';
                container.style.marginRight = '8px';
                container.dataset.modid  = new URL(titleLink.href).searchParams.get('id');
                container.dataset.iscard = 'false';

                stopCardNav(container);
                anchor.insertAdjacentElement('beforebegin', container);

                if (container.dataset.modid) renderWidget(container, container.dataset.modid, false);
            }
        });

        document.querySelectorAll('.SVGIcon_MagnifyingGlass').forEach(zoomIcon => {
            const actionRow = (zoomIcon.closest('[role="button"]') || zoomIcon.parentElement)?.parentElement;
            if (!actionRow || actionRow.querySelector('.insane-widget-container')) return;

            let cardContainer = actionRow.parentElement, modLink = null;
            for (let i = 0; i < 5; i++) {
                if (!cardContainer) break;
                modLink = cardContainer.querySelector('a[href*="sharedfiles/filedetails/?id="]');
                if (modLink) break;
                cardContainer = cardContainer.parentElement;
            }
            if (!modLink || modLink.parentElement.tagName === 'H2') return;

            actionRow.style.setProperty('opacity',    '1', 'important');
            actionRow.style.setProperty('visibility', 'visible', 'important');
            actionRow.style.display    = 'flex';
            actionRow.style.alignItems = 'center';
            actionRow.style.gap        = '6px';

            const container = document.createElement('div');
            container.className      = 'insane-widget-container';
            container.dataset.modid  = new URL(modLink.href).searchParams.get('id');
            container.dataset.iscard = 'true';

            stopCardNav(container);
            actionRow.prepend(container);

            if (container.dataset.modid) renderWidget(container, container.dataset.modid, true);
        });
    }

    let domCheckTimeout;
    const observer = new MutationObserver((mutations) => {
        let hasElementNodes = false;
        for (const mutation of mutations) {
            for (let i = 0; i < mutation.addedNodes.length; i++) {
                if (mutation.addedNodes[i].nodeType === Node.ELEMENT_NODE) {
                    hasElementNodes = true;
                    break;
                }
            }
            if (hasElementNodes) break;
        }

        if (hasElementNodes) {
            clearTimeout(domCheckTimeout);
            domCheckTimeout = setTimeout(injectWidgets, 150);
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    injectWidgets();

})();
