// ==UserScript==
// @name         Paralives - Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Link direto
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/1118520/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      insane.x10.mx
// @updateURL    https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Paralives%20-%20Steam%20Workshop%20Direct%20Download.user.js
// @downloadURL  https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/Paralives%20-%20Steam%20Workshop%20Direct%20Download.user.js
// ==/UserScript==

(function() {
    'use strict';

    const currentUrl = window.location.href;
    const PARALIVES_APPID = '1118520';
    let isParalives = false;

    // ==========================================
    // 0. TRAVA DE SEGURANÇA
    // ==========================================
    if (currentUrl.includes(`appid=${PARALIVES_APPID}`) || currentUrl.includes(`/app/${PARALIVES_APPID}/`)) {
        isParalives = true;
    } else if (currentUrl.includes("steamcommunity.com/sharedfiles/filedetails")) {
        if (document.querySelector(`a[href*="${PARALIVES_APPID}"]`) || document.querySelector(`[onclick*="${PARALIVES_APPID}"]`)) {
            isParalives = true;
        }
    }

    if (!isParalives) return;

    // ==========================================
    // EXTRAÇÃO SILENCIOSA DE DADOS DA STEAM
    // ==========================================
    let steamDateCache = {};

    function extractSteamDatesFromSSR() {
        try {
            let ctx = null;
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.SSR && unsafeWindow.SSR.renderContext) {
                ctx = unsafeWindow.SSR.renderContext;
            } else {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    if (script.textContent.includes('window.SSR.renderContext')) {
                        const match = script.textContent.match(/window\.SSR\.renderContext\s*=\s*JSON\.parse\((.*)\);/);
                        if (match) {
                            const jsonString = JSON.parse(match[1]);
                            ctx = JSON.parse(jsonString);
                            break;
                        }
                    }
                }
            }

            if (ctx && ctx.queryData) {
                const queries = JSON.parse(ctx.queryData).queries;
                queries.forEach(q => {
                    // Página de busca (/workshop/browse/) — usa "workshop_browse" com { results: [...] }
                    if (q.queryKey && q.queryKey[0] === 'workshop_browse' && q.state?.data?.results) {
                        q.state.data.results.forEach(mod => {
                            if (mod.publishedfileid && mod.time_updated)
                                steamDateCache[mod.publishedfileid] = new Date(mod.time_updated * 1000);
                        });
                    }
                    // Home do app (/app/1118520/workshop/) — usa "workshop_query" com array direto
                    if (q.queryKey && q.queryKey[0] === 'workshop_query' && Array.isArray(q.state?.data)) {
                        q.state.data.forEach(mod => {
                            if (mod.publishedfileid && mod.time_updated)
                                steamDateCache[mod.publishedfileid] = new Date(mod.time_updated * 1000);
                        });
                    }
                });
            }
        } catch(e) {}
    }

    function interceptNetworkToExtractDates() {
        function extractModsFromObject(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(item => {
                    if (item && item.publishedfileid && item.time_updated) {
                        steamDateCache[item.publishedfileid] = new Date(item.time_updated * 1000);
                    } else {
                        extractModsFromObject(item);
                    }
                });
            } else {
                Object.values(obj).forEach(val => extractModsFromObject(val));
            }
        }

        if (typeof unsafeWindow !== 'undefined') {
            if (unsafeWindow.fetch) {
                const originalFetch = unsafeWindow.fetch;
                unsafeWindow.fetch = async function(...args) {
                    const response = await originalFetch.apply(this, args);
                    try {
                        const clone = response.clone();
                        clone.json().then(data => extractModsFromObject(data)).catch(() => {});
                    } catch (e) {}
                    return response;
                };
            }
            if (unsafeWindow.XMLHttpRequest) {
                const originalOpen = unsafeWindow.XMLHttpRequest.prototype.open;
                unsafeWindow.XMLHttpRequest.prototype.open = function() {
                    this.addEventListener('load', function() {
                        try {
                            const type = this.getResponseHeader('content-type');
                            if (type && type.includes('application/json')) {
                                extractModsFromObject(JSON.parse(this.responseText));
                            }
                        } catch (e) {}
                    });
                    originalOpen.apply(this, arguments);
                };
            }
        }
    }

    extractSteamDatesFromSSR();
    interceptNetworkToExtractDates();

    // ==========================================
    // SISTEMA VISUAL: CSS DE BOTÕES E TOOLTIP
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        /* Estilos base dos Botões Insane */
        .insane-custom-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 8px 16px !important;
            font-size: 13px !important;
            font-weight: bold !important;
            border-radius: 4px !important;
            text-decoration: none !important;
            white-space: nowrap !important;
            transition: all 0.2s ease-in-out !important;
            box-sizing: border-box !important;
            font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
            gap: 8px !important;
            z-index: 99 !important;
            height: fit-content !important;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5) !important;
        }

        /*
         * Variante compacta — usada APENAS nos cards da listagem de busca.
         * NÃO é aplicada no modal nem na página do mod.
         */
        .insane-custom-btn-compact {
            padding: 2px 8px !important;
            font-size: 11px !important;
            border-radius: 3px !important;
            gap: 4px !important;
            line-height: 1.2 !important;
        }

        .insane-custom-btn:hover {
            transform: translateY(-2px) !important;
            box-shadow: 0 4px 10px rgba(0,0,0,0.4) !important;
            filter: brightness(1.15) !important;
        }
        .insane-custom-btn:active {
            transform: translateY(1px) !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
            filter: brightness(0.9) !important;
        }

        /* Cores e Estados dos Botões */
        .insane-state-loading {
            background: linear-gradient(to bottom, #343f4d 5%, #222933 95%) !important;
            color: #acb2b8 !important; border: 1px solid #455366 !important; cursor: wait !important;
        }
        .insane-state-info {
            background: linear-gradient(to bottom, #1a3c54 5%, #122436 95%) !important;
            color: #66c0f4 !important; border: 1px solid #2b5575 !important; cursor: pointer !important;
        }
        .insane-state-success {
            background: linear-gradient(to bottom, #3f5c1e 5%, #2c4015 95%) !important;
            color: #A3E33B !important; border: 1px solid #5a852a !important; cursor: pointer !important;
        }
        .insane-state-warning {
            background: linear-gradient(to bottom, #6b410c 5%, #452a08 95%) !important;
            color: #F59E0B !important; border: 1px solid #995c10 !important; cursor: pointer !important;
        }
        .insane-state-error {
            background: linear-gradient(to bottom, #612222 5%, #3d1616 95%) !important;
            color: #ff6b6b !important; border: 1px solid #8c3232 !important; cursor: pointer !important;
        }

        /* Estilos do Tooltip */
        .insane-custom-tooltip {
            position: fixed !important; margin: 0 !important; right: auto !important; bottom: auto !important;
            z-index: 2147483647 !important; background: #171a21 !important; border: 1px solid #3d4450 !important;
            border-radius: 6px !important; padding: 12px !important; color: #acb2b8 !important;
            font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important; font-size: 13px !important;
            box-shadow: 0 8px 16px rgba(0,0,0,0.9) !important; pointer-events: none !important; opacity: 0;
            transition: opacity 0.1s ease-in-out; white-space: nowrap !important;
        }
        .insane-custom-tooltip.show { opacity: 1 !important; }
        .insane-tooltip-title { font-weight: bold !important; font-size: 14px !important; margin-bottom: 8px !important; padding-bottom: 6px !important; border-bottom: 1px solid #3d4450 !important; display: flex !important; align-items: center !important; gap: 6px !important; }
        .insane-tooltip-success { color: #A3E33B !important; }
        .insane-tooltip-warning { color: #F59E0B !important; }
        .insane-tooltip-error { color: #ff6b6b !important; }
        .insane-tooltip-info { color: #66c0f4 !important; }
        .insane-tooltip-row { margin: 4px 0 !important; }
        .insane-tooltip-label { color: #8f98a0 !important; display: inline-block !important; width: 60px !important; }
        .insane-tooltip-value { color: #E2E8F0 !important; font-weight: 500 !important; }
        .insane-tooltip-loading { color: #8f98a0 !important; font-style: italic !important; animation: pulse 1.5s infinite !important; }
        @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
    `;
    document.head.appendChild(style);

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'insane-custom-tooltip';
    if ('popover' in tooltipGlobal) tooltipGlobal.setAttribute('popover', 'manual');
    document.body.appendChild(tooltipGlobal);

    let hoveredElement = null;

    function applyCustomTooltip(element, initialHtml) {
        element._tooltipHtml = initialHtml;

        element.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            hoveredElement = element;
            tooltipGlobal.innerHTML = element._tooltipHtml;

            if (typeof tooltipGlobal.showPopover === 'function') {
                try { if (!tooltipGlobal.matches(':popover-open')) tooltipGlobal.showPopover(); } catch(err) {}
            } else {
                const parentDialog = element.closest('dialog');
                if (parentDialog) parentDialog.appendChild(tooltipGlobal);
                else document.body.appendChild(tooltipGlobal);
            }
            tooltipGlobal.classList.add('show');
        });

        element.addEventListener('mouseover', (e) => e.stopPropagation());

        element.addEventListener('mousemove', (e) => {
            e.stopPropagation();
            let left = e.clientX + 15, top = e.clientY + 15;
            const tooltipWidth = tooltipGlobal.offsetWidth || 200, tooltipHeight = tooltipGlobal.offsetHeight || 100;
            const windowWidth = window.innerWidth, windowHeight = window.innerHeight;

            if (e.clientX + 15 + tooltipWidth > windowWidth - 10) left = e.clientX - tooltipWidth - 15;
            if (e.clientY + 15 + tooltipHeight > windowHeight - 10) top = e.clientY - tooltipHeight - 15;

            tooltipGlobal.style.setProperty('left', left + 'px', 'important');
            tooltipGlobal.style.setProperty('top', top + 'px', 'important');
        });

        element.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            hoveredElement = null;
            tooltipGlobal.classList.remove('show');
            if (typeof tooltipGlobal.hidePopover === 'function') {
                try { if (tooltipGlobal.matches(':popover-open')) tooltipGlobal.hidePopover(); } catch(err) {}
            }
        });
    }

    function updateTooltipHtml(element, newHtml) {
        element._tooltipHtml = newHtml;
        if (hoveredElement === element && tooltipGlobal.classList.contains('show')) tooltipGlobal.innerHTML = newHtml;
    }

    function setLinkAction(element, url, makeActive = false) {
        element.href = url;
        element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            GM_openInTab(url, { active: makeActive });
        });
    }

    // ==========================================
    // PARSERS DE DATA E ATUALIZAÇÃO VISUAL
    // ==========================================
    function parseDataInsane(dataString) {
        if (!dataString) return null;
        return new Date(dataString.replace(' ', 'T') + '+01:00');
    }

    function converterTextoParaData(texto) {
        if (!texto) return null;
        const meses = { 'jan':0, 'fev':1, 'mar':2, 'abr':3, 'mai':4, 'jun':5, 'jul':6, 'ago':7, 'set':8, 'out':9, 'nov':10, 'dez':11 };
        const match = texto.match(/(\d+)\s*de\s*([a-z]+)\.?\s*(?:de\s*(\d{4}))?(?:\s*às\s*(\d{1,2}:\d{2}))?/i);
        if (match) {
            const dia = parseInt(match[1]);
            const mesStr = match[2].toLowerCase().substring(0, 3);
            const mes = meses[mesStr] !== undefined ? meses[mesStr] : 0;
            const ano = match[3] ? parseInt(match[3]) : new Date().getFullYear();
            let hora = 0, minuto = 0;
            if (match[4]) {
                const [h, m] = match[4].split(':');
                hora = parseInt(h); minuto = parseInt(m);
            }
            return new Date(ano, mes, dia, hora, minuto);
        }
        return null;
    }

    function extrairDataDeDom(docContext) {
        const labels = docContext.querySelectorAll('.detailsStatLeft');
        let indexAlvo = -1;
        labels.forEach((el, index) => {
            if (el.textContent.includes('Atualizado em') || (indexAlvo === -1 && el.textContent.includes('Publicado em'))) indexAlvo = index;
        });
        if (indexAlvo !== -1) {
            const valores = docContext.querySelectorAll('.detailsStatRight');
            if (valores[indexAlvo]) return converterTextoParaData(valores[indexAlvo].textContent.trim());
        }
        const textoGeral = docContext.body.textContent || docContext.body.innerText;
        const match = textoGeral.match(/(?:atualizado em|última atualização|publicado em|data da publicação):?\s*(\d+)\s*de\s*([a-z]+)\.?\s*(?:de\s*(\d{4}))?(?:\s*às\s*(\d{1,2}:\d{2}))?/i);
        if (match) return converterTextoParaData(match[0]);
        return null;
    }

    function fetchSteamDateFallback(modId, element, dataInsane) {
        fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`)
            .then(res => res.text())
            .then(html => {
                const doc = new DOMParser().parseFromString(html, "text/html");
                const dataSteam = extrairDataDeDom(doc);
                steamDateCache[modId] = dataSteam;
                aplicarCorETooltip(element, null, dataSteam, dataInsane);
            })
            .catch(() => aplicarCorETooltip(element, null, null, dataInsane));
    }

    function aplicarCorETooltip(elementoBotao, spanTexto, dataSteam, dataInsane) {
        if (!dataSteam || !dataInsane) {
            updateTooltipHtml(elementoBotao, `<div class="insane-tooltip-title">Não foi possível comparar as datas</div>`);
            return;
        }

        const strSteam = dataSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'});
        const strInsane = dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'});

        // Remove apenas as classes de estado, preservando insane-custom-btn e insane-custom-btn-compact
        elementoBotao.classList.remove('insane-state-loading', 'insane-state-info', 'insane-state-warning', 'insane-state-error', 'insane-state-success');

        if (dataInsane >= dataSteam) {
            elementoBotao.classList.add('insane-state-success');
            if(spanTexto) spanTexto.innerText = '✅ Baixar Direto';
            else elementoBotao.innerText = '✅ Baixar';

            updateTooltipHtml(elementoBotao, `
                <div class="insane-tooltip-title insane-tooltip-success"><span>✅</span> MOD ATUALIZADO</div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Steam:</span> <span class="insane-tooltip-value">${strSteam}</span></div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Insane:</span> <span class="insane-tooltip-value">${strInsane}</span></div>
            `);
        } else {
            elementoBotao.classList.add('insane-state-warning');
            if(spanTexto) spanTexto.innerText = '⚠️ Baixar Direto';
            else elementoBotao.innerText = '⚠️ Baixar';

            updateTooltipHtml(elementoBotao, `
                <div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> MOD DESATUALIZADO</div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Steam:</span> <span class="insane-tooltip-value">${strSteam}</span></div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Insane:</span> <span class="insane-tooltip-value">${strInsane}</span></div>
            `);
        }
    }

    // ==========================================
    // CACHE DO BANCO DE DADOS E LÓGICA DE STATUS
    // ==========================================
    let insaneDatabaseCache = null;
    let isFetching = false;
    let fetchQueue = [];

    function fetchInsaneData(callback) {
        if (insaneDatabaseCache !== null) { callback(insaneDatabaseCache); return; }
        fetchQueue.push(callback);
        if (isFetching) return;
        isFetching = true;

        GM_xmlhttpRequest({
            method: "GET", url: "https://insane.x10.mx/paralives.php",
            onload: function(response) {
                insaneDatabaseCache = {};
                try {
                    const texto = response.responseText;
                    const marcadorInicio = 'const allMods = ';
                    const indexInicio = texto.indexOf(marcadorInicio);
                    if (indexInicio !== -1) {
                        const startStr = indexInicio + marcadorInicio.length;
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
                } catch (erro) {}
                fetchQueue.forEach(cb => cb(insaneDatabaseCache));
                fetchQueue = [];
            },
            onerror: function() { fetchQueue.forEach(cb => cb(null)); fetchQueue = []; }
        });
    }

    function getModDownloadLink(modId, callback) {
        fetchInsaneData((db) => {
            if (db === null) callback({ status: 'error' });
            else if (db[modId]) callback({ status: 'found', data: db[modId] });
            else callback({ status: 'missing' });
        });
    }

    // ==========================================
    // 1. PÁGINA PRINCIPAL DO MOD
    // ==========================================
    if (currentUrl.includes("steamcommunity.com/sharedfiles/filedetails")) {
        const urlParams = new URLSearchParams(window.location.search);
        const modId = urlParams.get('id');
        if (!modId) return;

        const injectButton = setInterval(() => {
            let subscribeControls = document.querySelector('.subscribeControls') ||
                                    (document.getElementById('SubscribeItemBtn')?.parentElement) ||
                                    Array.from(document.querySelector('.game_area_purchase_game')?.children || []).find(el => el.tagName === 'DIV');

            if (!subscribeControls) {
                const rightCol = document.querySelector('.rightDetailsBlock') || document.querySelector('.workshopItemDetailsHeader');
                if (rightCol) {
                    subscribeControls = document.createElement('div');
                    subscribeControls.className = 'subscribeControls_forced';
                    subscribeControls.style.cssText = 'margin-top: 15px; padding: 10px; background-color: rgba(0, 0, 0, 0.3); border-radius: 3px;';
                    rightCol.appendChild(subscribeControls);
                }
            }

            if (subscribeControls && !document.getElementById('insane-download-btn')) {
                clearInterval(injectButton);
                subscribeControls.style.display = 'flex';
                subscribeControls.style.gap = '10px';
                subscribeControls.style.alignItems = 'center';
                subscribeControls.style.flexWrap = 'wrap';

                const insaneBtn = document.createElement('a');
                insaneBtn.id = 'insane-download-btn';
                insaneBtn.className = 'insane-custom-btn insane-state-loading';

                const span = document.createElement('span');
                span.innerText = '⏳ Buscando...';
                insaneBtn.appendChild(span);
                subscribeControls.appendChild(insaneBtn);

                getModDownloadLink(modId, (result) => {
                    insaneBtn.classList.remove('insane-state-loading');

                    if (result.status === 'found') {
                        const modData = result.data;
                        span.innerText = '📥 Baixar Direto';
                        insaneBtn.classList.add('insane-state-info');
                        setLinkAction(insaneBtn, modData.link, false);

                        const dataSteam = extrairDataDeDom(document);
                        const dataInsane = parseDataInsane(modData.uploaded);

                        applyCustomTooltip(insaneBtn, "");
                        aplicarCorETooltip(insaneBtn, span, dataSteam, dataInsane);
                    } else if (result.status === 'missing') {
                        span.innerText = '➕ Pedir Mod';
                        insaneBtn.classList.add('insane-state-error');
                        setLinkAction(insaneBtn, 'https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692', true);
                        applyCustomTooltip(insaneBtn, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> Mod ausente do banco de dados. Clique para pedir no fórum.</div>`);
                    } else {
                        span.innerText = '⚠️ Erro de Conexão';
                        insaneBtn.classList.add('insane-state-warning');
                        applyCustomTooltip(insaneBtn, `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> Falha ao conectar com o servidor (Insane).</div>`);
                    }
                });
            }
        }, 500);
        setTimeout(() => clearInterval(injectButton), 10000);
    }

    // ==========================================
    // 2 & 3. CARDS DE BUSCA E MODALS
    // ==========================================
    if (currentUrl.includes("steamcommunity.com/workshop/browse") || currentUrl.includes(`steamcommunity.com/app/${PARALIVES_APPID}/workshop`)) {
        setInterval(() => {

            // FIX v2.5: parâmetro isCard controla se o botão usa tamanho compacto (cards)
            // ou tamanho normal igual ao botão da Steam (modais).
            function injetarBotao(actionRow, modLink, isCard = false) {
                if ((actionRow.closest('.Panel') || actionRow.parentElement.parentElement)?.querySelector('.insane-custom-btn')) return;

                const modId = new URL(modLink.href).searchParams.get('id');
                if (!modId) return;

                const badge = document.createElement('a');
                // Compacto apenas nos cards da listagem; modal usa o tamanho base
                badge.className = 'insane-custom-btn' + (isCard ? ' insane-custom-btn-compact' : '') + ' insane-state-loading';
                badge.innerText = '⏳';

                actionRow.style.setProperty('opacity', '1', 'important');
                actionRow.style.setProperty('visibility', 'visible', 'important');
                actionRow.style.display = 'flex';
                actionRow.style.alignItems = 'center';
                actionRow.style.gap = '6px';
                actionRow.prepend(badge);

                getModDownloadLink(modId, (result) => {
                    badge.classList.remove('insane-state-loading');

                    if (result.status === 'found') {
                        const modData = result.data;
                        badge.innerText = '📥 Baixar';
                        badge.classList.add('insane-state-info');
                        setLinkAction(badge, modData.link, false);

                        const dataInsane = parseDataInsane(modData.uploaded);
                        let isHoverFetched = false;

                        if (dataInsane && steamDateCache[modId]) {
                            isHoverFetched = true;
                            applyCustomTooltip(badge, "");
                            aplicarCorETooltip(badge, null, steamDateCache[modId], dataInsane);
                        } else {
                            const strInsane = dataInsane ? dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'Desconhecida';

                            applyCustomTooltip(badge, `
                                <div class="insane-tooltip-title insane-tooltip-info"><span>ℹ️</span> DOWNLOAD PRONTO</div>
                                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Insane:</span> <span class="insane-tooltip-value">${strInsane}</span></div>
                                <div class="insane-tooltip-loading mt-2">Passe o mouse para checar versão...</div>
                            `);

                            badge.addEventListener('mouseenter', () => {
                                if (!isHoverFetched && dataInsane) {
                                    if (steamDateCache[modId]) {
                                        isHoverFetched = true;
                                        aplicarCorETooltip(badge, null, steamDateCache[modId], dataInsane);
                                        return;
                                    }
                                    badge._hoverTimer = setTimeout(() => {
                                        isHoverFetched = true;
                                        fetchSteamDateFallback(modId, badge, dataInsane);
                                    }, 1500);
                                }
                            });

                            badge.addEventListener('mouseleave', () => {
                                if (badge._hoverTimer) clearTimeout(badge._hoverTimer);
                            });
                        }

                    } else if (result.status === 'missing') {
                        badge.innerText = '➕ Pedir Mod';
                        badge.classList.add('insane-state-error');
                        setLinkAction(badge, 'https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692', true);
                        applyCustomTooltip(badge, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> Mod não listado. Clique para pedir no fórum.</div>`);
                    } else {
                        badge.innerText = '⚠️ Erro';
                        badge.classList.add('insane-state-warning');
                        applyCustomTooltip(badge, `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> Falha de conexão.</div>`);
                    }
                });
            }

            // Cards da listagem → botão COMPACTO (isCard = true)
            document.querySelectorAll('.SVGIcon_MagnifyingGlass').forEach(zoomIcon => {
                const actionRow = (zoomIcon.closest('[role="button"]') || zoomIcon.parentElement)?.parentElement;
                if (!actionRow) return;

                let modLink = null, cardContainer = actionRow.parentElement;
                for (let i = 0; i < 5; i++) {
                    if (!cardContainer) break;
                    modLink = cardContainer.querySelector('a[href*="sharedfiles/filedetails/?id="]');
                    if (modLink) break;
                    cardContainer = cardContainer.parentElement;
                }
                if (!modLink || modLink.parentElement.tagName === 'H2') return;

                injetarBotao(actionRow, modLink, true); // compacto nos cards
            });

            // Modal de preview → botão NORMAL, mesmo tamanho do botão da Steam (isCard = false)
            document.querySelectorAll('h2 a[href*="sharedfiles/filedetails/?id="]').forEach(titleLink => {
                let modalRoot = titleLink, foundModal = false;
                while (modalRoot && modalRoot.tagName !== 'BODY') {
                    if (modalRoot.querySelector('.SVGIcon_X')) { foundModal = true; break; }
                    modalRoot = modalRoot.parentElement;
                }
                if (!foundModal) {
                    modalRoot = titleLink;
                    for(let i = 0; i < 6; i++) { if(modalRoot.parentElement) modalRoot = modalRoot.parentElement; }
                }

                const subscribeBtn = Array.from(modalRoot.querySelectorAll('button')).find(b =>
                    b.getAttribute('data-accent-color') === 'green' ||
                    (b.innerText && b.innerText.toLowerCase().includes('inscrever')) ||
                    (b.innerText && b.innerText.toLowerCase().includes('inscrito')) ||
                    b.querySelector('.SVGIcon_Plus')
                );

                if (!subscribeBtn) return;
                const actionRow = subscribeBtn.closest('.tool-tip-source')?.parentElement || subscribeBtn.parentElement;
                if (!actionRow) return;

                injetarBotao(actionRow, titleLink, false); // tamanho normal no modal
            });
        }, 1000);
    }
})();
