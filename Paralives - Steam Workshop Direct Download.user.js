// ==UserScript==
// @name         Paralives - Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Link direto
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/1118520/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
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
    // SISTEMA VISUAL: TOOLTIP GLOBAL COM COLISÃO
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        .insane-custom-tooltip {
            position: absolute;
            z-index: 9999999 !important;
            background: #171a21;
            border: 1px solid #3d4450;
            border-radius: 6px;
            padding: 12px;
            color: #acb2b8;
            font-family: "Motiva Sans", Arial, Helvetica, sans-serif;
            font-size: 13px;
            box-shadow: 0 8px 16px rgba(0,0,0,0.8);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.1s ease-in-out;
            white-space: nowrap;
        }
        .insane-custom-tooltip.show { opacity: 1; }
        .insane-tooltip-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #3d4450; display: flex; align-items: center; gap: 6px; }
        .insane-tooltip-success { color: #A3E33B; }
        .insane-tooltip-warning { color: #F59E0B; }
        .insane-tooltip-error { color: #EF4444; }
        .insane-tooltip-info { color: #66c0f4; }
        .insane-tooltip-row { margin: 4px 0; }
        .insane-tooltip-label { color: #8f98a0; display: inline-block; width: 60px; }
        .insane-tooltip-value { color: #E2E8F0; font-weight: 500; }
        .insane-tooltip-loading { color: #8f98a0; font-style: italic; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
    `;
    document.head.appendChild(style);

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'insane-custom-tooltip';
    document.body.appendChild(tooltipGlobal);

    let hoveredElement = null;

    function applyCustomTooltip(element, initialHtml) {
        element._tooltipHtml = initialHtml;
        element.addEventListener('mouseenter', () => {
            hoveredElement = element;
            tooltipGlobal.innerHTML = element._tooltipHtml;
            tooltipGlobal.classList.add('show');
        });
        
        element.addEventListener('mousemove', (e) => {
            let left = e.pageX + 15;
            let top = e.pageY + 15;
            
            // Dimensões do Tooltip e da Janela
            const tooltipWidth = tooltipGlobal.offsetWidth;
            const tooltipHeight = tooltipGlobal.offsetHeight;
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            // Se for bater na borda DIREITA da tela, joga o tooltip para a ESQUERDA do mouse
            if (e.clientX + 15 + tooltipWidth > windowWidth - 10) {
                left = e.pageX - tooltipWidth - 15;
            }

            // Se for bater na borda INFERIOR da tela, joga o tooltip para CIMA do mouse
            if (e.clientY + 15 + tooltipHeight > windowHeight - 10) {
                top = e.pageY - tooltipHeight - 15;
            }

            tooltipGlobal.style.left = left + 'px';
            tooltipGlobal.style.top = top + 'px';
        });

        element.addEventListener('mouseleave', () => {
            hoveredElement = null;
            tooltipGlobal.classList.remove('show');
        });
    }

    function updateTooltipHtml(element, newHtml) {
        element._tooltipHtml = newHtml;
        if (hoveredElement === element && tooltipGlobal.classList.contains('show')) {
            tooltipGlobal.innerHTML = newHtml;
        }
    }

    function openBgTab(element, url) {
        element.href = url;
        element.addEventListener('click', (e) => {
            e.preventDefault();
            GM_openInTab(url, { active: false });
        });
    }

    // ==========================================
    // PARSERS E CONVERSORES DE DATA GLOBAIS
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

    // ==========================================
    // CACHE DA STEAM (Busca sob demanda no Hover)
    // ==========================================
    let steamDateCache = {};

    function fetchSteamDateOnHover(modId, element, dataInsane) {
        if (steamDateCache[modId]) {
            aplicarCorETooltip(element, null, steamDateCache[modId], dataInsane);
            return;
        }

        fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`)
            .then(res => res.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");
                const dataSteam = extrairDataDeDom(doc);
                steamDateCache[modId] = dataSteam;
                aplicarCorETooltip(element, null, dataSteam, dataInsane);
            })
            .catch(() => {
                aplicarCorETooltip(element, null, null, dataInsane);
            });
    }

    function aplicarCorETooltip(elementoBotao, spanTexto, dataSteam, dataInsane) {
        if (!dataSteam || !dataInsane) {
            updateTooltipHtml(elementoBotao, `<div class="insane-tooltip-title">Não foi possível comparar as datas</div>`);
            return;
        }

        const strSteam = dataSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'});
        const strInsane = dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'});

        if (dataInsane >= dataSteam) {
            elementoBotao.style.borderColor = '#A3E33B'; 
            elementoBotao.style.backgroundColor = '#2c4015';
            if(spanTexto) spanTexto.style.color = '#a3e33b';
            elementoBotao.style.color = '#a3e33b';
            
            updateTooltipHtml(elementoBotao, `
                <div class="insane-tooltip-title insane-tooltip-success"><span>✅</span> MOD ATUALIZADO</div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Steam:</span> <span class="insane-tooltip-value">${strSteam}</span></div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Insane:</span> <span class="insane-tooltip-value">${strInsane}</span></div>
            `);
        } else {
            elementoBotao.style.borderColor = '#F59E0B'; 
            elementoBotao.style.backgroundColor = '#452a08';
            if(spanTexto) spanTexto.style.color = '#F59E0B';
            elementoBotao.style.color = '#F59E0B';

            updateTooltipHtml(elementoBotao, `
                <div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> MOD DESATUALIZADO</div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Steam:</span> <span class="insane-tooltip-value">${strSteam}</span></div>
                <div class="insane-tooltip-row"><span class="insane-tooltip-label">Insane:</span> <span class="insane-tooltip-value">${strInsane}</span></div>
            `);
        }
    }

    // ==========================================
    // CACHE DO BANCO DE DADOS INSANE
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
                            const jsonExtraido = texto.substring(startStr, indexFim);
                            JSON.parse(jsonExtraido).forEach(mod => {
                                if (mod.name && (mod.link || mod.url)) {
                                    const idSteam = mod.name.match(/^(\d+)/); 
                                    if (idSteam) {
                                        insaneDatabaseCache[idSteam[1]] = { link: mod.link || mod.url, uploaded: mod.uploaded }; 
                                    }
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
        fetchInsaneData((db) => { callback(db && db[modId] ? db[modId] : null); });
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
                insaneBtn.className = 'btn_green_white_innerfade btn_border_2px btn_medium insane-badge';
                insaneBtn.style.cssText = 'cursor: wait; display: inline-flex; align-items: center; justify-content: center; text-decoration: none;';
                
                const span = document.createElement('span');
                span.innerText = 'Buscando mod...';
                insaneBtn.appendChild(span);
                subscribeControls.appendChild(insaneBtn);

                getModDownloadLink(modId, (modData) => {
                    if (modData && modData.link) {
                        span.innerText = 'Baixar no Insane (Direto)';
                        openBgTab(insaneBtn, modData.link);
                        insaneBtn.style.cursor = 'pointer';

                        const dataSteam = extrairDataDeDom(document);
                        const dataInsane = parseDataInsane(modData.uploaded);
                        
                        applyCustomTooltip(insaneBtn, ""); 
                        aplicarCorETooltip(insaneBtn, span, dataSteam, dataInsane);
                    } else {
                        span.innerText = 'Indisponível no Insane';
                        openBgTab(insaneBtn, `https://insane.x10.mx/paralives.php?mod_id=${modId}`);
                        insaneBtn.style.cursor = 'pointer';
                        applyCustomTooltip(insaneBtn, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> Esse ID não existe no banco de dados.</div>`);
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

            function injetarBotao(actionRow, modLink) {
                if ((actionRow.closest('.Panel') || actionRow.parentElement.parentElement)?.querySelector('.insane-badge')) return;
                
                const modId = new URL(modLink.href).searchParams.get('id');
                if (!modId) return;

                const badge = document.createElement('a');
                badge.className = 'insane-badge'; 
                badge.style.cssText = 'display: inline-flex; align-items: center; padding: 6px 12px; font-size: 12px; border-radius: 3px; background-color: #171a21; color: #66c0f4; border: 1px solid rgba(102, 192, 244, 0.4); text-decoration: none; font-weight: bold; white-space: nowrap; height: fit-content; cursor: wait; z-index: 99;';
                badge.innerText = '⏳';
                
                actionRow.style.setProperty('opacity', '1', 'important');
                actionRow.style.setProperty('visibility', 'visible', 'important');
                actionRow.style.display = 'flex';
                actionRow.style.alignItems = 'center';
                actionRow.style.gap = '6px';
                actionRow.prepend(badge);

                getModDownloadLink(modId, (modData) => {
                    if (modData && modData.link) {
                        badge.innerText = '📥 Baixar (Insane)';
                        openBgTab(badge, modData.link);
                        
                        badge.style.cssText += 'background-color: #1a2a3a; color: #66c0f4; border-color: #3b6b8c; cursor: pointer;';
                        
                        const dataInsane = parseDataInsane(modData.uploaded);
                        const strInsane = dataInsane ? dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'Desconhecida';
                        
                        applyCustomTooltip(badge, `
                            <div class="insane-tooltip-title insane-tooltip-info"><span>ℹ️</span> DOWNLOAD PRONTO</div>
                            <div class="insane-tooltip-row"><span class="insane-tooltip-label">Insane:</span> <span class="insane-tooltip-value">${strInsane}</span></div>
                            <div class="insane-tooltip-loading mt-2">🔍 Buscando versão na Steam...</div>
                        `);

                        let isHoverFetched = false;
                        badge.addEventListener('mouseenter', () => {
                            if (!isHoverFetched && dataInsane) {
                                isHoverFetched = true;
                                fetchSteamDateOnHover(modId, badge, dataInsane);
                            }
                        });

                    } else {
                        badge.innerText = '❌ Indisponível';
                        openBgTab(badge, `https://insane.x10.mx/paralives.php?mod_id=${modId}`);
                        badge.style.cssText += 'background-color: #3d1616; color: #ff6b6b; border-color: #8a2b2b; cursor: pointer;';
                        applyCustomTooltip(badge, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> Não listado no banco de dados.</div>`);
                    }
                });
            }

            // ESTRATÉGIA A: CARDS NA TELA DE BUSCA
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

                injetarBotao(actionRow, modLink);
            });

            // ESTRATÉGIA B: POPUPS/MODALS
            document.querySelectorAll('h2 a[href*="sharedfiles/filedetails/?id="]').forEach(titleLink => {
                let modalRoot = titleLink;
                let foundModal = false;
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

                injetarBotao(actionRow, titleLink);
            });

        }, 1000);
    }

})();
