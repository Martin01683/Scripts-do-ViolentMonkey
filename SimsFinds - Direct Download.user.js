// ==UserScript==
// @name         SimsFinds - Direct Download
// @version      26.06.21.0
// @description  Link direto
// @match        https://www.simsfinds.com/*
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/SimsFinds%20-%20Direct%20Download.user.js
// @downloadURL  https://raw.githubusercontent.com/Martin01683/Scripts-do-ViolentMonkey/main/SimsFinds%20-%20Direct%20Download.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* ══════════════════════════════════════════════
       OCULTAR ELEMENTOS / ANÚNCIOS ESPECÍFICOS
    ══════════════════════════════════════════════ */
    const hideStyle = document.createElement('style');
    hideStyle.textContent = `
        #principal > ._pu6b278e9._pu3b128a,
        #gl7b584e9a,
        #dl7d396e5a > ._pu6b278e9._pu3b128a {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            width: 0 !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
    `;
    document.head.appendChild(hideStyle);

    const path = window.location.pathname;

    /* ══════════════════════════════════════════════
       MODO A — Página /continue?key=...
    ══════════════════════════════════════════════ */
    function handleContinuePage() {
        console.log('[SimsFinds AutoDL] Tentando BURLAR o timer (Instant Bypass)...');

        try {
            const body = document.body;
            const pass = body.dataset.passe;
            const dvc = body.dataset.dispositivo || '1';

            const sfpExtra = document.querySelector('sfpdata[name="page:extra"]');
            const cid = sfpExtra ? sfpExtra.dataset.itemId : null;
            const version = sfpExtra ? sfpExtra.dataset.version : null;

            const urlParams = new URLSearchParams(window.location.search);
            const key = urlParams.get('key');

            let flid = '';
            const dlBtn = document.querySelector('button._bt-download');
            if (dlBtn) {
                for (const prop in dlBtn.dataset) {
                    const val = dlBtn.dataset[prop];
                    if (/^\d{14,18}$/.test(val)) {
                        flid = val;
                        break;
                    }
                }
            }

            if (key && cid && pass && version) {
                let instantUrl = `https://click.simsfinds.com/download?key=${key}&cid=${cid}&pass=${pass}&dvc=${dvc}&version=${version}&etr=1`;
                if (flid) instantUrl += `&flid=${flid}`;

                console.log('[SimsFinds AutoDL] Download DIRETO detectado! Baixando e fechando a aba...');

                window.location.href = instantUrl;

                // REDUZIDO PARA 1 SEGUNDO (1000ms)
                // É o tempo mínimo seguro para o navegador iniciar o download antes da aba morrer.
                setTimeout(() => window.close(), 1000);
                return;
            }
        } catch (e) {
            console.error('[SimsFinds AutoDL] Falha ao montar o bypass:', e);
        }

        // ==========================================
        // PLANO B: Download Normal (Timer)
        // ==========================================
        console.log('[SimsFinds AutoDL] Iniciando Plano B (esperando timer oficial)...');
        const checkInterval = setInterval(() => {
            const readyText = document.querySelector('#ct7n368e4j');
            if (readyText && !readyText.classList.contains('_hidden')) {
                clearInterval(checkInterval);
                const btn = document.querySelector('button._bt-download');
                if (btn) {
                    console.log('[SimsFinds AutoDL] Timer concluído! Clicando no botão. (Aba mantida aberta)');
                    btn.click();
                    // Mantém a aba aberta pois depende do site servir o arquivo oficial
                }
            }
        }, 1000);
    }

    /* ══════════════════════════════════════════════
       MODO B — Página do item /downloads/...
    ══════════════════════════════════════════════ */
    function handleItemPage() {
        const sfpdata = document.querySelector('sfpdata[name="page:extra"][data-continue]');
        if (!sfpdata) return;

        const continueUrl = sfpdata.dataset.continue;
        if (!continueUrl) return;

        const dlBtn = document.querySelector('button._bt-download');
        if (dlBtn) {
            dlBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                window.location.href = continueUrl;
            }, true);
        }

        document.querySelectorAll('#dl7d251e9e, #dl7d251e9s, #dl7d251e9k')
                .forEach(el => el.style.display = 'none');
    }

    /* ══════════════════════════════════════════════
       MODO C — Feed / listagens
    ══════════════════════════════════════════════ */
    function handleListingPage() {
        const iconDownload = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
        const iconLoading = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path><style>@keyframes spin { 100% { transform: rotate(360deg); } }</style></svg>`;
        const iconCheck = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        const iconError = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

        const style = document.createElement('style');
        style.textContent = `
            .sfadl-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                height: 100%;
                min-width: 44px;
                min-height: 44px;
                border: none;
                border-radius: 12px;
                background: linear-gradient(135deg, #11998e, #38ef7d);
                color: #ffffff;
                cursor: pointer;
                padding: 0;
                box-sizing: border-box;
                box-shadow: 0 4px 10px rgba(56, 239, 125, 0.3);
                transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            }
            .sfadl-btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 6px 15px rgba(56, 239, 125, 0.5);
            }
            .sfadl-btn:active {
                transform: translateY(1px);
                box-shadow: 0 2px 5px rgba(56, 239, 125, 0.3);
            }
            .sfadl-btn:disabled {
                background: linear-gradient(135deg, #7f8c8d, #95a5a6);
                box-shadow: none;
                cursor: not-allowed;
                transform: none;
            }
            .sfadl-btn.s-loading { background: linear-gradient(135deg, #2980b9, #3498db); box-shadow: 0 4px 10px rgba(52, 152, 219, 0.3); }
            .sfadl-btn.s-error   { background: linear-gradient(135deg, #c0392b, #e74c3c); box-shadow: 0 4px 10px rgba(231, 76, 60, 0.3); }
        `;
        document.head.appendChild(style);

        const injected = new WeakSet();
        const cache    = {};

        async function getContinueUrl(itemPageUrl) {
            if (cache[itemPageUrl]) return cache[itemPageUrl];
            const res = await fetch(itemPageUrl, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            const doc  = new DOMParser().parseFromString(html, 'text/html');
            const sfp  = doc.querySelector('sfpdata[name="page:extra"][data-continue]');
            const url  = sfp?.dataset?.continue || null;
            if (url) cache[itemPageUrl] = url;
            return url;
        }

        function openInBackground(url) {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(url, { active: false, insert: true });
            } else {
                window.open(url, '_blank');
            }
        }

        function injectButton(dlAnchor) {
            if (injected.has(dlAnchor)) return;

            const itemPageUrl = dlAnchor.href;
            if (!itemPageUrl || (!itemPageUrl.includes('/downloads/') && !itemPageUrl.includes('/go?'))) return;

            injected.add(dlAnchor);

            const btn = document.createElement('button');
            btn.className = 'sfadl-btn';
            btn.innerHTML = iconDownload;
            btn.title     = 'Download em segundo plano';

            dlAnchor.parentElement.replaceChild(btn, dlAnchor);

            function set(state, icon) {
                btn.className = `sfadl-btn${state !== 'idle' ? ` s-${state}` : ''}`;
                btn.disabled  = state === 'loading';
                btn.innerHTML = icon;
            }

            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                set('loading', iconLoading);

                try {
                    const url = await getContinueUrl(itemPageUrl);
                    if (!url) throw new Error('data-continue não encontrado');

                    set('idle', iconCheck);
                    openInBackground(url);
                    setTimeout(() => set('idle', iconDownload), 3000);
                } catch (err) {
                    console.error('[SimsFinds AutoDL]', err);
                    set('error', iconError);
                    setTimeout(() => {
                        window.open(itemPageUrl, '_blank');
                        set('idle', iconDownload);
                    }, 1500);
                }
            });
        }

        function scanCards() {
            document.querySelectorAll('a[aria-label="Download"][data-item-id]').forEach(injectButton);
        }

        scanCards();
        new MutationObserver(scanCards).observe(document.body, { childList: true, subtree: true });
    }

    /* ══════════════════════════════════════════════
       Roteamento
    ══════════════════════════════════════════════ */
    if (window.location.search.includes('key=') && path.startsWith('/continue')) {
        handleContinuePage();
    } else if (path.includes('/downloads/')) {
        handleItemPage();
        handleListingPage();
    } else {
        handleListingPage();
    }

    console.log('[SimsFinds AutoDL] v1.1 ativo —', path);
})();
