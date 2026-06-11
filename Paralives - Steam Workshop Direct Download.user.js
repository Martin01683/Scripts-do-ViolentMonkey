// ==UserScript==
// @name         Paralives - Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Link direto
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/1118520/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      insane.x10.mx
// @connect      api.steampowered.com
// @updateURL    https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Paralives%20-%20Steam%20Workshop%20Direct%20Download.user.js
// @downloadURL  https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Paralives%20-%20Steam%20Workshop%20Direct%20Download.user.js
// ==/UserScript==

(function() {
    'use strict';

    const PARALIVES_APPID = '1118520';

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
    };

    function isParalivesPage() {
        const url = window.location.href;
        if (url.includes(`appid=${PARALIVES_APPID}`) || url.includes(`/app/${PARALIVES_APPID}/`)) return true;
        if (document.querySelector(`a[href*="${PARALIVES_APPID}"]`) || document.querySelector(`[onclick*="${PARALIVES_APPID}"]`)) return true;
        return false;
    }

    const style = document.createElement('style');
    style.innerHTML = `
        .insane-custom-btn {
            display: inline-flex !important; align-items: center !important; justify-content: center !important;
            padding: 0 15px !important; font-size: 13px !important; font-weight: bold !important;
            border-radius: 2px !important; text-decoration: none !important; white-space: nowrap !important;
            transition: all 0.2s ease-in-out !important; box-sizing: border-box !important;
            font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important; gap: 8px !important;
            z-index: 99 !important; height: 34px !important;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5) !important; margin: 0 !important;
        }
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

        .insane-global-dropdown { position: fixed !important; background: #171a21; border: 1px solid #3d4450; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.9); display: none; flex-direction: column; min-width: 220px; z-index: 2147483647 !important; overflow: hidden; }
        .insane-global-dropdown.show { display: flex; }
        .insane-global-dropdown a { padding: 10px 12px; color: #acb2b8; text-decoration: none; font-size: 12px; transition: background 0.2s; font-family: "Motiva Sans", sans-serif; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .insane-global-dropdown a:hover { background: #3d4450; color: #fff; }

        .insane-custom-tooltip { position: fixed !important; margin: 0 !important; z-index: 2147483647 !important; background: #171a21 !important; border: 1px solid #3d4450 !important; border-radius: 6px !important; padding: 12px !important; color: #acb2b8 !important; font-family: "Motiva Sans", Arial, sans-serif !important; font-size: 13px !important; box-shadow: 0 8px 16px rgba(0,0,0,0.9) !important; pointer-events: none !important; opacity: 0; transition: opacity 0.1s; white-space: nowrap !important; }
        .insane-custom-tooltip.show { opacity: 1 !important; }
        .insane-tooltip-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #3d4450; display: flex; align-items: center; gap: 6px; }
        .insane-tooltip-success { color: #A3E33B; } .insane-tooltip-warning { color: #F59E0B; } .insane-tooltip-error { color: #ff6b6b; }
        .insane-tooltip-row { margin: 4px 0; } .insane-tooltip-label { color: #8f98a0; display: inline-block; width: 60px; } .insane-tooltip-value { color: #E2E8F0; font-weight: 500; }

        #insane-widget-main { display: inline-flex; height: 34px; margin-right: 10px; align-items: center; }
        .insane-widget-container { position: relative; z-index: 10; display: inline-flex; align-items: center; }
        .insane-widget-container:hover { z-index: 9999; }
    `;
    document.head.appendChild(style);

    const dropdownGlobal = document.createElement('div');
    dropdownGlobal.className = 'insane-global-dropdown';

    document.addEventListener('click', (e) => {
        const arrowBtn = e.target.closest('.insane-btn-arrow');
        if (arrowBtn) {
            e.preventDefault(); e.stopPropagation();

            if (dropdownGlobal.classList.contains('show') && dropdownGlobal.lastArrow === arrowBtn) {
                dropdownGlobal.classList.remove('show');
                dropdownGlobal.lastArrow = null;
                return;
            }

            const dialogParent = arrowBtn.closest('dialog');
            const rect = arrowBtn.getBoundingClientRect();
            let topPos = rect.bottom;
            let leftPos = rect.right - 220;

            // Dialogs com transform aplicado distorcem as coordenadas do getBoundingClientRect,
            // então compensamos subtraindo a posição do próprio dialog.
            if (dialogParent) {
                dialogParent.appendChild(dropdownGlobal);
                const style = window.getComputedStyle(dialogParent);
                if (style.transform !== 'none') {
                    const dialogRect = dialogParent.getBoundingClientRect();
                    topPos -= dialogRect.top;
                    leftPos -= dialogRect.left;
                }
            } else {
                document.body.appendChild(dropdownGlobal);
            }

            dropdownGlobal.innerHTML = `
                <a href="https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692" class="insane-bg-link"><span>💬</span> ${t.requestUpdate}</a>
            `;

            dropdownGlobal.style.top = topPos + 'px';
            dropdownGlobal.style.left = leftPos + 'px';

            dropdownGlobal.classList.add('show');
            dropdownGlobal.lastArrow = arrowBtn;
            return;
        }

        if (!e.target.closest('.insane-global-dropdown')) {
            dropdownGlobal.classList.remove('show');
            dropdownGlobal.lastArrow = null;
        }

        const insaneLink = e.target.closest('a.insane-custom-btn, a.insane-bg-link');
        if (insaneLink && insaneLink.href) {
            e.preventDefault(); e.stopPropagation();
            GM_openInTab(insaneLink.href, { active: false, insert: true });
            dropdownGlobal.classList.remove('show');
            dropdownGlobal.lastArrow = null;
        }
    });

    window.addEventListener('scroll', () => {
        dropdownGlobal.classList.remove('show');
        dropdownGlobal.lastArrow = null;
    }, { passive: true });

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'insane-custom-tooltip';
    let hoverTimer;

    function bindTooltip(element, htmlContent) {
        element.addEventListener('mouseenter', () => {
            hoverTimer = setTimeout(() => {
                const dialogParent = element.closest('dialog');
                if (dialogParent) dialogParent.appendChild(tooltipGlobal);
                else document.body.appendChild(tooltipGlobal);

                tooltipGlobal.innerHTML = htmlContent;
                tooltipGlobal.classList.add('show');
            }, 300);
        });

        element.addEventListener('mousemove', (e) => {
            const dialogParent = element.closest('dialog');
            let left = e.clientX + 15, top = e.clientY + 15;
            const tooltipWidth = tooltipGlobal.offsetWidth || 200, tooltipHeight = tooltipGlobal.offsetHeight || 100;

            if (left + tooltipWidth > window.innerWidth - 10) left = e.clientX - tooltipWidth - 15;
            if (top + tooltipHeight > window.innerHeight - 10) top = e.clientY - tooltipHeight - 15;

            if (dialogParent) {
                const style = window.getComputedStyle(dialogParent);
                if (style.transform !== 'none') {
                    const dialogRect = dialogParent.getBoundingClientRect();
                    left -= dialogRect.left;
                    top -= dialogRect.top;
                }
            }

            tooltipGlobal.style.left = left + 'px';
            tooltipGlobal.style.top = top + 'px';
        });

        element.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            tooltipGlobal.classList.remove('show');
        });
    }

    let steamDateCache = {};
    let pendingSteamIDs = new Set();
    let isFetchingBatch = false;

    // A API da Steam aceita até 100 IDs por requisição, então acumulamos os IDs
    // conforme novos cards aparecem no DOM e os enviamos em lotes.
    setInterval(() => {
        if (!isParalivesPage()) return;
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
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.response?.publishedfiledetails) {
                        data.response.publishedfiledetails.forEach(details => {
                            if (details.publishedfileid) {
                                const timestamp = details.time_updated || details.time_created;
                                steamDateCache[details.publishedfileid] = timestamp ? new Date(timestamp * 1000) : 'NO_DATE';
                            }
                        });
                    }
                } catch(e) {}

                idsToFetch.forEach(id => { pendingSteamIDs.delete(id); document.dispatchEvent(new Event(`SteamDateResolved_${id}`)); });
                isFetchingBatch = false;
            },
            onerror: () => { idsToFetch.forEach(id => { pendingSteamIDs.delete(id); document.dispatchEvent(new Event(`SteamDateResolved_${id}`)); }); isFetchingBatch = false; }
        });
    }, 500);

    let insaneDatabaseCache = null;
    let isFetchingInsane = false;
    let fetchQueue = [];

    function fetchInsaneData(callback) {
        if (insaneDatabaseCache !== null) { callback(insaneDatabaseCache); return; }
        fetchQueue.push(callback);
        if (isFetchingInsane) return;
        isFetchingInsane = true;

        GM_xmlhttpRequest({
            method: "GET", url: "https://insane.x10.mx/paralives.php",
            onload: function(response) {
                insaneDatabaseCache = {};
                try {
                    const texto = response.responseText;
                    const indexInicio = texto.indexOf('const allMods = ');
                    if (indexInicio !== -1) {
                        const startStr = indexInicio + 16;
                        const indexFim = texto.indexOf('];', startStr) + 1;
                        if (indexFim > startStr) {
                            JSON.parse(texto.substring(startStr, indexFim)).forEach(mod => {
                                if (mod.name && (mod.link || mod.url)) {
                                    const idSteam = mod.name.match(/^(\d+)/);
                                    if (idSteam) insaneDatabaseCache[idSteam[1]] = { link: mod.link || mod.url, uploaded: mod.uploaded };
                                }
                            });
                        }
                    }
                } catch (e) {}
                fetchQueue.forEach(cb => cb(insaneDatabaseCache)); fetchQueue = [];
            },
            onerror: () => { fetchQueue.forEach(cb => cb(null)); fetchQueue = []; }
        });
    }

    function parseDataInsane(dataString) {
        return dataString ? new Date(dataString.replace(' ', 'T') + '+01:00') : null;
    }

    function renderWidget(container, modId, isCard) {
        const cClass = isCard ? 'insane-custom-btn-compact' : '';
        container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-loading">${t.loading}</a>`;

        fetchInsaneData((db) => {
            if (db === null) { container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-warning">${t.dbError}</a>`; return; }
            if (!db[modId]) {
                container.innerHTML = `<a href="https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692" class="insane-custom-btn ${cClass} insane-state-error">${t.requestMod}</a>`;
                bindTooltip(container.firstElementChild, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> ${t.modNotListed}</div>`);
                return;
            }

            const modData = db[modId];
            const dataInsane = parseDataInsane(modData.uploaded);

            function drawDateComparison() {
                const dataSteam = steamDateCache[modId];
                if (!dataSteam) { container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-loading">${t.checkingVersion}</a>`; pendingSteamIDs.add(modId); return; }

                const strInsane = dataInsane ? dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';
                const strSteam = (dataSteam && dataSteam !== 'NO_DATE') ? dataSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';

                if (dataSteam === 'NO_DATE' || dataInsane >= dataSteam) {
                    container.innerHTML = `<a href="${modData.link}" class="insane-custom-btn ${cClass} insane-state-success">${t.download}</a>`;
                    bindTooltip(container.firstElementChild, `
                        <div class="insane-tooltip-title insane-tooltip-success"><span>✅</span> ${t.modUpdated}</div>
                        <div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div>
                        <div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>
                    `);
                } else {
                    container.innerHTML = `
                        <div class="insane-btn-group">
                            <a href="${modData.link}" class="insane-custom-btn ${cClass} insane-state-warning insane-btn-main">${t.downloadWarning}</a>
                            <button class="insane-custom-btn ${cClass} insane-state-warning insane-btn-arrow">▼</button>
                        </div>
                    `;
                    bindTooltip(container.querySelector('.insane-btn-group'), `
                        <div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> ${t.modOutdated}</div>
                        <div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div>
                        <div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelInsane}</span> <span class="insane-tooltip-value">${strInsane}</span></div>
                    `);
                }
            }
            drawDateComparison();
            document.addEventListener(`SteamDateResolved_${modId}`, drawDateComparison);
        });
    }

    // Roda a cada 1s para detectar novos cards injetados pelo infinite scroll da Steam.
    setInterval(() => {
        if (!isParalivesPage()) return;

        if (window.location.href.includes("steamcommunity.com/sharedfiles/filedetails")) {
            const modId = new URLSearchParams(window.location.search).get('id');
            const steamBtn = document.getElementById('SubscribeItemBtn');
            const subscribeControls = steamBtn ? steamBtn.parentElement : null;

            if (modId && subscribeControls && !document.getElementById('insane-widget-main')) {
                // Força flex no container da Steam para evitar que nosso botão quebre linha.
                subscribeControls.style.display = 'flex';
                subscribeControls.style.flexWrap = 'nowrap';
                subscribeControls.style.alignItems = 'center';
                subscribeControls.style.gap = '10px';
                // Impede que o botão da Steam encolha ao virar flex item.
                steamBtn.style.flexShrink = '0';

                const container = document.createElement('div');
                container.id = 'insane-widget-main';
                steamBtn.insertAdjacentElement('beforebegin', container);
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
                container.className = 'insane-widget-container';
                container.style.marginRight = '8px';

                anchor.insertAdjacentElement('beforebegin', container);
                const modId = new URL(titleLink.href).searchParams.get('id');
                if (modId) renderWidget(container, modId, false);
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

            actionRow.style.setProperty('opacity', '1', 'important');
            actionRow.style.setProperty('visibility', 'visible', 'important');
            actionRow.style.display = 'flex';
            actionRow.style.alignItems = 'center';
            actionRow.style.gap = '6px';

            const container = document.createElement('div');
            container.className = 'insane-widget-container';
            actionRow.prepend(container);

            const modId = new URL(modLink.href).searchParams.get('id');
            if (modId) renderWidget(container, modId, true);
        });

    }, 1000);
})();
