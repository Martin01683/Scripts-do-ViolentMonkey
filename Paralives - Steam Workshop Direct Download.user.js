// ==UserScript==
// @name         Paralives - Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  Link direto
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/1118520/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      insane.x10.mx
// @connect      api.steampowered.com
// @updateURL    https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Paralives%20-%20Steam%20Workshop%20Direct%20Download.user.js
// @downloadURL  https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Paralives%20-%20Steam%20Workshop%20Direct%20Download.user.js
// ==/UserScript==

(function() {
    'use strict';

    const PARALIVES_APPID = '1118520';

    // --- 1. FUNÇÃO DE DETEÇÃO OTIMIZADA E ESTRUTURAL ---
    function isParalivesPage() {
        const url = window.location.href;
        
        if (url.includes(`appid=${PARALIVES_APPID}`) || url.includes(`/app/${PARALIVES_APPID}/`)) {
            return true;
        }

        const targetElements = document.querySelector(`
            .breadcrumbs a[href*="/app/${PARALIVES_APPID}"], 
            .apphub_sectionTab[href*="/app/${PARALIVES_APPID}"], 
            .apphub_OtherSiteInfo a[href*="store.steampowered.com/app/${PARALIVES_APPID}"],
            input[name="appid"][value="${PARALIVES_APPID}"]
        `);

        return targetElements !== null;
    }

    if (!isParalivesPage()) return; 

    // --- TEMPOS DE CACHE ---
    const CACHE_TIME_STEAM_MS = 10 * 60 * 1000;  
    const CACHE_TIME_INSANE_MS = 10 * 60 * 1000; 

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
        steamErrorTip:   'Falha na API Steam. Versão não verificada.',
        mirrorNoDate:    '⚠️ Mirror sem data',
        mirrorNoDateTip: 'Não foi possível verificar a versão do mirror.',
        updateCache:     '🔄 Atualizar Cache',
        cacheCooldown:   '⏳ Atualizar cache ({s}s)'
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
        steamErrorTip:   'Steam API unreachable. Version not verified.',
        mirrorNoDate:    '⚠️ Unverified Mirror',
        mirrorNoDateTip: 'Could not verify mirror version date.',
        updateCache:     '🔄 Update Cache',
        cacheCooldown:   '⏳ Update cache ({s}s)'
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

    let globalCacheCooldown = parseInt(localStorage.getItem('Paralives_CacheCooldown') || '0', 10);

    function setGlobalCacheCooldown(ms) {
        globalCacheCooldown = Date.now() + ms;
        try { localStorage.setItem('Paralives_CacheCooldown', globalCacheCooldown.toString()); } catch(err) {}
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

    function updateDropdownCacheText() {
        const cacheBtn = dropdownGlobal.querySelector('#insane-clear-cache');
        if (!cacheBtn) return;
        const now = Date.now();
        
        if (now < globalCacheCooldown) {
            const s = Math.ceil((globalCacheCooldown - now) / 1000);
            cacheBtn.style.cursor = 'not-allowed';
            cacheBtn.style.opacity = '0.5';
            cacheBtn.innerHTML = t.cacheCooldown.replace('{s}', s);
        } else {
            cacheBtn.style.cursor = 'pointer';
            cacheBtn.style.opacity = '1';
            cacheBtn.innerHTML = t.updateCache;
        }
    }

    document.addEventListener('click', (e) => {
        const clearCacheBtn = e.target.closest('#insane-clear-cache');
        if (clearCacheBtn) {
            e.preventDefault();
            e.stopPropagation();
            const now = Date.now();
            
            if (now >= globalCacheCooldown) {
                setGlobalCacheCooldown(30000);

                localStorage.removeItem('Paralives_SteamCache');
                localStorage.removeItem('Paralives_InsaneCache');
                
                insaneDatabaseCache = null;
                insaneCacheExp = 0;
                steamDateCache = {};
                localSteamCache = {};
                
                // Melhoria Inteligente: Zerar as filas solta os callbacks engatados. 
                // As requisições que já estão na rua não são mortas, e quando voltarem
                // alimentarão os novos botões!
                fetchQueue = [];
                steamCallbacks.clear();
                
                updateDropdownCacheText();

                dropdownGlobal.classList.remove('show');
                safeHidePopover(dropdownGlobal);
                dropdownGlobal.lastArrow = null;
                
                document.querySelectorAll('#insane-widget-main, .insane-widget-container').forEach(container => {
                    const modId  = container.dataset.modid;
                    const isCard = container.dataset.iscard === 'true';
                    if (modId) renderWidget(container, modId, isCard);
                });
            }
            return;
        }

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

            const showForum = arrowBtn.getAttribute('data-show-forum') === 'true';
            const forumText = arrowBtn.classList.contains('insane-state-error') ? t.requestMod : t.requestUpdate;

            dropdownGlobal.innerHTML = `
                <a id="insane-clear-cache"></a>
                ${showForum ? `<a href="https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692" rel="noopener noreferrer" class="insane-bg-link"><span>💬</span> ${forumText}</a>` : ''}
            `;
            updateDropdownCacheText();
            
            dropdownGlobal.style.top = topPos + 'px'; dropdownGlobal.style.left = leftPos + 'px';
            dropdownGlobal.classList.add('show'); safeShowPopover(dropdownGlobal); dropdownGlobal.lastArrow = arrowBtn;
            return;
        }

        if (!e.target.closest('.insane-global-dropdown') && dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null;
        }
    }, true);

    window.addEventListener('scroll', () => { 
        if (dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); 
            safeHidePopover(dropdownGlobal); 
            dropdownGlobal.lastArrow = null; 
        }
        if (tooltipGlobal.classList.contains('show')) {
            clearTimeout(hoverTimer);
            tooltipGlobal.classList.remove('show'); 
            safeHidePopover(tooltipGlobal); 
        }
    }, { passive: true });

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'insane-custom-tooltip';
    if (typeof tooltipGlobal.showPopover === 'function') tooltipGlobal.setAttribute('popover', 'manual');
    let hoverTimer;

    function refreshTooltipTimers() {
        const countdowns = tooltipGlobal.querySelectorAll('.insane-cache-countdown');
        countdowns.forEach(el => {
            const exp = parseInt(el.getAttribute('data-exp'), 10);
            if (exp) el.innerText = formatTimeLeft(exp);
        });

        const ages = tooltipGlobal.querySelectorAll('.insane-cache-age');
        ages.forEach(el => {
            const created = parseInt(el.getAttribute('data-created'), 10);
            if (created) el.innerText = formatCacheAge(Date.now() - created);
        });

        const idleStatusEl = tooltipGlobal.querySelector('.insane-idle-status');
        if (idleStatusEl) {
            const idleTextHtml = (isIdleNow() || wasIdleRecently) 
                ? '<span style="color:#F59E0B">⏸️ Pausado (Inativo)</span>' 
                : '<span style="color:#A3E33B">🟢 Ativo</span>';
            idleStatusEl.innerHTML = idleTextHtml;
        }
    }

    let globalCacheCleared = false;

    window.addEventListener('storage', (e) => {
        if (e.key === 'Paralives_CacheCooldown') {
            globalCacheCooldown = parseInt(e.newValue, 10) || 0;
            if (dropdownGlobal.classList.contains('show')) {
                updateDropdownCacheText();
            }
        }
        if (e.key === 'Paralives_SteamCache' && e.newValue === null) {
            steamDateCache = {};
            localSteamCache = {};
            globalCacheCleared = true;
        }
        if (e.key === 'Paralives_InsaneCache' && e.newValue === null) {
            insaneDatabaseCache = null;
            insaneCacheExp = 0;
            globalCacheCleared = true;
        }
    });

    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    let lastActivityTime = Date.now();
    let activityTimeout;
    let wasIdleRecently = false; 

    function isIdleNow() {
        return (Date.now() - lastActivityTime) > IDLE_TIMEOUT_MS;
    }

    function resetActivity() {
        if (!activityTimeout) {
            activityTimeout = setTimeout(() => {
                const now = Date.now();
                if (isIdleNow()) {
                    wasIdleRecently = true;
                    setTimeout(() => { wasIdleRecently = false; refreshTooltipTimers(); }, 4000);
                }
                lastActivityTime = now;
                activityTimeout = null;
            }, 1000); 
        }
    }

    ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetActivity, { passive: true });
    });

    setInterval(() => {
        if (dropdownGlobal.classList.contains('show')) updateDropdownCacheText();
        if (tooltipGlobal.classList.contains('show')) refreshTooltipTimers();

        if (!document.hidden && !isIdleNow()) {
            const now = Date.now();
            const dbExpired = (insaneCacheExp > 0 && now >= insaneCacheExp);

            if (dbExpired) {
                insaneDatabaseCache = null;
                insaneCacheExp = 0;
            }

            const forceUpdate = globalCacheCleared;
            if (forceUpdate) globalCacheCleared = false;

            document.querySelectorAll('#insane-widget-main, .insane-widget-container').forEach(container => {
                const modId  = container.dataset.modid;
                const isCard = container.dataset.iscard === 'true';

                if (modId) {
                    const steamExpired = localSteamCache[modId] ? (now >= localSteamCache[modId].exp) : false;
                    if (steamExpired) delete steamDateCache[modId];

                    if ((dbExpired || steamExpired || forceUpdate) && !container.querySelector('.insane-state-loading')) {
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
                refreshTooltipTimers();

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

    let steamDateCache  = {};
    let localSteamCache = {};
    let pendingSteamIDs = new Set();
    let isFetchingBatch = false;
    let steamQueueTimeout = null;
    let steamCallbacks = new Map();

    try {
        const stored = localStorage.getItem('Paralives_SteamCache');
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
            if (changed) saveCacheSafely('Paralives_SteamCache', localSteamCache);
        }
    } catch(e) {}

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

            if (steamCallbacks.has(id)) {
                steamCallbacks.get(id).forEach(cb => cb());
                steamCallbacks.delete(id);
            }
        });
        saveCacheSafely('Paralives_SteamCache', localSteamCache);
        isFetchingBatch = false; 
        triggerSteamFetch();
    }

    function processSteamQueue() {
        if (isFetchingBatch || pendingSteamIDs.size === 0) return;

        isFetchingBatch = true;
        const idsToFetch = Array.from(pendingSteamIDs).slice(0, 100);
        let dataString = `itemcount=${idsToFetch.length}`;
        idsToFetch.forEach((id, index) => dataString += `&publishedfileids[${index}]=${id}`);

        GM_xmlhttpRequest({
            method: 'POST', 
            url: 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
            data: dataString, 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            onload: function(response) {
                if (response.status !== 200) {
                    handleSteamError(idsToFetch);
                    return;
                }

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
                                    exp: now + CACHE_TIME_STEAM_MS
                                };
                                handledIds.add(id);
                            }
                        });
                    }
                } catch(e) {
                    handleSteamError(idsToFetch);
                    return;
                }

                idsToFetch.forEach(id => {
                    if (!handledIds.has(id)) {
                        steamDateCache[id] = STEAM_NO_DATE;
                        localSteamCache[id] = { date: STEAM_NO_DATE, exp: now + CACHE_TIME_STEAM_MS };
                    }
                    pendingSteamIDs.delete(id);

                    if (steamCallbacks.has(id)) {
                        steamCallbacks.get(id).forEach(cb => cb());
                        steamCallbacks.delete(id);
                    }
                });

                saveCacheSafely('Paralives_SteamCache', localSteamCache);
                isFetchingBatch = false; 
                triggerSteamFetch();
            },
            onerror: () => {
                handleSteamError(idsToFetch);
            }
        });
    }

    let insaneDatabaseCache = null;
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
            const stored = localStorage.getItem('Paralives_InsaneCache');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.data && parsed.exp && Date.now() < parsed.exp) {
                    insaneDatabaseCache = parsed.data;
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
            method: "GET", url: "https://insane.x10.mx/paralives.php?_t=" + Date.now(),
            onload: function(response) {
                let success = false;
                
                // Melhoria Inteligente: Validação total (status HTTP e integridade do JSON)
                if (response.status === 200) {
                    try {
                        const jsonString = extractJsonArray(response.responseText, 'allMods');
                        if (jsonString) {
                            const parsedData = JSON.parse(jsonString);
                            if (Array.isArray(parsedData)) {
                                insaneDatabaseCache = {};
                                parsedData.forEach(mod => {
                                    if (mod.name && (mod.link || mod.url)) {
                                        const idSteam = mod.name.match(/^(\d+)/);
                                        if (idSteam) insaneDatabaseCache[idSteam[1]] = { link: mod.link || mod.url, uploaded: mod.uploaded };
                                    }
                                });

                                insaneCacheExp = Date.now() + CACHE_TIME_INSANE_MS;
                                saveCacheSafely('Paralives_InsaneCache', {
                                    data: insaneDatabaseCache,
                                    exp:  insaneCacheExp
                                });
                                success = true;
                            }
                        }
                    } catch (e) {}
                }

                if (success) {
                    fetchQueue.forEach(cb => cb(insaneDatabaseCache));
                } else {
                    insaneDatabaseCache = null;
                    insaneCacheExp = 0;
                    // Força retorno nulo ativando o modo de falha (DB Error) real.
                    fetchQueue.forEach(cb => cb(null));
                }
                
                fetchQueue = [];
                isFetchingInsane = false;
            },
            onerror: () => {
                insaneDatabaseCache = null;
                insaneCacheExp = 0;
                fetchQueue.forEach(cb => cb(null)); 
                fetchQueue = [];
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
                container.innerHTML = `<div class="insane-btn-group"><a href="https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-error insane-btn-main">${t.requestMod}</a><button class="insane-custom-btn ${cClass} insane-state-error insane-btn-arrow" data-show-forum="false">▼</button></div>`;

                const creationTimeInsane = insaneCacheExp ? (insaneCacheExp - CACHE_TIME_INSANE_MS) : Date.now();
                const strInsaneCache = formatCacheAge(Date.now() - creationTimeInsane);
                const strInsaneReset = formatTimeLeft(insaneCacheExp);
                const cacheInfoHtml = `
                    <div class="insane-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                        <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span>${t.labelCache}</span>
                            <span class="insane-idle-status" style="font-size:11px; font-weight:normal;"></span>
                        </div>
                        <div class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheDB} <span class="insane-cache-age" data-created="${creationTimeInsane}">${strInsaneCache}</span> (🔄 <span class="insane-cache-countdown" data-exp="${insaneCacheExp}">${strInsaneReset}</span>)</div>
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

                let steamCacheExp = 0;
                if (localSteamCache[modId] && localSteamCache[modId].exp) {
                    steamCacheExp = localSteamCache[modId].exp;
                }

                const creationTimeSteam = steamCacheExp ? (steamCacheExp - CACHE_TIME_STEAM_MS) : Date.now();
                const creationTimeInsane = insaneCacheExp ? (insaneCacheExp - CACHE_TIME_INSANE_MS) : Date.now();

                const strSteamCache  = formatCacheAge(Date.now() - creationTimeSteam);
                const strSteamReset  = formatTimeLeft(steamCacheExp);
                const strInsaneCache = formatCacheAge(Date.now() - creationTimeInsane);
                const strInsaneReset = formatTimeLeft(insaneCacheExp);

                const cacheInfoHtml = `
                    <div class="insane-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                        <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span>${t.labelCache}</span>
                            <span class="insane-idle-status" style="font-size:11px; font-weight:normal;"></span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <span class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheSteam} <span class="insane-cache-age" data-created="${creationTimeSteam}">${strSteamCache}</span> (🔄 <span class="insane-cache-countdown" data-exp="${steamCacheExp}">${strSteamReset}</span>)</span>
                            <span class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheDB} <span class="insane-cache-age" data-created="${creationTimeInsane}">${strInsaneCache}</span> (🔄 <span class="insane-cache-countdown" data-exp="${insaneCacheExp}">${strInsaneReset}</span>)</span>
                        </div>
                    </div>`;

                const strInsane = dataInsane ? dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';
                const strSteam  = (dataSteam && dataSteam !== STEAM_NO_DATE && dataSteam !== STEAM_FETCH_ERROR)
                    ? dataSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'})
                    : 'N/A';

                // CORREÇÃO APLICADA AQUI ABAIXO
                if (dataSteam === STEAM_FETCH_ERROR) {
                    container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-error insane-btn-main">${t.steamError}</a><button class="insane-custom-btn ${cClass} insane-state-error insane-btn-arrow" data-show-forum="false">▼</button></div>`;
                    bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-error"><span>🔌</span> ${t.steamErrorTip}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>${cacheInfoHtml}`);
                } else if (!dataInsane) {
                    container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-warning insane-btn-main">${t.downloadWarning}</a><button class="insane-custom-btn ${cClass} insane-state-warning insane-btn-arrow" data-show-forum="false">▼</button></div>`;
                    bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> ${t.mirrorNoDate}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">Info:</span> <span class="insane-tooltip-value">${t.mirrorNoDateTip}</span></div>${cacheInfoHtml}`);
                } else if (dataSteam === STEAM_NO_DATE || dataInsane >= dataSteam) {
                    container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-success insane-btn-main">${t.download}</a><button class="insane-custom-btn ${cClass} insane-state-success insane-btn-arrow" data-show-forum="false">▼</button></div>`;
                    bindTooltip(container.firstElementChild, `<div class="insane-tooltip-title insane-tooltip-success"><span>✅</span> ${t.modUpdated}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>${cacheInfoHtml}`);
                } else {
                    container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-warning insane-btn-main">${t.downloadWarning}</a><button class="insane-custom-btn ${cClass} insane-state-warning insane-btn-arrow" data-show-forum="true">▼</button></div>`;
                    bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> ${t.modOutdated}</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div><div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>${cacheInfoHtml}`);
                }
            }
            drawDateComparison();
        });
    }

    function injectWidgets() {
        const urlStr = window.location.href;
        if (urlStr.includes("/sharedfiles/filedetails") || urlStr.includes("/workshop/filedetails")) {
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

        document.querySelectorAll('h2 a[href*="sharedfiles/filedetails/?id="], h2 a[href*="workshop/filedetails/?id="]').forEach(titleLink => {
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
                modLink = cardContainer.querySelector('a[href*="sharedfiles/filedetails/?id="], a[href*="workshop/filedetails/?id="]');
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
