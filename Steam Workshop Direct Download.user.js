// ==UserScript==
// @name         Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      26.06.27.01
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
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
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
    /**
     * Configurações persistentes do usuário.
     * showCacheInfo:  0 = oculto (padrão), 1 = visível — controla o bloco "Status do Cache" no tooltip.
     * showMirrorInfo: 1 = visível (padrão), 0 = oculto — controla o bloco "Mirrors verificados" no tooltip.
     * Alteradas pelo botão flutuante de configurações (FAB) no canto inferior direito da tela.
     */
    let showCacheInfo  = GM_getValue('showCacheInfo',  0);
    let showMirrorInfo = GM_getValue('showMirrorInfo', 1);

    /**
     * Sincronização entre abas: propaga mudanças de configuração feitas em outra aba
     * para este contexto do script (outra janela/aba do navegador com a mesma origem).
     *
     * `remote === true` indica que a mudança veio de outro contexto (outra aba);
     * mudanças locais têm `remote === false` e já são tratadas pelo handler de clique no
     * painel — ignorá-las aqui evita double-render.
     *
     * Nota: `document.getElementById` é usado no lugar de `settingsPanel` (definido no
     * Módulo 9) porque estes listeners são registrados antes que o elemento exista no DOM.
     * Os callbacks só disparam de forma assíncrona (outra aba precisa alterar um valor),
     * então o elemento sempre existe quando o callback é invocado. Caso haja corrida
     * improvável, `getElementById` retorna `null` e o `&&` curto-circuita com segurança.
     */
    GM_addValueChangeListener('showCacheInfo', function(name, oldVal, newVal, remote) {
        if (!remote) return;
        showCacheInfo = newVal;
        closeTooltipIfOpen();
        reRenderAllWidgets();
        var panelEl = document.getElementById('swdd-settings-panel');
        if (panelEl && panelEl.classList.contains('swdd-panel-show')) {
            panelEl.innerHTML = buildSettingsPanelHtml();
        }
    });
    GM_addValueChangeListener('showMirrorInfo', function(name, oldVal, newVal, remote) {
        if (!remote) return;
        showMirrorInfo = newVal;
        closeTooltipIfOpen();
        reRenderAllWidgets();
        var panelEl = document.getElementById('swdd-settings-panel');
        if (panelEl && panelEl.classList.contains('swdd-panel-show')) {
            panelEl.innerHTML = buildSettingsPanelHtml();
        }
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
                        console.warn('[SWDD]', t.consoleStorageQuotaCleanup);
                        this.clearByPrefix('SWDD_');
                        localStorage.setItem(key, JSON.stringify(dataObj));
                    } catch(err) {
                        console.error('[SWDD]', t.consoleCacheWriteFailed, err);
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
    // MÓDULO 0.2: PER-MOD REQUEST LIMITER (Semáforo de Concorrência por Mirror)
    //
    // Problema: mirrors do tipo "per_mod" fazem UMA requisição HTTP por mod.
    // Com scroll rápido, o IntersectionObserver pode disparar renderWidget()
    // para muitos itens ao mesmo tempo, gerando um burst de requisições
    // simultâneas para o mesmo mirror — suficiente para acionar o rate limit
    // do Cloudflare (tipicamente ~20 req/min por IP para endpoints de API).
    //
    // Solução: semáforo FIFO independente por mirror. Cada mirror tem seu
    // próprio limitador com MAX_CONCURRENT slots. Quando todos os slots estão
    // ocupados, as requisições extras aguardam na fila e são despachadas assim
    // que um slot fica livre — sem delay artificial, a latência da rede já
    // funciona como espaçamento natural entre as requisições.
    //
    // Compatível com a deduplicação de pendingMirrorRequests em fetchMirrorAsync:
    // a Promise externa é criada imediatamente (deduplicação funciona),
    // mas o ApiClient.fetch() interno só é executado quando há slot disponível.
    //
    // Por que por mirror, e não global?
    // Um semáforo global bloquearia todos os mirrors enquanto um mirror lento
    // estivesse ocupando seus slots. Com semáforos independentes, o Mirror A
    // e o Mirror B preenchem seus slots em paralelo sem interferência mútua.
    // ========================================================================
    const PerModRequestLimiter = (() => {
        const MAX_CONCURRENT = 10; // slots simultâneos por mirror
        const limiters = {};      // { [mirrorId]: limiter }

        function createLimiter() {
            let running = 0;
            const queue = [];

            function drain() {
                while (running < MAX_CONCURRENT && queue.length > 0) {
                    const { task, resolve, reject } = queue.shift();
                    running++;
                    task()
                        .then(resolve, reject)
                        .finally(() => { running--; drain(); });
                }
            }

            return {
                run(task) {
                    return new Promise((resolve, reject) => {
                        queue.push({ task, resolve, reject });
                        drain();
                    });
                },
                /** Exposto apenas para testes — não usar em produção. */
                _getRunning() { return running; },
                _getQueueLength() { return queue.length; }
            };
        }

        return {
            /** Retorna (criando se necessário) o limiter do mirror especificado. */
            forMirror(mirrorId) {
                if (!limiters[mirrorId]) limiters[mirrorId] = createLimiter();
                return limiters[mirrorId];
            }
        };
    })();

    // ========================================================================
    // MÓDULO 0.3: MONTH MAP (Tabela Universal de Meses)
    // Constrói e armazena em cache um mapa de nome de mês → índice (0-11)
    // cobrindo todos os 30 idiomas oficiais da Steam.
    // As duas fontes (tabela manual + Intl.DateTimeFormat) rodam em paralelo
    // e são mescladas — nenhuma depende da outra.
    // Uso: MonthMap.get() → { [nomeMes: string]: number }
    // O mapa é construído apenas na primeira chamada e reutilizado depois.
    // ========================================================================
    const MonthMap = (() => {
        // Todos os idiomas oficialmente suportados pela Steam (30 locales)
        const STEAM_LOCALES = [
            'pt', 'pt-BR',                   // Português (Portugal / Brasil)
            'en',                            // English
            'es', 'es-419',                  // Español (España / Latinoamérica)
            'fr',                            // Français
            'de',                            // Deutsch
            'it',                            // Italiano
            'ru',                            // Русский
            'uk',                            // Українська
            'bg',                            // Български
            'pl',                            // Polski
            'cs',                            // Čeština
            'ro',                            // Română
            'hu',                            // Magyar
            'el',                            // Ελληνικά
            'nl',                            // Nederlands
            'sv',                            // Svenska
            'da',                            // Dansk
            'no',                            // Norsk
            'fi',                            // Suomi
            'tr',                            // Türkçe
            'id',                            // Bahasa Indonesia
            'ms',                            // Bahasa Melayu
            'vi',                            // Tiếng Việt
            'th',                            // ไทย
            'zh-Hans', 'zh-Hant',            // 简体中文 / 繁體中文
            'ja',                            // 日本語
            'ko'                             // 한국어
        ];

        // Tabela Manual: base garantida cobrindo abreviações dos idiomas mais comuns do Steam.
        // Serve como âncora mesmo quando o Intl estiver indisponível no ambiente.
        // Cobre todos os 30 idiomas oficialmente suportados pela Steam (2025):
        // Português (PT/BR), English, Español (ES/ES-419), Français, Deutsch, Italiano,
        // Русский, Українська, Български, Polski, Čeština, Română, Magyar, Ελληνικά,
        // Nederlands, Svenska, Dansk, Norsk, Suomi, Türkçe, Bahasa Indonesia,
        // Bahasa Melayu, Tiếng Việt, ภาษาไทย, 简体中文, 繁體中文, 日本語, 한국어.
        // Nota: bg (Bulgário) gera "01".."12" via Intl — não incluído no manual por serem
        //       dígitos numéricos genéricos. vi (Vietnamita) usa frases compostas "tháng N"
        //       cobertas pelo Intl; incluídas aqui apenas as formas sem espaço detectáveis.
        // Nota: entradas CJK e Thai usam formas numéricas como "1月" / "1월" / "一月" /
        //       "มกราคม" que o Intl já cobre; incluídas aqui como âncora de fallback.
        const MANUAL = {
            // ── Janeiro / January (0) ──────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, FR, DE, NL, SV, DA, NO, ID, MS
            jan:0, january:0, janeiro:0, enero:0, janvier:0, januar:0, januari:0,
            // FR(abrev), EN/DE abrev já coberta por 'jan'
            janv:0,
            // IT: gennaio / gen
            gennaio:0, gen:0,
            // ES abrev
            ene:0,
            // RU: январь / янв
            январь:0, янв:0,
            // UK: січень / січ
            січень:0, січ:0,
            // PL: styczeń / sty
            styczeń:0, sty:0,
            // CS: leden / led
            leden:0, led:0,
            // RO: ianuarie / ian
            ianuarie:0, ian:0,
            // HU: január (mesmo que DE/SV 'januar'; a forma longa é 'január' — acento)
            január:0,
            // EL: ιανουαρίου / ιαν
            ιανουαρίου:0, ιαν:0,
            // FI: tammikuu / tammi
            tammikuu:0, tammi:0,
            // TR: ocak / oca
            ocak:0, oca:0,
            // TH: มกราคม / ม.ค
            มกราคม:0, 'ม.ค':0,
            // ZH-Hans: 一月  |  ZH-Hant/JA/KO: 1月 / 1월
            '一月':0, '1月':0, '1월':0,

            // ── Fevereiro / February (1) ───────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, DE, NL, SV, DA, NO, ID, MS
            february:1, fevereiro:1, febrero:1, februar:1, februari:1,
            // PT abrev
            fev:1,
            // EN/ES/DE/NL/SV/DA/NO/ID/MS abrev
            feb:1,
            // FR: février / févr
            février:1, févr:1,
            // IT: febbraio
            febbraio:1,
            // RU: февраль / февр
            февраль:1, февр:1,
            // UK: лютий / лют
            лютий:1, лют:1,
            // PL: luty / lut
            luty:1, lut:1,
            // CS: únor / úno
            únor:1, úno:1,
            // RO: februarie (abrev 'feb' já coberta)
            februarie:1,
            // HU: február / febr
            február:1, febr:1,
            // EL: φεβρουαρίου / φεβ
            φεβρουαρίου:1, φεβ:1,
            // FI: helmikuu / helmi
            helmikuu:1, helmi:1,
            // TR: şubat / şub
            şubat:1, şub:1,
            // TH: กุมภาพันธ์ / ก.พ
            กุมภาพันธ์:1, 'ก.พ':1,
            // ZH / KO
            '二月':1, '2月':1, '2월':1,

            // ── Março / March (2) ─────────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, IT (mesmo que EN: 'marzo'→mar), NO
            march:2, março:2, marzo:2, marts:2,
            // abrev compartilhada PT/EN/ES/IT/DA/NO/TR/ID
            mar:2,
            // FR: mars (forma curta e longa iguais)
            mars:2,
            // DE: märz / mär
            märz:2, mär:2,
            // NL: maart / mrt
            maart:2, mrt:2,
            // RU: март (longo e curto iguais)
            март:2,
            // UK: березень / бер
            березень:2, бер:2,
            // PL: marzec (abrev 'mar' coberta)
            marzec:2,
            // CS: březen / bře
            březen:2, bře:2,
            // RO: martie (abrev 'mar' coberta)
            martie:2,
            // HU: március / márc
            március:2, márc:2,
            // EL: μαρτίου / μαρ
            μαρτίου:2, μαρ:2,
            // FI: maaliskuu / maalis
            maaliskuu:2, maalis:2,
            // TR: mart (abrev 'mar' coberta)
            mart:2,
            // ID: maret (abrev 'mar' coberta)
            maret:2,
            // MS: mac (forma única — 3 chars, sem colisão)
            mac:2,
            // TH: มีนาคม / มี.ค
            มีนาคม:2, 'มี.ค':2,
            // ZH / KO
            '三月':2, '3月':2, '3월':2,

            // ── Abril / April (3) ─────────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, DE, NL, SV, DA, NO, ID, MS
            april:3, abril:3,
            // abrev compartilhada PT/EN/ES/DE/NL/SV/DA/NO/ID/MS/IT/RO
            apr:3, abr:3,
            // FR: avril / avr
            avril:3, avr:3,
            // IT: aprile (abrev 'apr' coberta)
            aprile:3,
            // RU: апрель / апр
            апрель:3, апр:3,
            // UK: квітень / квіт
            квітень:3, квіт:3,
            // PL: kwiecień / kwi
            kwiecień:3, kwi:3,
            // CS: duben / dub
            duben:3, dub:3,
            // RO: aprilie (abrev 'apr' coberta)
            aprilie:3,
            // HU: április / ápr
            április:3, ápr:3,
            // EL: απριλίου / απρ
            απριλίου:3, απρ:3,
            // FI: huhtikuu / huhti
            huhtikuu:3, huhti:3,
            // TR: nisan / nis
            nisan:3, nis:3,
            // TH: เมษายน / เม.ย
            เมษายน:3, 'เม.ย':3,
            // ZH / KO
            '四月':3, '4月':3, '4월':3,

            // ── Maio / May (4) ────────────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, FR, DE, RO, NO
            maio:4, may:4, mayo:4, mai:4,
            // IT: maggio / mag
            maggio:4, mag:4,
            // RU: май (longo e curto iguais)
            май:4,
            // UK: травень / трав
            травень:4, трав:4,
            // PL, SV, DA: maj
            maj:4,
            // CS: květen / kvě
            květen:4, kvě:4,
            // HU: május / máj
            május:4, máj:4,
            // EL: μαΐου / μαΐ
            μαΐου:4, 'μαΐ':4,
            // NL, ID, MS: mei
            mei:4,
            // FI: toukokuu / touko
            toukokuu:4, touko:4,
            // TR: mayıs (abrev 'may' coberta)
            mayıs:4,
            // TH: พฤษภาคม / พ.ค
            พฤษภาคม:4, 'พ.ค':4,
            // ZH / KO
            '五月':4, '5月':4, '5월':4,

            // ── Junho / June (5) ──────────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, DE, NL, SV, DA, NO, ID, MS
            june:5, junho:5, junio:5, juni:5,
            // abrev compartilhada PT/EN/ES/DE/NL/SV/DA/NO/ID/MS
            jun:5,
            // FR: juin (longo e curto iguais)
            juin:5,
            // IT: giugno / giu
            giugno:5, giu:5,
            // RU: июнь (longo e curto iguais)
            июнь:5,
            // UK: червень / черв
            червень:5, черв:5,
            // PL: czerwiec / cze
            czerwiec:5, cze:5,
            // CS: červen / čvn
            červen:5, čvn:5,
            // RO: iunie / iun
            iunie:5, iun:5,
            // HU: június / jún
            június:5, jún:5,
            // EL: ιουνίου / ιουν
            ιουνίου:5, ιουν:5,
            // FI: kesäkuu / kesä
            kesäkuu:5, kesä:5,
            // TR: haziran / haz
            haziran:5, haz:5,
            // TH: มิถุนายน / มิ.ย
            มิถุนายน:5, 'มิ.ย':5,
            // ZH / KO
            '六月':5, '6月':5, '6월':5,

            // ── Julho / July (6) ──────────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, DE, NL, SV, DA, NO, ID, MS
            july:6, julho:6, julio:6, juli:6,
            // abrev compartilhada PT/EN/ES/DE/NL/SV/DA/NO/ID/MS
            jul:6,
            // FR: juillet / juil
            juillet:6, juil:6,
            // IT: luglio / lug
            luglio:6, lug:6,
            // RU: июль (longo e curto iguais)
            июль:6,
            // UK: липень / лип
            липень:6, лип:6,
            // PL: lipiec / lip
            lipiec:6, lip:6,
            // CS: červenec / čvc
            červenec:6, čvc:6,
            // RO: iulie / iul
            iulie:6, iul:6,
            // HU: július / júl
            július:6, júl:6,
            // EL: ιουλίου / ιουλ
            ιουλίου:6, ιουλ:6,
            // BG: юли
            юли:6,
            // FI: heinäkuu / heinä
            heinäkuu:6, heinä:6,
            // TR: temmuz / tem
            temmuz:6, tem:6,
            // MS: julai (abrev 'jul' coberta)
            julai:6,
            // TH: กรกฎาคม / ก.ค
            กรกฎาคม:6, 'ก.ค':6,
            // ZH / KO
            '七月':6, '7月':6, '7월':6,

            // ── Agosto / August (7) ───────────────────────────────────────────────
            // PT/BR, EN, DE, NL, SV, DA, NO, RO
            august:7, agosto:7, augustus:7, augusti:7,
            // abrev compartilhada PT/EN/DE/NL/SV/DA/NO/RO/HU
            aug:7, ago:7,
            // FR: août (longo e curto iguais; 'aoû' era typo da tabela antiga — 'août' é o correto)
            août:7,
            // RU: август / авг
            август:7, авг:7,
            // UK: серпень / серп
            серпень:7, серп:7,
            // PL: sierpień / sie
            sierpień:7, sie:7,
            // CS: srpen / srp
            srpen:7, srp:7,
            // HU: augusztus (abrev 'aug' coberta)
            augusztus:7,
            // EL: αυγούστου / αυγ
            αυγούστου:7, αυγ:7,
            // FI: elokuu / elo
            elokuu:7, elo:7,
            // TR: ağustos / ağu
            ağustos:7, ağu:7,
            // ID: agustus / agu
            agustus:7, agu:7,
            // MS: ogos / ogo
            ogos:7, ogo:7,
            // TH: สิงหาคม / ส.ค
            สิงหาคม:7, 'ส.ค':7,
            // ZH / KO
            '八月':7, '8月':7, '8월':7,

            // ── Setembro / September (8) ──────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, FR, DE, NL, SV, DA, NO, ID, MS
            september:8, setembro:8, septiembre:8, septembre:8, settembre:8,
            // abrev compartilhada PT/IT
            set:8,
            // abrev compartilhada EN/DE/NL/SV/DA/NO/ID/MS
            sep:8,
            // ES/ES-419/FR/RO abrev
            sept:8,
            // RU: сентябрь / сент
            сентябрь:8, сент:8,
            // UK: вересень / вер
            вересень:8, вер:8,
            // PL: wrzesień / wrz
            wrzesień:8, wrz:8,
            // CS: září / zář
            září:8, zář:8,
            // RO: septembrie (abrev 'sept' coberta)
            septembrie:8,
            // HU: szeptember / szept
            szeptember:8, szept:8,
            // EL: σεπτεμβρίου / σεπ
            σεπτεμβρίου:8, σεπ:8,
            // FI: syyskuu / syys
            syyskuu:8, syys:8,
            // TR: eylül / eyl
            eylül:8, eyl:8,
            // TH: กันยายน / ก.ย
            กันยายน:8, 'ก.ย':8,
            // ZH / KO
            '九月':8, '9月':8, '9월':8,

            // ── Outubro / October (9) ─────────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, FR, DE, NL, SV, DA, NO, ID, MS
            october:9, outubro:9, octubre:9, octobre:9, oktober:9,
            // abrev compartilhada PT
            out:9,
            // abrev compartilhada EN/ES/FR/RO
            oct:9,
            // abrev compartilhada DE/NL/SV/DA/NO/ID/MS/HU
            okt:9,
            // IT: ottobre / ott
            ottobre:9, ott:9,
            // RU: октябрь / окт
            октябрь:9, окт:9,
            // UK: жовтень / жовт
            жовтень:9, жовт:9,
            // PL: październik / paź
            październik:9, paź:9,
            // CS: říjen / říj
            říjen:9, říj:9,
            // RO: octombrie (abrev 'oct' coberta)
            octombrie:9,
            // HU: október (abrev 'okt' coberta)
            október:9,
            // EL: οκτωβρίου / οκτ
            οκτωβρίου:9, οκτ:9,
            // FI: lokakuu / loka
            lokakuu:9, loka:9,
            // TR: ekim / eki
            ekim:9, eki:9,
            // TH: ตุลาคม / ต.ค
            ตุลาคม:9, 'ต.ค':9,
            // ZH / KO
            '十月':9, '10月':9, '10월':9,

            // ── Novembro / November (10) ──────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, FR, DE, IT, NL, SV, DA, NO, HU, RO, ID, MS
            november:10, novembro:10, noviembre:10, novembre:10,
            // abrev compartilhada por praticamente todos os idiomas latinos/germânicos
            nov:10,
            // RU: ноябрь / нояб
            ноябрь:10, нояб:10,
            // UK: листопад / лист
            листопад:10, лист:10,
            // PL, CS: listopad / lis
            listopad:10, lis:10,
            // RO: noiembrie (abrev 'nov' coberta)
            noiembrie:10,
            // EL: νοεμβρίου / νοε
            νοεμβρίου:10, νοε:10,
            // FI: marraskuu / marras
            marraskuu:10, marras:10,
            // TR: kasım / kas
            kasım:10, kas:10,
            // TH: พฤศจิกายน / พ.ย
            พฤศจิกายน:10, 'พ.ย':10,
            // ZH / KO
            '十一月':10, '11月':10, '11월':10,

            // ── Dezembro / December (11) ──────────────────────────────────────────
            // PT/BR, EN, ES/ES-419, DE, IT, NL, SV, DA, HU, RO, ID
            december:11, dezembro:11, diciembre:11, dezember:11, dicembre:11,
            // abrev compartilhada EN/ES/IT/NL/SV/DA/HU/RO/ID
            dec:11,
            // PT/BR abrev
            dez:11,
            // ES/IT abrev
            dic:11,
            // FR: décembre / déc
            décembre:11, déc:11,
            // RU: декабрь / дек
            декабрь:11, дек:11,
            // UK: грудень / груд
            грудень:11, груд:11,
            // PL: grudzień / gru
            grudzień:11, gru:11,
            // CS: prosinec / pro
            prosinec:11, pro:11,
            // RO: decembrie (abrev 'dec' coberta)
            decembrie:11,
            // EL: δεκεμβρίου / δεκ
            δεκεμβρίου:11, δεκ:11,
            // NO: desember / des
            desember:11, des:11,
            // FI: joulukuu / joulu
            joulukuu:11, joulu:11,
            // TR: aralık / ara
            aralık:11, ara:11,
            // MS: disember / dis
            disember:11, dis:11,
            // TH: ธันวาคม / ธ.ค
            ธันวาคม:11, 'ธ.ค':11,
            // ZH / KO
            '十二月':11, '12月':11, '12월':11
        };

        let _cache = null;

        return {
            /**
             * Retorna o mapa de meses em cache (construindo-o apenas na primeira chamada).
             * Combina a tabela manual (base) com a geração dinâmica via Intl (enriquecimento).
             *
             * @returns {{ [monthName: string]: number }} Mapa nome de mês (minúsculo) → índice 0-11.
             */
            get() {
                if (_cache) return _cache;

                // Geração Dinâmica via Intl: percorre os 12 meses e pede ao JavaScript
                // para traduzir cada um em todos os locales da Steam, nas formas longa e
                // curta. Não gera aliases de 3 letras — evita colisões críticas onde nomes
                // longos de meses em outros idiomas têm o mesmo prefixo de 3 chars que
                // abreviações corretas (ex: "marraskuu" finlandês → alias "mar" destruiria
                // Março em 14 idiomas). A cobertura de 3 chars vem dos formatos short do Intl
                // e das entradas diretas da tabela MANUAL.
                const intlMap = {};
                try {
                    for (let m = 0; m < 12; m++) {
                        const d = new Date(2024, m, 1); // dia 1 de cada mês — sem risco de overflow
                        STEAM_LOCALES.forEach(locale => {
                            ['long', 'short'].forEach(fmt => {
                                try {
                                    const name = new Intl.DateTimeFormat(locale, { month: fmt }).format(d)
                                        .toLowerCase().trim().replace(/[.,]$/, ''); // remove pontuação final (ex: "jan.")
                                    if (name && name.length >= 2) {
                                        intlMap[name] = m;
                                        // SEM alias de 3 letras — ver comentário acima
                                    }
                                } catch(e) { /* locale não suportado pelo ambiente; ignora silenciosamente */ }
                            });
                        });
                    }
                } catch(e) { /* Intl indisponível no ambiente; apenas a tabela manual será usada */ }

                // Mescla: Intl como base de enriquecimento, MANUAL como camada final que
                // nunca pode ser sobrescrita. Isso garante que entradas críticas como
                // "mar" → Março (2) e "мая" → Maio (4) prevaleçam sobre qualquer
                // chave gerada pelo Intl a partir de nomes longos de outros idiomas.
                _cache = Object.assign({}, intlMap, MANUAL);
                return _cache;
            }
        };
    })();

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
         * Fallback Scraper HTML: À prova de idiomas, fuso horário e região asiática.
         * Extrai a data de atualização e HORA EXATA diretamente da DOM da página de detalhes do Mod
         * caso a API da Valve falhe ou retorne dados divergentes.
         */
        parseSteamHTMLDate: function() {
            const labels = document.querySelectorAll('.detailsStatLeft');
            const values = document.querySelectorAll('.detailsStatRight');
            let dateStr = "";

            // Keywords universais abrangendo todos os idiomas suportados pela Steam
            const updateKeywords = [
                // Escrita Latina
                'updated',            // English
                'atualizado',         // Portuguese (PT / BR)
                'última atualização', // Portuguese (alternativo)
                'actualizado',        // Spanish / Spanish-LA
                'mis à jour',         // French
                'aktualisiert',       // German
                'aggiornato',         // Italian
                'bijgewerkt',         // Dutch
                'opracowano',         // Polish (alternativo)
                'zaktualizowano',     // Polish
                'güncellendi',        // Turkish
                'aktualizováno',      // Czech
                'opdateret',          // Danish
                'päivitetty',         // Finnish
                'oppdatert',          // Norwegian
                'uppdaterad',         // Swedish
                'frissítve',          // Hungarian
                'actualizat',         // Romanian
                'diperbarui',         // Indonesian
                'cập nhật',           // Vietnamese
                // Escrita Cirílica
                'обновлено',          // Russian
                'актуализирано',      // Bulgarian
                'оновлено',           // Ukrainian
                // Escrita Grega
                'ενημερώθηκε',        // Greek
                // Escrita CJK (Chinese / Japanese / Korean)
                '更新',               // Japanese / Chinese Simplified
                '最後更新',           // Chinese Traditional
                '업데이트됨',         // Korean
                // Escrita Árabe
                'تحديث',             // Arabic
                // Escrita Tailandesa
                'อัปเดต',            // Thai
            ];
            const publishKeywords = [
                // Escrita Latina
                'posted',             // English
                'publicado',          // Spanish / Portuguese
                'publié',             // French
                'veröffentlicht',     // German
                'pubblicato',         // Italian
                'geplaatst',          // Dutch
                'opublikowano',       // Polish
                'yayınlandı',         // Turkish
                'zveřejněno',         // Czech
                'lagt op',            // Danish
                'lähetetty',          // Finnish
                'lagt ut',            // Norwegian
                'publicerad',         // Swedish
                'közzétéve',          // Hungarian
                'postat',             // Romanian
                'diposting',          // Indonesian
                'đăng',               // Vietnamese
                // Escrita Cirílica
                'опубликовано',       // Russian
                'публикувано',        // Bulgarian
                'опубліковано',       // Ukrainian
                // Escrita Grega
                'αναρτήθηκε',         // Greek
                // Escrita CJK (Chinese / Japanese / Korean)
                '发布',               // Chinese Simplified
                '發佈',               // Chinese Traditional
                '投稿',               // Japanese
                '게시됨',             // Korean
                // Escrita Árabe
                'نشر',               // Arabic
                // Escrita Tailandesa
                'โพสต์',             // Thai
            ];

            labels.forEach((el, i) => {
                const text = el.textContent.toLowerCase().trim();
                const isUpdateRow = updateKeywords.some(k => text.includes(k));
                const isPublishRow = publishKeywords.some(k => text.includes(k));
                
                if (isPublishRow || i === 1) {
                    if (!dateStr) dateStr = values[i]?.textContent || "";
                }
                
                // Se identificou a keyword na row atual, ou fallback visual (a 3ª linha na interface clássica)
                if (isUpdateRow || (labels.length >= 3 && i === 2)) {
                    dateStr = values[i]?.textContent || "";
                }
            });

            if (!dateStr) return null;

            let year = new Date().getFullYear();
            let month = -1;
            let day = -1;
            let hours = 12; // default fallback se tudo der errado
            let minutes = 0;

            // 1. Extrai Tempo Exato (Desacoplado da posição do AM/PM para suportar idiomas asiáticos como Chinês e Coreano)
            // A Regex agora aceita : (ocidental), 時 (JP/CN) e 시 (KR)
            const timeMatch = dateStr.match(/(\d{1,2})[:時시]\s*(\d{2})/);
            if (timeMatch) {
                hours = parseInt(timeMatch[1], 10);
                minutes = parseInt(timeMatch[2], 10);
                
                // Detecção de AM/PM global que não depende da ordem na frase
                const isPM = /pm|p\.m\.|下午|午後|오후/i.test(dateStr);
                const isAM = /am|a\.m\.|上午|午前|오전/i.test(dateStr);

                if (isPM && hours < 12) hours += 12;
                if (isAM && hours === 12) hours = 0;
            }

            // 2. Extrai Data (Formatos Asiáticos YYYY年 MM月 DD日)
            const asianMatch = dateStr.match(/(?:(\d{4})\s*[年년])?\s*(\d{1,2})\s*[月월]\s*(\d{1,2})\s*[日일]/);
            if (asianMatch) {
                if (asianMatch[1]) year = parseInt(asianMatch[1], 10);
                month = parseInt(asianMatch[2], 10) - 1; // 0-indexado para o Objeto Date
                day = parseInt(asianMatch[3], 10);
            } else {
                // 3. Extrai Data (Formatos Ocidentais/Cirílicos)
                // Limpeza de conectivos de múltiplos idiomas com suporte a barras "/" e delimitadores de palavras corretos
                let cleanStr = dateStr.replace(/(^|\s)(@|at|às|de|в|о|у|den|u|kl)(?=\s|$)/gi, ' ').replace(/[.,/]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                
                // Tabela universal de conversão de Meses para numérico (0-11).
                // Gerenciada pelo módulo MonthMap (Módulo 0.2): tabela manual + Intl em paralelo,
                // fundidos e armazenados em cache na primeira chamada.
                const monthMap = MonthMap.get();

                const parts = cleanStr.split(' ');
                
                // Determinação heurística baseada nos blocos textuais separados
                parts.forEach(p => {
                    // Garante que não vai confundir a hora capturada com o dia do mês
                    if (/^\d{1,2}$/.test(p) && day === -1 && parseInt(p, 10) <= 31) {
                        day = parseInt(p, 10);
                    }
                    else if (month === -1 && monthMap[p] !== undefined) month = monthMap[p];
                    else if (month === -1 && p.length >= 3 && monthMap[p.substring(0,3)] !== undefined) month = monthMap[p.substring(0,3)];
                    else if (/^\d{4}$/.test(p)) year = parseInt(p, 10);
                });
            }

            if (day !== -1 && month !== -1) {
                // Instancia usando Fuso Horário Local do Navegador (Como a própria Steam faz na UI visual)
                const finalDate = new Date(year, month, day, hours, minutes, 0);
                
                // A interface da Steam omite o ano se a atualização ocorreu no ano em curso. 
                // Corrigimos caso acidentalmente a data caia no futuro.
                if (finalDate.getTime() > Date.now() + 86400000) finalDate.setFullYear(year - 1);
                
                return { date: finalDate, isFallback: true };
            }
            return null;
        },

        /**
         * Fallback Scraper SSR: Direcionado para Páginas de Navegação (Listas) do Workshop.
         * Nessas rotas, o DOM é gerado via React e esconde os timestamps Unix nativos num JSON embutido na tag Script.
         */
        getSteamSSRData: function() {
            try {
                const scripts = document.querySelectorAll('script');
                for (const s of scripts) {
                    if (s.textContent.includes('window.SSR.loaderData')) {
                        const jsonMatch = s.textContent.match(/window\.SSR\.loaderData\s*=\s*(\[.*?\]);/s);
                        if (jsonMatch) {
                            const rawList = JSON.parse(jsonMatch[1]);
                            const results = {};
                            rawList.forEach(jsonStr => {
                                try {
                                    const data = JSON.parse(jsonStr);
                                    if (data.results) {
                                        data.results.forEach(item => {
                                            if (item.publishedfileid) {
                                                const ts = item.time_updated || item.time_created;
                                                results[item.publishedfileid] = ts ? new Date(ts * 1000) : null;
                                            }
                                        });
                                    }
                                } catch(e) {}
                            });
                            return results;
                        }
                    }
                }
            } catch(e) {}
            return null;
        },

        /**
         * Extrai e converte strings de datas complexas de mirrors (como o Skymods).
         * Prioriza datas explícitas e determina se a hora exata está disponível.
         *
         * ─── CORREÇÃO DE FUSO HORÁRIO: Skymods (smods.ru) ───────────────────────────
         * O servidor do Skymods entrega os horários do campo "Last revision" em UTC-3,
         * SEM qualquer indicação de fuso na string HTML bruta.
         * O site possui um script client-side (`datetime-localize.min.js`) que, no
         * navegador, adiciona +3 horas e acrescenta o rótulo "UTC" antes de exibir.
         *
         * Como o script busca o HTML via GM_xmlhttpRequest (sem executar JavaScript),
         * ele recebe o HTML cru com os horários ainda em UTC-3. O `hours + 3` aqui
         * replica manualmente exatamente o que o datetime-localize.min.js faria.
         *
         *   Prova concreta (mod 3605677866 — "Better Road Builder", Europa Universalis V, catalogue.smods.ru):
         *     HTML bruto do servidor  → "7 May at 01:30"         ← o que este parser lê
         *     Exibição no navegador   → "7 May at 04:30 UTC"     ← após datetime-localize.min.js
         *     API da Steam (UTC)      → 04:30 UTC                ← referência para comparação
         *     `hours + 3` = 1+3=4    → Date.UTC(..., 4, 30, 0) ✓
         *
         * Isso é INTENCIONAL — sem esse ajuste o script concluiria, de forma errada,
         * que o mirror está 3 horas desatualizado em relação à Steam.
         * NÃO remova nem altere o offset sem verificar o comportamento do site.
         * ─────────────────────────────────────────────────────────────────────────────
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
                const month = MonthMap.get()[monthStr];

                if (month !== undefined) {
                    let parsedDate;
                    let exact = false;
                    if (match[4] !== undefined && match[5] !== undefined) {
                        const hours = parseInt(match[4], 10);
                        const minutes = parseInt(match[5], 10);
                        // INTENCIONAL: `hours + 3` converte UTC-3 (fuso do Skymods) → UTC.
                        // Veja o bloco de documentação acima para a explicação completa.
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

        // ─── CORREÇÃO DE FUSO HORÁRIO: Insane Mirror (insane.x10.mx) e Insane GH ─────
        // O dono do site insane.x10.mx documenta explicitamente em seu cabeçalho:
        //   "The shown upload time is GMT+1!"
        // Ou seja, TODOS os timestamps desse mirror (tanto do .php quanto do JSON no
        // GitHub) estão em GMT+1, sem qualquer indicador de fuso embutido na string.
        //
        // Para normalizar a GMT+1 → UTC antes de comparar com os timestamps da Steam:
        //   • parseInsaneDate   → anexa '+01:00' à string ISO, deixando o construtor
        //                         Date() do JS fazer a conversão automaticamente.
        //   • parseInsaneGHDate → subtrai 1 hora do componente de hora antes de passar
        //                         para Date.UTC(), que sempre espera valores em UTC.
        //
        //   Exemplo (ambas as funções chegam ao mesmo resultado):
        //     String bruta:  "2024-01-15 15:00"  (GMT+1, conforme documentado)
        //     UTC correto:   2024-01-15 14:00 UTC  (15 - 1 = 14)
        //
        // INTENCIONAL — sem esse ajuste as datas apareceriam 1 hora mais novas do que
        // realmente são, causando falsos positivos de "mirror atualizado".
        // NÃO remova nem altere o offset sem verificar o comportamento do site.
        // ─────────────────────────────────────────────────────────────────────────────

        // Métodos auxiliares para parse de Insane Mirror e JSON do Insane GH
        parseInsaneDate: function(dateStr) {
            if (!dateStr || dateStr.startsWith('0000-00-00')) return null;
            // INTENCIONAL: '+01:00' declara o fuso GMT+1 do Insane Mirror → JS converte para UTC.
            const d = new Date(dateStr.replace(' ', 'T') + '+01:00');
            return isNaN(d.getTime()) ? null : { date: d, exact: /\d{2}:\d{2}/.test(dateStr) };
        },
        parseInsaneGHDate: function(dateStr) {
            if (!dateStr) return null;
            const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!match) return null;
            // INTENCIONAL: `match[4] - 1` converte GMT+1 (Insane GH JSON) → UTC.
            // Equivalente ao '+01:00' do parseInsaneDate, mas aplicado manualmente
            // porque Date.UTC() não aceita indicadores de fuso — só recebe horas UTC.
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
            // Mapeamento de jogos com subdomínios exclusivos no ecossistema Skymods
            const smodsSubdomains = {
                '255710': 'smods.ru',                       // Cities: Skylines
                '394360': 'hearts-of-iron-4.smods.ru',      // Hearts of Iron IV
                '281990': 'stellaris.smods.ru'              // Stellaris
            };

            // Verifica se o jogo atual possui um domínio próprio
            const customDomain = smodsSubdomains[appId];

            return {
                id: `smods_${appId}`,
                name: "Skymods",
                type: "per_mod",

                // Se o jogo tem domínio próprio, usa ele. Se não, usa o catálogo universal.
                url: (modId) => customDomain
                    ? `https://${customDomain}/?s=${modId}`
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
                // Desativa a sondagem dinâmica (probe) se o jogo tiver site próprio, evitando o bloqueio.
                gameProbe: customDomain ? null : {
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
    // Estes mirrors são SEMPRE incluídos na busca de QUALQUER jogo — inclusive
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
        en: { checkingVersion: 'Checking Version...', mirrorError: 'Mirror Error', requestMod: 'Request Mod', modNotListed: 'Mod not listed. Click to request.', download: 'Download', downloadWarning: 'Download', modUpdated: 'MOD UP TO DATE', modOutdated: 'MOD OUTDATED', requestUpdate: 'Request Update', labelSteam: 'Steam:', labelCache: 'Cache Status:', cacheSteam: 'Steam:', justNow: 'just now', minAgo: 'min ago', steamError: 'Unverified', steamErrorTip: 'Steam API unreachable. Version not verified.', mirrorNoDate: 'Mirror Without Date', mirrorNoDateTip: 'Could not verify mirror version date.', clearCache: 'Clear Cache', cacheCooldown: 'Clear cache ({s}s)', idlePaused: 'Paused (Idle)', idleActive: 'Active', exactTimeWarn: 'Mirror missing time.<br>Precision uncertain.', modUnavailable: 'Mod Unavailable', modUnavailableTip: 'Not found in the mirrors', modUnavailableSubTip: 'No mirror site/forum found to request the addition of the mod', modNotListedSubTip: 'Read the site/forum rules before requesting', invalidLink: 'Invalid Link', invalidLinkTip: 'Mirror returned an invalid or unsafe link.', checkedMirrors: 'Mirrors checked:', bestAvailable: 'Best available version selected', requestUpdateTip: 'Read the site/forum rules before requesting', noForumTip: 'No mirror site/forum found to request updates for the mod.', clearCacheTip: 'Clears verification data and rechecks.', steamFallbackWarn: 'Steam API returned no date. Using Steam page data (Estimated).', steamTimeMismatch: 'Date discrepancy detected between Steam API and Steam page.', consoleStorageQuotaCleanup: 'LocalStorage quota exceeded. Running preventive cleanup...', consoleCacheWriteFailed: 'Critical failure writing to cache after cleanup.', consoleUnknownIcon: 'Unknown icon: "{name}"', consoleWidgetUpdateFailed: 'Failed to update widget after cache expiration:', consoleMirrorFallbackError: 'Fallback Error (Mirror: {name}):', consoleWidgetInjectError: 'Error injecting Steam widgets:', settingsTitle: 'Settings', toggleCacheInfo: 'Cache Status', toggleMirrorInfo: 'Verified Mirrors' },
        pt: { checkingVersion: 'Verificando versão...', mirrorError: 'Erro no Mirror', requestMod: 'Pedir Mod', modNotListed: 'Mod não listado. Clique para pedir.', download: 'Baixar', downloadWarning: 'Baixar', modUpdated: 'MOD ATUALIZADO', modOutdated: 'MOD DESATUALIZADO', requestUpdate: 'Pedir Atualização', labelSteam: 'Steam:', labelCache: 'Status do Cache:', cacheSteam: 'Steam:', justNow: 'agora', minAgo: 'min atrás', steamError: 'Não Verificado', steamErrorTip: 'Falha na API Steam. Versão não verificada.', mirrorNoDate: 'Mirror sem data', mirrorNoDateTip: 'Não foi possível verificar a versão do mirror.', clearCache: 'Limpar Cache', cacheCooldown: 'Limpar cache ({s}s)', idlePaused: 'Pausado (Inativo)', idleActive: 'Ativo', exactTimeWarn: 'O mirror não contém hora.<br>Precisão incerta.', modUnavailable: 'Mod Indisponível', modUnavailableTip: 'Não encontrado nos mirrors', modUnavailableSubTip: 'Nenhum site/fórum dos mirrors foi encontrado para solicitar a adição do mod.', modNotListedSubTip: 'Leia as regras do site/fórum antes de pedir', invalidLink: 'Link Inválido', invalidLinkTip: 'O mirror retornou um link inválido ou inseguro.', checkedMirrors: 'Mirrors verificados:', bestAvailable: 'Melhor versão disponível selecionada', requestUpdateTip: 'Leia as regras do site/fórum antes de pedir', noForumTip: 'Nenhum site/fórum dos mirrors foi encontrado para solicitar atualizações do mod.', clearCacheTip: 'Limpa os dados de verificação e refaz a checagem.', steamFallbackWarn: 'A API da Steam não retornou data. Usando dados da página da Steam (Estimado).', steamTimeMismatch: 'Diferença de data detectada entre a API da Steam e a página da Steam.', consoleStorageQuotaCleanup: 'LocalStorage atingiu o limite de cota. Executando limpeza preventiva...', consoleCacheWriteFailed: 'Falha crítica ao gravar no cache após limpeza.', consoleUnknownIcon: 'Ícone desconhecido: "{name}"', consoleWidgetUpdateFailed: 'Falha ao atualizar widget após expiração de cache:', consoleMirrorFallbackError: 'Erro de Fallback (Mirror: {name}):', consoleWidgetInjectError: 'Erro ao tentar injetar widgets da Steam:', settingsTitle: 'Configurações', toggleCacheInfo: 'Status do Cache', toggleMirrorInfo: 'Mirrors verificados' },
        es: { checkingVersion: 'Comprobando versión...', mirrorError: 'Error en Mirror', requestMod: 'Pedir mod', modNotListed: 'Mod no listado. Haz clic para pedirlo.', download: 'Descargar', downloadWarning: 'Descargar', modUpdated: 'MOD ACTUALIZADO', modOutdated: 'MOD DESACTUALIZADO', requestUpdate: 'Pedir actualización', labelSteam: 'Steam:', labelCache: 'Estado del caché:', cacheSteam: 'Steam:', justNow: 'ahora', minAgo: 'min atrás', steamError: 'No verificado', steamErrorTip: 'Fallo en la API de Steam. Versión no verificada.', mirrorNoDate: 'Mirror sin fecha', mirrorNoDateTip: 'No se pudo verificar la versión del mirror.', clearCache: 'Borrar caché', cacheCooldown: 'Borrar caché ({s}s)', idlePaused: 'Pausado (Inactivo)', idleActive: 'Activo', exactTimeWarn: 'Mirror sin hora.<br>Precisión incierta.', modUnavailable: 'Mod no disponible', modUnavailableTip: 'No encontrado en los mirrors', modUnavailableSubTip: 'No se encontró ningún sitio/foro de mirrors para solicitar la adición del mod', modNotListedSubTip: 'Lee las reglas del sitio/foro antes de pedir', invalidLink: 'Enlace Inválido', invalidLinkTip: 'El mirror devolvió un enlace inválido o inseguro.', checkedMirrors: 'Mirrors verificados:', bestAvailable: 'Mejor versión disponible seleccionada', requestUpdateTip: 'Lee las reglas del sitio/foro antes de pedir', noForumTip: 'No se encontró ningún sitio/foro de mirrors para solicitar actualizaciones del mod.', clearCacheTip: 'Borra los datos de verificación y vuelve a comprobar.', steamFallbackWarn: 'La API de Steam no devolvió fecha. Usando datos de página de Steam (Estimado).', steamTimeMismatch: 'Discrepancia de fecha detectada entre la API de Steam y la página de Steam.', consoleStorageQuotaCleanup: 'LocalStorage alcanzó el límite de cuota. Ejecutando limpieza preventiva...', consoleCacheWriteFailed: 'Fallo crítico al escribir en caché tras la limpieza.', consoleUnknownIcon: 'Icono desconocido: "{name}"', consoleWidgetUpdateFailed: 'Error al actualizar el widget tras la expiración del caché:', consoleMirrorFallbackError: 'Error de Fallback (Mirror: {name}):', consoleWidgetInjectError: 'Error al inyectar widgets de Steam:', settingsTitle: 'Configuración', toggleCacheInfo: 'Estado de caché', toggleMirrorInfo: 'Mirrors verificados' },
        fr: { checkingVersion: 'Vérification de la version...', mirrorError: 'Erreur Mirror', requestMod: 'Demander le mod', modNotListed: 'Mod non listé. Cliquez pour le demander.', download: 'Télécharger', downloadWarning: 'Télécharger', modUpdated: 'MOD À JOUR', modOutdated: 'MOD OBSOLÈTE', requestUpdate: 'Demander une mise à jour', labelSteam: 'Steam:', labelCache: 'État du cache:', cacheSteam: 'Steam:', justNow: 'à l\'instant', minAgo: 'min', steamError: 'Non vérifié', steamErrorTip: 'Erreur de l\'API Steam. Version non vérifiée.', mirrorNoDate: 'Mirror sans date', mirrorNoDateTip: 'Impossible de vérifier la version du mirror.', clearCache: 'Vider le cache', cacheCooldown: 'Vider ({s}s)', idlePaused: 'En pause (Inactif)', idleActive: 'Actif', exactTimeWarn: 'Heure manquante dans le mirror.<br>Précision incertaine.', modUnavailable: 'Mod indisponible', modUnavailableTip: 'Introuvable dans les mirrors', modUnavailableSubTip: 'Aucun site/forum de mirrors trouvé pour demander l\'ajout du mod', modNotListedSubTip: 'Lisez les règles du site/forum avant de faire une demande', invalidLink: 'Lien invalide', invalidLinkTip: 'Le mirror a renvoyé un lien invalide ou non sécurisé.', checkedMirrors: 'Mirrors vérifiés:', bestAvailable: 'Meilleure version disponible sélectionnée', requestUpdateTip: 'Lisez les règles du site/forum avant de faire une demande', noForumTip: "Aucun site/forum de mirrors trouvé pour demander des mises à jour du mod.", clearCacheTip: 'Efface les données de vérification et relance la vérification.', steamFallbackWarn: "L'API de Steam n'a pas renvoyé de date. Données de la page Steam utilisées. (Estimé)", steamTimeMismatch: "Différence de date détectée entre l'API de Steam et la page Steam.", consoleStorageQuotaCleanup: 'Quota LocalStorage dépassé. Nettoyage préventif en cours...', consoleCacheWriteFailed: "Échec critique lors de l'écriture dans le cache après nettoyage.", consoleUnknownIcon: 'Icône inconnue : "{name}"', consoleWidgetUpdateFailed: 'Échec de la mise à jour du widget après expiration du cache :', consoleMirrorFallbackError: 'Erreur de Fallback (Mirror : {name}) :', consoleWidgetInjectError: "Erreur lors de l'injection des widgets Steam :", settingsTitle: 'Paramètres', toggleCacheInfo: 'État du cache', toggleMirrorInfo: 'Mirrors vérifiés' },
        de: { checkingVersion: 'Version wird geprüft...', mirrorError: 'Mirror-Fehler', requestMod: 'Mod anfragen', modNotListed: 'Mod nicht gelistet. Zum Anfragen klicken.', download: 'Herunterladen', downloadWarning: 'Herunterladen', modUpdated: 'MOD AKTUELL', modOutdated: 'MOD VERALTET', requestUpdate: 'Update anfragen', labelSteam: 'Steam:', labelCache: 'Cache-Status:', cacheSteam: 'Steam:', justNow: 'gerade eben', minAgo: 'Min. her', steamError: 'Nicht verifiziert', steamErrorTip: 'Steam API nicht erreichbar. Version nicht verifiziert.', mirrorNoDate: 'Mirror ohne Datum', mirrorNoDateTip: 'Mirror-Version konnte nicht verifiziert werden.', clearCache: 'Cache leeren', cacheCooldown: 'Cache leeren ({s}s)', idlePaused: 'Pausiert (Inaktiv)', idleActive: 'Aktiv', exactTimeWarn: 'Mirror ohne Uhrzeit.<br>Präzision ungewiss.', modUnavailable: 'Mod nicht verfügbar', modUnavailableTip: 'Nicht in den Mirrors gefunden', modUnavailableSubTip: 'Keine Mirror-Seite/Forum gefunden, um die Hinzufügung des Mods anzufragen', modNotListedSubTip: 'Lies die Regeln der Seite/des Forums, bevor du eine Anfrage stellst', invalidLink: 'Ungültiger Link', invalidLinkTip: 'Der Mirror hat einen ungültigen oder unsicheren Link zurückgegeben.', checkedMirrors: 'Überprüfte Mirrors:', bestAvailable: 'Beste verfügbare Version ausgewählt', requestUpdateTip: 'Lies die Regeln der Seite/des Forums, bevor du eine Anfrage stellst', noForumTip: 'Keine Mirror-Seite/Forum gefunden, um Updates für den Mod anzufragen.', clearCacheTip: 'Löscht die Überprüfungsdaten und prüft erneut.', steamFallbackWarn: 'Steam API lieferte kein Datum. Steam-Seitendaten verwendet. (Geschätzt)', steamTimeMismatch: 'Datumsunterschied zwischen Steam API und Steam-Seite erkannt.', consoleStorageQuotaCleanup: 'LocalStorage-Kontingent erschöpft. Präventive Bereinigung wird ausgeführt...', consoleCacheWriteFailed: 'Kritischer Fehler beim Schreiben in den Cache nach der Bereinigung.', consoleUnknownIcon: 'Unbekanntes Symbol: "{name}"', consoleWidgetUpdateFailed: 'Fehler beim Aktualisieren des Widgets nach Cache-Ablauf:', consoleMirrorFallbackError: 'Fallback-Fehler (Mirror: {name}):', consoleWidgetInjectError: 'Fehler beim Einbetten der Steam-Widgets:', settingsTitle: 'Einstellungen', toggleCacheInfo: 'Cache-Status', toggleMirrorInfo: 'Geprüfte Mirrors' },
        it: { checkingVersion: 'Controllo versione...', mirrorError: 'Errore Mirror', requestMod: 'Richiedi mod', modNotListed: 'Mod non presente. Clicca per richiederla.', download: 'Scarica', downloadWarning: 'Scarica', modUpdated: 'MOD AGGIORNATA', modOutdated: 'MOD NON AGGIORNATA', requestUpdate: 'Richiedi aggiornamento', labelSteam: 'Steam:', labelCache: 'Stato cache:', cacheSteam: 'Steam:', justNow: 'adesso', minAgo: 'min fa', steamError: 'Non verificato', steamErrorTip: 'API Steam non raggiungibile. Versione non verificata.', mirrorNoDate: 'Mirror senza data', mirrorNoDateTip: 'Impossibile verificare la versione del mirror.', clearCache: 'Svuota cache', cacheCooldown: 'Svuota cache ({s}s)', idlePaused: 'In pausa (Inattivo)', idleActive: 'Attivo', exactTimeWarn: 'Mirror senza ora.<br>Precisione incerta.', modUnavailable: 'Mod non disponibile', modUnavailableTip: 'Non trovato nei mirror', modUnavailableSubTip: 'Nessun sito/forum di mirror trovato per richiedere l\'aggiunta della mod', modNotListedSubTip: 'Leggi le regole del sito/forum prima di richiedere', invalidLink: 'Link non valido', invalidLinkTip: 'Il mirror ha restituito un link non valido o non sicuro.', checkedMirrors: 'Mirrors controllati:', bestAvailable: 'Migliore versione disponibile selezionata', requestUpdateTip: 'Leggi le regole del sito/forum prima di richiedere', noForumTip: 'Nessun sito/forum di mirror trovato per richiedere aggiornamenti della mod.', clearCacheTip: 'Cancella i dati di verifica e ricontrolla.', steamFallbackWarn: "L'API di Steam non ha restituito date. Dati pagina Steam utilizzati. (Stimato)", steamTimeMismatch: "Discrepanza di data tra API di Steam e pagina Steam.", consoleStorageQuotaCleanup: 'Quota LocalStorage raggiunta. Esecuzione pulizia preventiva...', consoleCacheWriteFailed: 'Errore critico durante la scrittura nella cache dopo la pulizia.', consoleUnknownIcon: 'Icona sconosciuta: "{name}"', consoleWidgetUpdateFailed: 'Impossibile aggiornare il widget dopo la scadenza della cache:', consoleMirrorFallbackError: 'Errore Fallback (Mirror: {name}):', consoleWidgetInjectError: "Errore durante l'iniezione dei widget Steam:", settingsTitle: 'Impostazioni', toggleCacheInfo: 'Stato cache', toggleMirrorInfo: 'Mirror verificati' },
        nl: { checkingVersion: 'Versie controleren...', mirrorError: 'Mirrorfout', requestMod: 'Mod aanvragen', modNotListed: 'Mod staat niet in de lijst. Klik om aan te vragen.', download: 'Downloaden', downloadWarning: 'Downloaden', modUpdated: 'MOD IS UP-TO-DATE', modOutdated: 'MOD IS VEROUDERD', requestUpdate: 'Update aanvragen', labelSteam: 'Steam:', labelCache: 'Cache-status:', cacheSteam: 'Steam:', justNow: 'zojuist', minAgo: 'min geleden', steamError: 'Ongecontroleerd', steamErrorTip: 'Steam API onbereikbaar. Versie niet gecontroleerd.', mirrorNoDate: 'Mirror zonder datum', mirrorNoDateTip: 'Kon de mirrorversie niet verifiëren.', clearCache: 'Cache wissen', cacheCooldown: 'Cache wissen ({s}s)', idlePaused: 'Gepauzeerd (Inactief)', idleActive: 'Actief', exactTimeWarn: 'Mirror mist tijd.<br>Precisie onzeker.', modUnavailable: 'Mod niet beschikbaar', modUnavailableTip: 'Niet gevonden in de mirrors', modUnavailableSubTip: 'Geen mirror-site/forum gevonden om de toevoeging van de mod aan te vragen', modNotListedSubTip: 'Lees de regels van de site/het forum voordat je een aanvraag doet', invalidLink: 'Ongeldige link', invalidLinkTip: 'De mirror gaf een ongeldige of onveilige link terug.', checkedMirrors: 'Gecontroleerde mirrors:', bestAvailable: 'Beste beschikbare versie geselecteerd', requestUpdateTip: 'Lees de regels van de site/het forum voordat je een aanvraag doet', noForumTip: 'Geen mirror-site/forum gevonden om updates voor de mod aan te vragen.', clearCacheTip: 'Wist de verificatiegegevens en controleert opnieuw.', steamFallbackWarn: 'Steam API gaf geen datum op. Steam-paginagegevens gebruikt. (Geschat)', steamTimeMismatch: 'Datumverschil tussen Steam API en Steam-pagina.', consoleStorageQuotaCleanup: 'LocalStorage-quotum bereikt. Preventieve opschoning wordt uitgevoerd...', consoleCacheWriteFailed: 'Kritieke fout bij schrijven naar cache na opschoning.', consoleUnknownIcon: 'Onbekend pictogram: "{name}"', consoleWidgetUpdateFailed: 'Bijwerken van widget mislukt na verlopen cache:', consoleMirrorFallbackError: 'Fallback-fout (Mirror: {name}):', consoleWidgetInjectError: 'Fout bij injecteren van Steam-widgets:', settingsTitle: 'Instellingen', toggleCacheInfo: 'Cache-status', toggleMirrorInfo: 'Gecontroleerde mirrors' },
        pl: { checkingVersion: 'Sprawdzanie wersji...', mirrorError: 'Błąd Mirrora', requestMod: 'Poproś o mod', modNotListed: 'Mod nie jest na liście. Kliknij, aby poprosić.', download: 'Pobierz', downloadWarning: 'Pobierz', modUpdated: 'MOD AKTUALNY', modOutdated: 'MOD NIEAKTUALNY', requestUpdate: 'Poproś o aktualizację', labelSteam: 'Steam:', labelCache: 'Stan pamięci podręcznej:', cacheSteam: 'Steam:', justNow: 'właśnie teraz', minAgo: 'min temu', steamError: 'Niezweryfikowane', steamErrorTip: 'API Steam niedostępne. Wersja niezweryfikowana.', mirrorNoDate: 'Mirror bez daty', mirrorNoDateTip: 'Nie można zweryfikować wersji mirrora.', clearCache: 'Wyczyść pamięć', cacheCooldown: 'Wyczyść pamięć ({s}s)', idlePaused: 'Wstrzymano (Bezczynny)', idleActive: 'Aktywny', exactTimeWarn: 'Brak godziny w mirrorze.<br>Precyzja niepewna.', modUnavailable: 'Mod niedostępny', modUnavailableTip: 'Nie znaleziono w mirrorach', modUnavailableSubTip: 'Nie znaleziono strony/forum mirrora do prośby o dodanie moda', modNotListedSubTip: 'Przeczytaj zasady strony/forum przed złożeniem prośby', invalidLink: 'Nieprawidłowy link', invalidLinkTip: 'Mirror zwrócił nieprawidłowy lub niebezpieczny link.', checkedMirrors: 'Sprawdzone mirrory:', bestAvailable: 'Wybrano najlepszą dostępną wersję', requestUpdateTip: 'Przeczytaj zasady strony/forum przed złożeniem prośby', noForumTip: 'Nie znaleziono strony/forum mirrora do proszenia o aktualizacje moda.', clearCacheTip: 'Czyści dane weryfikacji i sprawdza ponownie.', steamFallbackWarn: 'API Steam nie podało daty. Użyto danych ze strony Steam. (Szacowany)', steamTimeMismatch: 'Różnica daty między API Steam a stroną Steam.', consoleStorageQuotaCleanup: 'Przekroczono limit LocalStorage. Uruchamianie czyszczenia prewencyjnego...', consoleCacheWriteFailed: 'Krytyczny błąd podczas zapisu do pamięci podręcznej po czyszczeniu.', consoleUnknownIcon: 'Nieznana ikona: "{name}"', consoleWidgetUpdateFailed: 'Nie udało się zaktualizować widżetu po wygaśnięciu pamięci podręcznej:', consoleMirrorFallbackError: 'Błąd Fallback (Mirror: {name}):', consoleWidgetInjectError: 'Błąd podczas wstrzykiwania widżetów Steam:', settingsTitle: 'Ustawienia', toggleCacheInfo: 'Stan pamięci podręcznej', toggleMirrorInfo: 'Sprawdzone mirrory' },
        ru: { checkingVersion: 'Проверка версии...', mirrorError: 'Ошибка зеркала', requestMod: 'Запросить мод', modNotListed: 'Мода нет в списке. Нажмите, чтобы запросить.', download: 'Скачать', downloadWarning: 'Скачать', modUpdated: 'МОД АКТУАЛЕН', modOutdated: 'МОД УСТАРЕЛ', requestUpdate: 'Запросить обновление', labelSteam: 'Steam:', labelCache: 'Статус кэша:', cacheSteam: 'Steam:', justNow: 'только что', minAgo: 'мин назад', steamError: 'Не проверено', steamErrorTip: 'API Steam недоступен. Версия не проверена.', mirrorNoDate: 'Зеркало без даты', mirrorNoDateTip: 'Не удалось проверить версию зеркала.', clearCache: 'Очистить кэш', cacheCooldown: 'Очистить кэш ({s}s)', idlePaused: 'Пауза (Бездействие)', idleActive: 'Активно', exactTimeWarn: 'На зеркале нет времени.<br>Точность не гарантируется.', modUnavailable: 'Мод недоступен', modUnavailableTip: 'Не найдено на зеркалах', modUnavailableSubTip: 'Не найден сайт/форум зеркала для запроса добавления мода', modNotListedSubTip: 'Прочитайте правила сайта/форума перед запросом', invalidLink: 'Неверная ссылка', invalidLinkTip: 'Зеркало вернуло неверную или небезопасную ссылку.', checkedMirrors: 'Проверенные зеркала:', bestAvailable: 'Выбрана лучшая доступная версия', requestUpdateTip: 'Прочитайте правила сайта/форума перед запросом', noForumTip: 'Не найден сайт/форум зеркала для запроса обновлений мода.', clearCacheTip: 'Очищает данные проверки и выполняет проверку заново.', steamFallbackWarn: 'API Steam не вернуло дату. Используются данные страницы Steam. (Ориентировочно)', steamTimeMismatch: 'Разница дат между API Steam и страницей Steam.', consoleStorageQuotaCleanup: 'Достигнут лимит LocalStorage. Выполняется профилактическая очистка...', consoleCacheWriteFailed: 'Критическая ошибка записи в кэш после очистки.', consoleUnknownIcon: 'Неизвестная иконка: "{name}"', consoleWidgetUpdateFailed: 'Не удалось обновить виджет после истечения срока кэша:', consoleMirrorFallbackError: 'Ошибка Fallback (Mirror: {name}):', consoleWidgetInjectError: 'Ошибка при встраивании виджетов Steam:', settingsTitle: 'Настройки', toggleCacheInfo: 'Статус кэша', toggleMirrorInfo: 'Проверенные зеркала' },
        tr: { checkingVersion: 'Sürüm kontrol ediliyor...', mirrorError: 'Mirror hatası', requestMod: 'Mod iste', modNotListed: 'Mod listede yok. İstemek için tıkla.', download: 'İndir', downloadWarning: 'İndir', modUpdated: 'MOD GÜNCEL', modOutdated: 'MOD ESKİ', requestUpdate: 'Güncelleme iste', labelSteam: 'Steam:', labelCache: 'Önbellek Durumu:', cacheSteam: 'Steam:', justNow: 'şimdi', minAgo: 'dk önce', steamError: 'Doğrulanmadı', steamErrorTip: 'Steam API\'sine ulaşılamıyor. Sürüm doğrulanmadı.', mirrorNoDate: 'Tarihsiz Mirror', mirrorNoDateTip: 'Mirror sürümü doğrulanamadı.', clearCache: 'Önbelleği Temizle', cacheCooldown: 'Önbelleği temizle ({s}s)', idlePaused: 'Duraklatıldı (Boşta)', idleActive: 'Aktif', exactTimeWarn: 'Mirror\'da saat yok.<br>Kesinlik belirsiz.', modUnavailable: 'Mod mevcut değil', modUnavailableTip: 'Mirror\'larda bulunamadı', modUnavailableSubTip: 'Modun eklenmesini talep etmek için mirror sitesi/forumu bulunamadı', modNotListedSubTip: 'İstemeden önce site/forum kurallarını okuyun', invalidLink: 'Geçersiz Bağlantı', invalidLinkTip: 'Mirror geçersiz veya güvensiz bir bağlantı döndürdü.', checkedMirrors: 'Kontrol edilen mirror\'lar:', bestAvailable: 'Mevcut en iyi sürüm seçildi', requestUpdateTip: 'İstemeden önce site/forum kurallarını okuyun', noForumTip: 'Mod için güncelleme istemek üzere mirror sitesi/forumu bulunamadı.', clearCacheTip: 'Doğrulama verilerini temizler ve yeniden kontrol eder.', steamFallbackWarn: 'Steam API tarih vermedi. Steam sayfası verileri kullanılıyor. (Tahmini)', steamTimeMismatch: 'Steam API ve Steam sayfası arasında tarih farkı tespit edildi.', consoleStorageQuotaCleanup: 'LocalStorage kotası doldu. Önleyici temizlik çalıştırılıyor...', consoleCacheWriteFailed: 'Temizlik sonrasında önbelleğe yazılırken kritik hata oluştu.', consoleUnknownIcon: 'Bilinmeyen simge: "{name}"', consoleWidgetUpdateFailed: "Önbellek süresi dolmasının ardından widget güncellenemedi:", consoleMirrorFallbackError: 'Geri Dönüş Hatası (Mirror: {name}):', consoleWidgetInjectError: "Steam widget'ları enjekte edilirken hata oluştu:", settingsTitle: 'Ayarlar', toggleCacheInfo: 'Önbellek Durumu', toggleMirrorInfo: "Kontrol edilen mirror'lar" },
        zh: { checkingVersion: '正在检查版本...', mirrorError: '镜像错误', requestMod: '请求 Mod', modNotListed: 'Mod 未收录。点击请求。', download: '下载', downloadWarning: '下载', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已过期', requestUpdate: '请求更新', labelSteam: 'Steam:', labelCache: '缓存状态:', cacheSteam: 'Steam:', justNow: '刚刚', minAgo: '分钟前', steamError: '未验证', steamErrorTip: 'Steam API 无法访问。版本未验证。', mirrorNoDate: '镜像无日期', mirrorNoDateTip: '无法验证镜像版本。', clearCache: '清除缓存', cacheCooldown: '清除缓存 ({s}s)', idlePaused: '已暂停（空闲）', idleActive: '活跃', exactTimeWarn: '镜像缺少时间。<br>精度不确定。', modUnavailable: '模组不可用', modUnavailableTip: '镜像中未找到', modUnavailableSubTip: '未找到可用于请求添加该模组的镜像网站/论坛', modNotListedSubTip: '请求前请阅读网站/论坛规则', invalidLink: '链接无效', invalidLinkTip: '镜像返回了无效或不安全的链接。', checkedMirrors: '已检查的镜像:', bestAvailable: '已选择最佳可用版本', requestUpdateTip: '请求前请阅读网站/论坛规则', noForumTip: '未找到可用于请求该模组更新的镜像网站/论坛。', clearCacheTip: '清除验证数据并重新检查。', steamFallbackWarn: 'Steam API 未返回日期。使用 Steam 页面数据。（估计）', steamTimeMismatch: '检测到 Steam API 与 Steam 页面之间存在日期差异。', consoleStorageQuotaCleanup: 'LocalStorage 已达到配额上限，正在执行预防性清理...', consoleCacheWriteFailed: '清理后写入缓存时发生严重错误。', consoleUnknownIcon: '未知图标："{name}"', consoleWidgetUpdateFailed: '缓存过期后更新组件失败：', consoleMirrorFallbackError: '回退错误（镜像：{name}）：', consoleWidgetInjectError: '注入 Steam 组件时发生错误：', settingsTitle: '设置', toggleCacheInfo: '缓存状态', toggleMirrorInfo: '已检查的镜像' },
        zh_tw: { checkingVersion: '正在檢查版本...', mirrorError: '鏡像錯誤', requestMod: '請求 Mod', modNotListed: 'Mod 未收錄。點擊請求。', download: '下載', downloadWarning: '下載', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已過期', requestUpdate: '請求更新', labelSteam: 'Steam:', labelCache: '快取狀態:', cacheSteam: 'Steam:', justNow: '剛剛', minAgo: '分鐘前', steamError: '未驗證', steamErrorTip: 'Steam API 無法訪問。版本未驗證。', mirrorNoDate: '鏡像無日期', mirrorNoDateTip: '無法驗證鏡像版本。', clearCache: '清除快取', cacheCooldown: '清除快取 ({s}s)', idlePaused: '已暫停（閒置）', idleActive: '活躍', exactTimeWarn: '鏡像缺少時間。<br>精度不確定。', modUnavailable: '模組不可用', modUnavailableTip: '鏡像中未找到', modUnavailableSubTip: '未找到可用於請求添加該模組的鏡像網站/論壇', modNotListedSubTip: '請求前請閱讀網站/論壇規則', invalidLink: '連結無效', invalidLinkTip: '鏡像返回了無效或不安全的連結。', checkedMirrors: '已檢查的鏡像:', bestAvailable: '已選擇最佳可用版本', requestUpdateTip: '請求前請閱讀網站/論壇規則', noForumTip: '未找到可用於請求該模組更新的鏡像網站/論壇。', clearCacheTip: '清除驗證資料並重新檢查。', steamFallbackWarn: 'Steam API 未返回日期。使用 Steam 頁面資料。（估計）', steamTimeMismatch: '檢測到 Steam API 與 Steam 頁面之間存在日期差異。', consoleStorageQuotaCleanup: 'LocalStorage 已達到配額上限，正在執行預防性清理...', consoleCacheWriteFailed: '清理後寫入快取時發生嚴重錯誤。', consoleUnknownIcon: '未知圖示："{name}"', consoleWidgetUpdateFailed: '快取過期後更新元件失敗：', consoleMirrorFallbackError: '回退錯誤（鏡像：{name}）：', consoleWidgetInjectError: '注入 Steam 元件時發生錯誤：', settingsTitle: '設定', toggleCacheInfo: '快取狀態', toggleMirrorInfo: '已檢查的鏡像' },
        ja: { checkingVersion: 'バージョン確認中...', mirrorError: 'ミラーエラー', requestMod: 'Modをリクエスト', modNotListed: 'Modが未登録です。クリックしてリクエスト。', download: 'ダウンロード', downloadWarning: 'ダウンロード', modUpdated: 'MODは最新です', modOutdated: 'MODは古いです', requestUpdate: '更新をリクエスト', labelSteam: 'Steam:', labelCache: 'キャッシュ状態:', cacheSteam: 'Steam:', justNow: 'たった今', minAgo: '分前', steamError: '未検証', steamErrorTip: 'Steam APIにアクセスできません。バージョン未検証。', mirrorNoDate: '日付のないミラー', mirrorNoDateTip: 'ミラーのバージョンを確認できませんでした。', clearCache: 'キャッシュを消去', cacheCooldown: 'キャッシュ消去 ({s}s)', idlePaused: '一時停止（アイドル）', idleActive: 'アクティブ', exactTimeWarn: 'ミラーに時間がありません。<br>精度は不確実です。', modUnavailable: 'Mod利用不可', modUnavailableTip: 'ミラーに見つかりません', modUnavailableSubTip: 'Modの追加をリクエストできるミラーのサイト/フォーラムが見つかりません', modNotListedSubTip: 'リクエストする前にサイト/フォーラムのルールをお読みください', invalidLink: '無効なリンク', invalidLinkTip: 'ミラーが無効または安全でないリンクを返しました。', checkedMirrors: '確認したミラー:', bestAvailable: '利用可能な最適なバージョンを選択しました', requestUpdateTip: 'リクエストする前にサイト/フォーラムのルールをお読みください', noForumTip: 'MODの更新をリクエストできるミラーのサイト/フォーラムが見つかりません。', clearCacheTip: '検証データを消去して再チェックします。', steamFallbackWarn: 'Steam APIが日付を返しませんでした。Steamページのデータを使用。（推定）', steamTimeMismatch: 'Steam APIとSteamページの間で日付の不一致が検出されました。', consoleStorageQuotaCleanup: 'LocalStorage のクォータ上限に達しました。予防的クリーンアップを実行中...', consoleCacheWriteFailed: 'クリーンアップ後のキャッシュへの書き込みに重大な失敗が発生しました。', consoleUnknownIcon: '不明なアイコン："{name}"', consoleWidgetUpdateFailed: 'キャッシュ有効期限切れ後のウィジェット更新に失敗しました：', consoleMirrorFallbackError: 'フォールバックエラー（ミラー：{name}）：', consoleWidgetInjectError: 'Steam ウィジェットの注入中にエラーが発生しました：', settingsTitle: '設定', toggleCacheInfo: 'キャッシュ状態', toggleMirrorInfo: '確認したミラー' },
        ko: { checkingVersion: '버전 확인 중...', mirrorError: '미러 오류', requestMod: '모드 요청', modNotListed: '모드가 목록에 없습니다. 클릭해서 요청하세요.', download: '다운로드', downloadWarning: '다운로드', modUpdated: 'MOD 최신 상태', modOutdated: 'MOD 오래됨', requestUpdate: '업데이트 요청', labelSteam: 'Steam:', labelCache: '캐시 상태:', cacheSteam: 'Steam:', justNow: '방금', minAgo: '분 전', steamError: '확인 안 됨', steamErrorTip: 'Steam API에 접근할 수 없습니다. 버전이 확인되지 않았습니다.', mirrorNoDate: '날짜 없는 미러', mirrorNoDateTip: '미러 버전을 확인할 수 없습니다.', clearCache: '캐시 지우기', cacheCooldown: '캐시 지우기 ({s}s)', idlePaused: '일시 정지 (유휴)', idleActive: '활성', exactTimeWarn: '미러에 시간이 없습니다.<br>정확도 불확실.', modUnavailable: '모드 사용 불가', modUnavailableTip: '미러에서 찾을 수 없습니다', modUnavailableSubTip: '모드 추가를 요청할 미러 사이트/포럼을 찾을 수 없습니다', modNotListedSubTip: '요청하기 전에 사이트/포럼 규칙을 읽어주세요', invalidLink: '잘못된 링크', invalidLinkTip: '미러가 유효하지 않거나 안전하지 않은 링크를 반환했습니다.', checkedMirrors: '확인된 미러:', bestAvailable: '가장 적합한 버전을 선택했습니다', requestUpdateTip: '요청하기 전에 사이트/포럼 규칙을 읽어주세요', noForumTip: '모드의 업데이트를 요청할 미러 사이트/포럼을 찾을 수 없습니다.', clearCacheTip: '확인 데이터를 지우고 다시 확인합니다.', steamFallbackWarn: 'Steam API가 날짜를 반환하지 않았습니다. Steam 페이지 데이터 사용. (예상)', steamTimeMismatch: 'Steam API와 Steam 페이지 간의 날짜 차이가 감지되었습니다.', consoleStorageQuotaCleanup: 'LocalStorage 할당량 초과. 예방적 정리를 실행 중...', consoleCacheWriteFailed: '정리 후 캐시 쓰기 중 치명적 오류 발생.', consoleUnknownIcon: '알 수 없는 아이콘: "{name}"', consoleWidgetUpdateFailed: '캐시 만료 후 위젯 업데이트 실패:', consoleMirrorFallbackError: '폴백 오류 (미러: {name}):', consoleWidgetInjectError: 'Steam 위젯 주입 중 오류 발생:', settingsTitle: '설정', toggleCacheInfo: '캐시 상태', toggleMirrorInfo: '확인된 미러' }
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
        if (dropdownGlobal.classList.contains('show')) closeDropdown();
        closeTooltipIfOpen();

        // Re-renderiza todos os widgets ativos na tela com os textos do novo idioma
        reRenderAllWidgets();
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
    // ========================================================================
    // SISTEMA SVG MODULAR (Lucide Icons — viewBox 0 0 24 24)
    // Separa a *definição* dos ícones (dados) da sua *renderização* (fábrica).
    // Para adicionar um novo ícone: inclua uma entrada em Icons{}.
    // Para usá-lo em qualquer lugar: SvgIcon.build('nomeDoIcone', { ...opções }).
    // ========================================================================

    /**
     * Repositório central de definições de ícones SVG.
     * Cada entrada contém apenas o conteúdo interno do <svg> — paths e atributos
     * de traço — sem wrapper, sem tamanho fixo e sem cor fixa.
     * O wrapper completo é responsabilidade de SvgIcon.build().
     *
     * Todos os ícones são do conjunto Lucide Icons (https://lucide.dev/),
     * viewBox 0 0 24 24, fill="none", stroke-linecap/linejoin="round".
     *
     * Estrutura de cada entrada:
     *   paths       {string[]} — valores "d" de cada <path> (um elemento por caminho)
     *   strokeWidth {number}   — espessura do traço (padrão Lucide: 2; check usa 2.5)
     */
    const Icons = Object.freeze({

        // Lucide: check
        // Uso: estado "mod atualizado" — ícone do botão (CHECK_SVG) e do tooltip
        check: {
            paths: ['M20 6 9 17l-5-5'],
            strokeWidth: 2.5
        },

        // Lucide: globe-off
        // Uso: erro de rede no indicador de mirror (12 px, cor dinâmica)
        //      e no cabeçalho do tooltip STEAM_FETCH_ERROR (16 px, currentColor)
        globeOff: {
            paths: [
                'M10.114 4.462A14.5 14.5 0 0 1 12 2a10 10 0 0 1 9.313 13.643',
                'M15.557 15.556A14.5 14.5 0 0 1 12 22 10 10 0 0 1 4.929 4.929',
                'M15.892 10.234A14.5 14.5 0 0 0 12 2a10 10 0 0 0-3.643.687',
                'M17.656 12H22',
                'M19.071 19.071A10 10 0 0 1 12 22 14.5 14.5 0 0 1 8.44 8.45',
                'M2 12h10',
                'm2 2 20 20'
            ],
            strokeWidth: 2
        },

        // Lucide: chevron-down
        // Uso: seta do botão de menu suspenso (arrow button) — CHEVRON_DOWN_SVG
        chevronDown: {
            paths: ['m6 9 6 6 6-6'],
            strokeWidth: 2
        },

        // Lucide: settings-2
        // Uso: botão flutuante de configurações (FAB) no canto inferior direito
        settings: {
            paths: [
                'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
                'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
            ],
            strokeWidth: 2
        }

    });

    /**
     * Fábrica de SVGs inline — converte uma entrada de Icons{} em string <svg> completa.
     *
     * Separar dados (Icons) de renderização (SvgIcon) oferece:
     *   • Alterar tamanho/cor em cada ponto de uso sem duplicar o path
     *   • Adicionar novos ícones sem tocar na lógica de renderização
     *   • Consistência garantida de atributos estruturais (xmlns, viewBox, fill, etc.)
     *   • Fail-safe com aviso no console se um nome inválido for usado
     */
    const SvgIcon = Object.freeze({

        /**
         * Gera a string SVG completa para o ícone solicitado.
         *
         * @param {string}        name                       - Chave em Icons{} (ex: 'check', 'globeOff')
         * @param {object}        [opts={}]                  - Opções de personalização por ponto de uso
         * @param {string|number} [opts.size='1.2em']        - Valor de width/height (px inteiro ou string CSS)
         * @param {string}        [opts.stroke='currentColor'] - Cor do traço
         * @param {string}        [opts.style='']            - Conteúdo do atributo style
         * @param {string}        [opts.title='']            - Atributo title para acessibilidade/tooltip nativo
         * @returns {string} String SVG pronta para injeção via innerHTML ou template literal
         */
        build(name, opts = {}) {
            const icon = Icons[name];
            if (!icon) {
                console.warn('[SWDD/SvgIcon]', t.consoleUnknownIcon.replace('{name}', name));
                return '';
            }
            const { size = '1.2em', stroke = 'currentColor', style = '', title = '' } = opts;
            const styleAttr = style ? ` style="${style}"` : '';
            const titleAttr = title ? ` title="${title}"` : '';
            const inner = icon.paths.map(d => `<path d="${d}"/>`).join('');
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${icon.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${styleAttr}${titleAttr}>${inner}</svg>`;
        }

    });

    // Ícones pré-computados — tamanho (1.2em) e stroke (currentColor) fixos em todos os usos.
    // globe-off *não* está aqui porque cada chamada tem tamanho e/ou cor diferentes;
    // nesses casos usa-se SvgIcon.build('globeOff', { size, stroke, style, title }) diretamente.
    const CHECK_SVG        = SvgIcon.build('check',       { style: 'display:inline-block;vertical-align:middle;' });
    const CHEVRON_DOWN_SVG = SvgIcon.build('chevronDown', { style: 'display:inline-block;vertical-align:middle;' });

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

        /**
         * =======================================================
         * CONFIGURAÇÃO AUTOMÁTICA DO TAMANHO DA CAIXA
         * =======================================================
         * Normaliza quebras de linha explícitas (\n, <br>) e aplica o
         * algoritmo de quebra automática por palavra, evitando que o
         * CSS quebre em posição arbitrária e deixe espaço em branco.
         * 
         * @param {string} text - Texto a ser formatado
         * @param {number} maxChars - Limite de caracteres por linha (padrão: 50)
         * @returns {string} - HTML do texto formatado com <br>
         */
        formatTextWrap(text, maxChars = 50) {
            if (!text) return '';
            return String(text)
                .split(/<br\s*\/?>|\n/i)
                .map(line => {
                    const raw = line.trim();
                    if (raw.length > maxChars && raw.includes(' ')) {
                        const words = raw.split(' ');
                        let currentLine = '';
                        const lines = [];
                        for (const word of words) {
                            if (currentLine.length + word.length > maxChars && currentLine.length > 0) {
                                lines.push(escapeHTML(currentLine.trim()));
                                currentLine = word + ' ';
                            } else {
                                currentLine += word + ' ';
                            }
                        }
                        if (currentLine.trim()) lines.push(escapeHTML(currentLine.trim()));
                        return lines.join('<br>');
                    }
                    return escapeHTML(raw);
                })
                .join('<br>');
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
             * text: string,            // Texto principal
             * icon: string,            // Emoji ou ícone a ser renderizado antes do texto
             * link: string|null,       // URL de destino
             * stateClass: string,      // 'swdd-state-success', 'swdd-state-warning', etc
             * disabled: boolean,       // Define se o botão principal é clicável
             * timerExp: number,        // Timestamp (Date.now() + ms) para bloqueio temporário
             * tooltip: string,         // Dica exibida no painel escuro customizado ou nativo
             * dropdown: Array          // Lista de ações no menu suspenso
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
            const iconContent = config.icon
                ? (config.icon.startsWith('<') ? config.icon : escapeHTML(config.icon))
                : '';
            const iconHtml = config.icon ? `<span class="swdd-btn-icon">${iconContent}</span> ` : '';

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
                    html += `<button class="swdd-custom-btn ${cClass} ${config.stateClass} swdd-btn-arrow" data-dropdown-items="${dropdownData}">${CHEVRON_DOWN_SVG}</button>`;
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
            // Respeita a preferência do usuário (configurada pelo FAB de configurações)
            if (!showMirrorInfo) return '';

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
                    // Indicador visual: ícone globe-off SVG (Lucide Icons) quando há erro de
                    // conexão — substitui a bolinha inteiramente para deixar claro que o
                    // problema é de rede/acesso, sem exibir os dois elementos juntos.
                    const indicatorHtml = mirror.error
                        ? SvgIcon.build('globeOff', { size: 12, stroke: dotColor, style: 'margin-left: 6px; flex-shrink: 0;', title: escapeHTML(t.mirrorError) })
                        : `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${dotColor}; margin-left: 6px; box-shadow: 0 0 3px ${dotColor}60;"></span>`;
                    return `<span style="display: inline-flex; align-items: center; font-size: 11.5px; color: #E2E8F0; font-weight: 500; white-space: nowrap;">${escapeHTML(mirror.name)}${indicatorHtml}</span>`;
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
                    mirrorCacheRowsHtml += `<span class="swdd-tooltip-value" style="font-size:11px; color:#ff6b6b;">${escapeHTML(cmirror.name)}: ${escapeHTML(t.mirrorError)} ⚠️</span>`;
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
             *                            // do bloco de mirrors verificados. Default: true.
             *                            // Usar false quando NADA foi encontrado/selecionado
             *                            // (senão a frase contradiz o título de erro).
             * }
             */
            const titleHtml = `<div class="swdd-tooltip-title swdd-tooltip-${config.stateClass}"><span>${config.icon}</span> ${escapeHTML(config.titleText)}</div>`;
            const bodyHtml = config.bodyHtml || '';

            // Defaults true: omitir exige opt-out explícito, não opt-in que pode ser esquecido.
            // needsTopSeparator: só desenha a borda separadora se houver bodyHtml antes —
            // caso contrário a borda do título (logo acima) já cumpre esse papel.
            // Notices usados como único body (ex: "Mod não listado", "Mirror sem data") são
            // criados com noBorderTop=true, então NÃO têm borda própria — o separador sólido
            // abaixo deles (via needsTopSep=true) é o único divisor visual, o que é correto.
            const needsTopSep = !!bodyHtml;
            const mirrorCheckHtml = (config.showMirrorCheck !== false) ? this.createMirrorCheckNotice(config.consultedMirrors, config.showBestAvailable !== false, needsTopSep) : '';
            const cacheHtml = (config.showCache !== false) ? this.createCacheBlock(config.creationTimeSteam, config.steamCacheExp, config.consultedMirrors) : '';

            return `${titleHtml}${bodyHtml}${mirrorCheckHtml}${cacheHtml}`;
        },

        /**
         * MÓDULO DE AVISOS MODULAR (Notice System)
         * Centraliza a criação de todos os avisos/notificações exibidos no tooltip.
         * Garante estilo consistente e suporte nativo a quebra de linha automática (via CSS max-width)
         * e manual (via \n ou <br> no texto da tradução).
         *
         * Por que aqui: anteriormente cada aviso era gerado inline com <div style="...">
         * espalhados pelo renderWidget, com estilos duplicados e sem max-width no tooltip,
         * causando textos longos em linha única. Esta função resolve ambos os problemas.
         *
         * @param {'info'|'warning'|'error'} type - Tipo do aviso (define cor e ícone)
         * @param {string} message - Texto do aviso. Suporta \n e <br> para quebras explícitas.
         * @returns {string} HTML do aviso formatado e pronto para inserção no tooltip
         */
        createNotice(type, message, noBorderTop = false) {
            const icons = { info: 'ℹ️', warning: '⚠️', error: '🚫' };
            const icon = icons[type] || icons.info;
            const safeHtml = this.formatTextWrap(message, 50);
            // noBorderTop: quando o notice é o único conteúdo do body e vem logo após o título,
            // o título já tem border-bottom (linha sólida) que serve de separador.
            // Manter border-top no notice criaria dois separadores consecutivos — visual redundante.
            // Notices que vêm APÓS um grid (ex: exactTimeWarning) devem manter border-top.
            const borderStyle = noBorderTop ? ' style="border-top:none; margin-top:0; padding-top:0;"' : '';
            return `<div class="swdd-notice swdd-notice-${escapeHTML(type)}"${borderStyle}>` +
                   `<span class="swdd-notice-icon">${icon}</span>` +
                   `<span class="swdd-notice-text">${safeHtml}</span>` +
                   `</div>`;
        }
    };

    // Injeção de Estilos CSS via GM_addStyle
    // GM_addStyle é o método recomendado para injeção de estilos em userscripts:
    // delega ao runtime do gerenciador (ViolentMonkey/Tampermonkey) a criação
    // do nó <style> no momento mais adequado, sem depender de document.head estar
    // disponível e sem manipulação direta do DOM da página hospedeira.
    GM_addStyle(`
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
        .swdd-notice { display: flex; align-items: flex-start; gap: 5px; font-size: 11px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #3d4450; white-space: normal !important; line-height: 1.5; }
        .swdd-notice-icon { flex-shrink: 0; }
        .swdd-notice-text { flex: 1; min-width: 0; word-break: break-word; }
        .swdd-notice-info { color: #66c0f4; }
        .swdd-notice-warning { color: #F59E0B; }
        .swdd-notice-error { color: #ff6b6b; }
        #swdd-settings-fab { position: fixed !important; bottom: 20px !important; right: 20px !important; z-index: 2147483646 !important; border-radius: 50% !important; width: 36px !important; height: 36px !important; padding: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; background: linear-gradient(to bottom, #343f4d 5%, #222933 95%) !important; color: #acb2b8 !important; border: 1px solid #455366 !important; box-shadow: 0 4px 12px rgba(0,0,0,0.6) !important; transition: filter 0.2s, transform 0.2s, box-shadow 0.2s !important; user-select: none !important; -webkit-user-select: none !important; }
        #swdd-settings-fab:hover { filter: brightness(1.2) !important; transform: translateY(-2px) !important; box-shadow: 0 6px 16px rgba(0,0,0,0.8) !important; }
        #swdd-settings-fab.swdd-fab-open { background: linear-gradient(to bottom, #0d3d6b 5%, #071e35 95%) !important; color: #66c0f4 !important; border-color: #1a9fff !important; }
        #swdd-settings-panel { position: fixed !important; z-index: 2147483647 !important; background: #171a21 !important; border: 1px solid #3d4450 !important; border-radius: 6px !important; min-width: 240px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.9) !important; overflow: hidden !important; display: none !important; }
        #swdd-settings-panel.swdd-panel-show { display: block !important; }
        .swdd-settings-header { padding: 8px 12px 7px; color: #66c0f4; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #3d4450; font-family: "Motiva Sans", Arial, sans-serif; display: flex; align-items: center; gap: 6px; }
        .swdd-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; cursor: pointer; color: #acb2b8; font-size: 12px; font-family: "Motiva Sans", Arial, sans-serif; transition: background 0.15s; user-select: none; -webkit-user-select: none; -moz-user-select: none; }
        .swdd-settings-row:hover { background: #3d4450 !important; color: #fff !important; }
        .swdd-toggle-switch { width: 32px; height: 18px; border-radius: 9px; position: relative; transition: background 0.2s; flex-shrink: 0; }
        .swdd-toggle-switch.swdd-tog-on { background: #1a9fff; }
        .swdd-toggle-switch.swdd-tog-off { background: #455366; }
        .swdd-toggle-switch::after { content: ''; position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 50%; top: 2px; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
        .swdd-toggle-switch.swdd-tog-on::after { left: 16px; }
        .swdd-toggle-switch.swdd-tog-off::after { left: 2px; }
        .swdd-settings-subtitle { padding: 4px 12px 5px; font-size: 10px; color: #66c0f4; font-family: "Motiva Sans", Arial, sans-serif; border-bottom: 1px solid #2a3340; }
    `);

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
                closeUI();

                // Re-renderiza todos os widgets ativos na tela com os novos dados "zerados"
                reRenderAllWidgets();
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
                closeUI();
            }
            return;
        }

        // Ação: Botão da "Seta" para abrir menu dropdown
        const arrowBtn = e.target.closest('.swdd-btn-arrow');
        if (arrowBtn) {
            e.preventDefault(); e.stopPropagation();
            if (dropdownGlobal.classList.contains('show') && dropdownGlobal.lastArrow === arrowBtn) {
                closeUI();
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
                const rawText = link.getAttribute('data-swdd-tooltip') || '';
                const isWarnTip = link.hasAttribute('data-swdd-tooltip-warn');
                const tooltipColor = isWarnTip ? '#F59E0B' : 'inherit';
                
                const maxChars = 50;
                const dynamicMaxWidth = Math.ceil(maxChars * 7.5);
                const formattedText = TemplateEngine.formatTextWrap(rawText, maxChars);

                // O CSS usa a variável ${dynamicMaxWidth}px que cresce ou encolhe sozinha
                const tooltipHtml = `<div class="swdd-tooltip-row" style="display: inline-block; width: max-content; max-width: ${dynamicMaxWidth}px; line-height: 1.4; color: ${tooltipColor}; white-space: normal !important;">${formattedText}</div>`;
                bindTooltip(link, tooltipHtml);
            });

            return;
        }

        // Fecha o dropdown se o clique ocorrer em qualquer lugar fora dele
        if (!e.target.closest('.swdd-global-dropdown') && dropdownGlobal.classList.contains('show')) {
            closeUI();
        }

        // Fecha o painel de configurações se o clique ocorrer fora dele e fora do FAB
        if (!e.target.closest('#swdd-settings-panel') && !e.target.closest('#swdd-settings-fab')) {
            closeSettingsPanel();
        }
    }, true);

    /**
     * Oculta menus suspensos e tooltips ao rolar a página.
     * Impede que as caixas de UI flutuem incorretamente sobre outros elementos da Steam.
     * O uso de { passive: true } garante que a escuta não gere engasgos de processamento.
     */
    window.addEventListener('scroll', () => {
        if (dropdownGlobal.classList.contains('show')) {
            // Limpa qualquer seleção de texto deixada em um item do menu antes de fechá-lo,
            // evitando que ela "vaze" para a próxima vez que o menu for aberto.
            closeDropdown();
        }
        closeTooltipIfOpen();
        closeSettingsPanel();
    }, { passive: true });

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'swdd-custom-tooltip';
    if (typeof tooltipGlobal.showPopover === 'function') tooltipGlobal.setAttribute('popover', 'manual');
    let hoverTimer; // Temporizador (Debounce) para evitar "piscar" o tooltip passando o mouse rápido

    // ========================================================================
    // HELPERS DE FECHAMENTO DE UI (DRY — evita repetir 4 linhas em 5+ lugares)
    // Os três padrões abaixo apareciam idênticos em: applyLanguageChange, click
    // handler (limpar cache, link de fundo, seta, clique-fora) e scroll handler.
    // ========================================================================

    /**
     * Fecha o menu suspenso global e limpa qualquer seleção de texto residual.
     * Equivalente ao bloco de 4 linhas recorrente:
     *   dropdownGlobal.classList.remove('show');
     *   safeHidePopover(dropdownGlobal);
     *   dropdownGlobal.lastArrow = null;
     *   clearStaleDropdownSelection();
     */
    function closeDropdown() {
        dropdownGlobal.classList.remove('show');
        safeHidePopover(dropdownGlobal);
        dropdownGlobal.lastArrow = null;
        clearStaleDropdownSelection();
    }

    /**
     * Fecha o tooltip global somente se estiver visível.
     * Equivalente ao bloco recorrente:
     *   if (tooltipGlobal.classList.contains('show')) {
     *       clearTimeout(hoverTimer);
     *       tooltipGlobal.classList.remove('show');
     *       safeHidePopover(tooltipGlobal);
     *   }
     */
    function closeTooltipIfOpen() {
        if (tooltipGlobal.classList.contains('show')) {
            clearTimeout(hoverTimer);
            tooltipGlobal.classList.remove('show');
            safeHidePopover(tooltipGlobal);
        }
    }

    /**
     * Fecha tanto o menu suspenso quanto o tooltip de uma vez.
     * Convenção para os cenários onde ambos precisam ser fechados juntos
     * (mudança de idioma, limpeza de cache, clique fora, etc.).
     */
    function closeUI() {
        closeDropdown();
        closeTooltipIfOpen();
    }

    /**
     * Fecha o painel de configurações (FAB) se estiver visível.
     */
    function closeSettingsPanel() {
        const panel = document.getElementById('swdd-settings-panel');
        const fab   = document.getElementById('swdd-settings-fab');
        if (panel && panel.classList.contains('swdd-panel-show')) {
            panel.classList.remove('swdd-panel-show');
            if (fab) fab.classList.remove('swdd-fab-open');
        }
    }

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

    // Containers aguardando visibilidade: scheduleWidgetRender() os adiciona aqui e
    // widgetVisibilityObserver os remove quando entram no viewport.
    // Usado pelo heartbeat e por reRenderAllWidgets() para pular widgets que ainda
    // não foram renderizados pela primeira vez (evita requisições desnecessárias).
    const pendingObservation = new Set();

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
                if (!document.documentElement.contains(container)) {
                    activeWidgets.delete(container);
                    // Se o container ainda aguardava visibilidade, cancela a observação para liberar recursos
                    if (pendingObservation.has(container)) {
                        widgetVisibilityObserver.unobserve(container);
                        pendingObservation.delete(container);
                    }
                    continue;
                }

                // Containers ainda não visíveis (pendentes de observação) não possuem cache ativo
                // — pular verificação de expiração evita alocação de recursos desnecessária.
                // Quando entrarem no viewport, o widgetVisibilityObserver chamará renderWidget()
                // com os dados mais recentes disponíveis naquele momento.
                if (pendingObservation.has(container)) continue;

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
                            console.error('[SWDD]', t.consoleWidgetUpdateFailed, err);
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
    // Hierarquia: API -> SSR -> HTML
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
            });

            // Libera todas as Promises na fila
            idsToFetch.forEach(id => {
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
    async function getSteamDateAsync(modId) {
        const now = Date.now();

        if (localSteamCache[modId] && now >= localSteamCache[modId].exp) {
            delete steamDateCache[modId];
        }

        let cached = localSteamCache[modId];
        if (cached && now < cached.exp) {
            let dateSteam = (cached.date === STEAM_NO_DATE || cached.date === STEAM_FETCH_ERROR) ? cached.date : new Date(cached.date);
            if (dateSteam instanceof Date) {
                dateSteam.isFallback = cached.isFallback || false;
                dateSteam.hasTimeMismatch = cached.hasTimeMismatch || false;

                // BUGFIX: O cache pode ter sido gerado na página de lista (isCurrentPage=false),
                // onde a verificação do HTML é impossível. Ao entrar na página de detalhes,
                // a comparação DOM precisa ser feita independentemente do cache ainda ser válido,
                // pois só aqui temos acesso ao HTML da página para detectar conflitos de horário.
                const isCurrentPage = new URLSearchParams(window.location.search).get('id') === modId;
                if (isCurrentPage) {
                    const htmlDate = utils.parseSteamHTMLDate();
                    const mismatch = !!(htmlDate && Math.abs(htmlDate.date.getTime() - dateSteam.getTime()) > 300000);
                    dateSteam.hasTimeMismatch = mismatch;
                    // Persiste o resultado corrigido no cache para evitar re-verificações desnecessárias
                    if (cached.hasTimeMismatch !== mismatch) {
                        cached.hasTimeMismatch = mismatch;
                        saveSteamCache();
                    }
                }
            }
            steamDateCache[modId] = dateSteam;
            return dateSteam;
        }

        // 1. PRIORIDADE MÁXIMA: TENTA A API OFICIAL
        const apiResult = await new Promise(resolve => {
            pendingSteamIDs.add(modId);
            if (!steamCallbacks.has(modId)) steamCallbacks.set(modId, new Set());
            steamCallbacks.get(modId).add(() => resolve(steamDateCache[modId]));
            triggerSteamFetch();
        });

        const isCurrentPage = new URLSearchParams(window.location.search).get('id') === modId;
        let finalDate = apiResult;
        let mismatch = false;
        let fallback = false;

        // 2. SE A API FALHOU (N/A OU ERRO), TENTA OS DADOS DA PÁGINA (SSR ou HTML)
        if (!(apiResult instanceof Date) || apiResult === STEAM_NO_DATE) {
            const ssrData = utils.getSteamSSRData();
            if (ssrData && ssrData[modId]) { 
                finalDate = ssrData[modId]; 
                fallback = true; 
            } else if (isCurrentPage) {
                const htmlDate = utils.parseSteamHTMLDate();
                if (htmlDate) { 
                    finalDate = htmlDate.date; 
                    fallback = true; 
                }
            }
        } 
        // 3. SE A API FUNCIONOU, VERIFICA SE O HORÁRIO DO SITE É DIFERENTE (DETECTOR DE CONFLITOS/CACHE DA VALVE)
        else if (apiResult instanceof Date && isCurrentPage) {
            const htmlDate = utils.parseSteamHTMLDate();
            // Diferença maior que 5 minutos ativa o alerta de imprecisão
            if (htmlDate && Math.abs(htmlDate.date.getTime() - apiResult.getTime()) > 300000) {
                mismatch = true;
            }
        }

        if (finalDate instanceof Date) {
            finalDate.isFallback = fallback;
            finalDate.hasTimeMismatch = mismatch;
            steamDateCache[modId] = finalDate; 
            localSteamCache[modId] = { 
                date: finalDate.toISOString(), 
                exp: Date.now() + CACHE_TIME_STEAM_MS, 
                isFallback: fallback, 
                hasTimeMismatch: mismatch 
            };
            saveSteamCache();
        }

        return finalDate;
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

                // Mirrors per_mod passam pelo semáforo (PerModRequestLimiter) para evitar
                // burst de requisições simultâneas ao mesmo servidor durante scroll rápido.
                // Mirrors full_db fazem apenas 1 requisição compartilhada (deduplicada pelo
                // pendingMirrorRequests acima), então não precisam do semáforo.
                const res = mirrorConfig.type === 'per_mod'
                    ? await PerModRequestLimiter.forMirror(mirrorConfig.id).run(() => ApiClient.fetch(finalUrl))
                    : await ApiClient.fetch(finalUrl);

                const parsedData = mirrorConfig.type === 'per_mod' ? mirrorConfig.parser(res.responseText, modId) : mirrorConfig.parser(res.responseText);
                const cacheObj = { data: parsedData, exp: now + mirrorConfig.cacheTime, creation: now };

                if (mirrorConfig.type === 'per_mod') memoryMirrorCache[mirrorConfig.id][modId] = cacheObj;
                else memoryMirrorCache[mirrorConfig.id] = cacheObj;

                CacheManager.set(cacheKey, cacheObj);
                delete pendingMirrorRequests[requestKey];
                return cacheObj;
            } catch (e) {
                console.error('[SWDD]', t.consoleMirrorFallbackError.replace('{name}', mirrorConfig.name), e);
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

    /**
     * Re-renderiza todos os widgets ativos, removendo silenciosamente os que
     * foram desconectados da DOM (evita leak de memória no Set activeWidgets).
     * Padrão que aparecia duplicado em applyLanguageChange e no handler de
     * "Limpar Cache" — extraído aqui para manutenção em ponto único.
     *
     * Containers em pendingObservation (ainda não visíveis) são ignorados:
     * quando o IntersectionObserver os detectar, renderWidget() é chamado
     * com os dados mais recentes, então não há nada a re-renderizar agora.
     */
    function reRenderAllWidgets() {
        for (const container of activeWidgets) {
            if (!document.documentElement.contains(container)) { activeWidgets.delete(container); continue; }
            if (pendingObservation.has(container)) continue;
            if (container.dataset.modid) renderWidget(container, container.dataset.modid, container.dataset.iscard === 'true');
        }
    }

    /**
     * Constrói o item de "Limpar Cache" para o menu suspenso do botão.
     * Extraído porque aparecia idêntico em dois ramos do renderWidget:
     * no estado "Mod não encontrado" e nos estados de download.
     * Usa `t.*` diretamente (resolvido em tempo de chamada, nunca em tempo
     * de definição), garantindo que a troca dinâmica de idioma seja sempre respeitada.
     *
     * @returns {object} Item de dropdown configurado.
     */
    function createClearCacheDropdownItem() {
        return { text: t.clearCache, icon: '🔄', action: 'clearCache', condition: true, tooltip: t.clearCacheTip };
    }

    /**
     * Finaliza a renderização de um widget: define os mirrors ativos no dataset,
     * injeta o HTML do botão, vincula o tooltip e o exibe imediatamente se o
     * cursor já estiver sobre o container.
     *
     * Este bloco de 4 passos aparecia duplicado no ramo "notFound" e em todos
     * os ramos de download de renderWidget — centralizado aqui.
     * Nota: usa `.querySelector('.swdd-btn-group') || .firstElementChild` para
     * cobrir tanto o container de detalhe quanto os de card/lista, onde
     * createModularButton sempre envolve o botão em um .swdd-btn-group.
     *
     * @param {HTMLElement} container       - Elemento DOM que receberá o widget.
     * @param {boolean}     isCard          - Modo compacto (card) ou normal (detalhe).
     * @param {object}      btnConfig       - Configuração do botão (ver createModularButton).
     * @param {string}      tooltipHtmlStr  - HTML do tooltip já montado pelo TemplateEngine.
     * @param {Array}       consultedMirrors - Lista de mirrors consultados nesta checagem.
     */
    function applyWidgetResult(container, isCard, btnConfig, tooltipHtmlStr, consultedMirrors) {
        container.dataset.activeMirrorIds = JSON.stringify(consultedMirrors.map(m => m.id));
        container.innerHTML = TemplateEngine.createModularButton(isCard, btnConfig);
        const tooltipTarget = container.querySelector('.swdd-btn-group') || container.firstElementChild;
        bindTooltip(tooltipTarget, tooltipHtmlStr);
        if (container.matches(':hover')) {
            tooltipGlobal.innerHTML = tooltipHtmlStr;
            refreshTooltipTimers();
            tooltipGlobal.classList.add('show');
            safeShowPopover(tooltipGlobal);
        }
    }

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
                dropdown: [createClearCacheDropdownItem()]
            };

            const subTipText = GAME.forumUrl ? t.modNotListedSubTip : t.modUnavailableSubTip;
            // 'warning' (amarelo) para "leia as regras"; 'info' (azul) para mirror indisponível.
            // noBorderTop=true: este notice vem logo após o título (sem grid antes),
            // o título já tem border-bottom — não precisamos de border-top duplicada aqui.
            const subTipHtml = subTipText ? TemplateEngine.createNotice(GAME.forumUrl ? 'warning' : 'info', subTipText, true) : '';

            const tooltipHtmlStr = buildTooltip({
                stateClass: 'error',
                icon: GAME.forumUrl ? '❌' : '🚫',
                titleText: GAME.forumUrl ? t.modNotListed : t.modUnavailableTip,
                bodyHtml: subTipHtml,
                // Nada foi encontrado/selecionado aqui — mostrar "melhor versão
                // selecionada" junto do título de erro seria contraditório.
                showBestAvailable: false
            });

            applyWidgetResult(container, isCard, btnConfig, tooltipHtmlStr, consultedMirrors);
            return;
        }

        const { mirrorName, modData } = mirrorResult;
        const dateMirror = modData.date;
        const exactTime = modData.exactTime !== false;

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

        // Avisos contextuais gerados via sistema modular (createNotice):
        // Tipo 'info' = ℹ️ azul | 'warning' = ⚠️ amarelo | 'error' = 🚫 vermelho.
        // O max-width do tooltip garante quebra de linha automática sem precisar de <br> manual nos textos longos.
        let exactTimeWarningHtml = '';
        if (dateSteam && dateSteam.isFallback) {
            exactTimeWarningHtml += TemplateEngine.createNotice('info', t.steamFallbackWarn);
        }
        if (dateSteam && dateSteam.hasTimeMismatch) {
            exactTimeWarningHtml += TemplateEngine.createNotice('info', t.steamTimeMismatch);
        }
        if (!exactTime && dateMirror && dateSteam && dateSteam !== STEAM_NO_DATE && dateSteam !== STEAM_FETCH_ERROR) {
            // Se o dia coincidir (mesmo sem hora exata para comparar), solta o alerta amarelo
            const isSameDay = dateMirror.getFullYear() === dateSteam.getFullYear() && dateMirror.getMonth() === dateSteam.getMonth() && dateMirror.getDate() === dateSteam.getDate();
            if (isSameDay) {
                exactTimeWarningHtml += TemplateEngine.createNotice('warning', t.exactTimeWarn);
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
                createClearCacheDropdownItem(),
                {
                    text: t.requestUpdate,
                    icon: '💬',
                    link: GAME.forumUrl,
                    condition: isOutdated,
                    // Fórum bloqueado caso as configurações do jogo não definam uma URL
                    disabled: !GAME.forumUrl,
                    tooltip: GAME.forumUrl ? t.requestUpdateTip : t.noForumTip,
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
                icon: SvgIcon.build('globeOff', { size: 16, style: 'flex-shrink:0;' }),
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
                bodyHtml: TemplateEngine.createNotice('info', t.mirrorNoDateTip, true)
            });
        } else if (utils.isUpToDate(dateMirror, dateSteam)) {
            // Estado: mirror está na mesma versão (ou mais recente) que a Steam
            btnConfig.icon = CHECK_SVG;
            btnConfig.text = t.download;
            btnConfig.stateClass = TemplateEngine.THEMES.success.stateClass;
            // Exemplo de Timer: Poderíamos adicionar um atraso para leitura do aviso de versão defasada
            // btnConfig.timerExp = Date.now() + 5000;
            tooltipHtmlStr = buildTooltip({
                stateClass: 'success',
                icon: CHECK_SVG,
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

        applyWidgetResult(container, isCard, btnConfig, tooltipHtmlStr, consultedMirrors);
    }

    // ========================================================================
    // MÓDULO 7.1: LAZY RENDER — IntersectionObserver por Visibilidade
    // Só dispara renderWidget() quando o container entra no viewport (+ 200px
    // de margem de pré-carga). Isso evita que páginas com muitos mods visíveis
    // de uma vez (coleções grandes, listagens extensas) disparem dezenas ou
    // centenas de requisições simultâneas para os mirrors — causa direta dos
    // banimentos por excesso de tráfego.
    //
    // Aplica-se a todos os injetores: ModDetailPage, TitleLinks,
    // CardZoomIcons e CollectionItems. O container é inserido no DOM com
    // atributo data-swdd-pending="true" e permanece vazio até que a câmera
    // do viewport o alcance; só então o script faz as requisições de rede.
    // ========================================================================
    const widgetVisibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const container = entry.target;
            widgetVisibilityObserver.unobserve(container);
            pendingObservation.delete(container);
            delete container.dataset.swddPending;
            const modId  = container.dataset.modid;
            const isCard = container.dataset.iscard === 'true';
            if (modId) renderWidget(container, modId, isCard).catch(err => {
                console.error('[SWDD]', t.consoleWidgetUpdateFailed, err);
            });
        });
    }, {
        rootMargin: '200px 0px', // pré-carrega 200px antes do elemento entrar na tela
        threshold: 0
    });

    /**
     * Agenda a renderização do widget para quando o container entrar no viewport.
     * Substitui a chamada direta a renderWidget() nos injetores: em vez de
     * disparar requisições imediatamente, o container é registrado no observer
     * e fica marcado com data-swdd-pending="true" até ficar visível.
     *
     * @param {HTMLElement} container - O div do widget já inserido no DOM.
     * @param {string}      modId     - ID do mod Steam (apenas para consistência com renderWidget).
     * @param {boolean}     isCard    - Modo compacto (card) ou normal (detalhe).
     */
    function scheduleWidgetRender(container, modId, isCard) {
        void modId; void isCard; // lidos do dataset pelo observer; params mantidos por simetria com renderWidget
        pendingObservation.add(container);
        container.dataset.swddPending = 'true';
        widgetVisibilityObserver.observe(container);
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
                    scheduleWidgetRender(container, modId, false);
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
                            activeWidgets.add(container); scheduleWidgetRender(container, modId, false);
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
                        scheduleWidgetRender(container, modId, true);
                    }
                });
            }
        },
        {
            // Página de coleção do Workshop (sharedfiles/filedetails?id=... com vários mods listados).
            // Estrutura de cada item:
            //   <div class="collectionItem">
            //     <div class="subscriptionControls">
            //       <a id="SubscribeItemBtn{modId}" class="general_btn subscribe">...</a>
            //     </div>
            //   </div>
            // Os injetores ModDetailPage, TitleLinks e CardZoomIcons não cobrem esta página porque:
            //   – ModDetailPage busca #SubscribeItemBtn (sem sufixo) → não existe em coleções
            //   – TitleLinks busca h2 a[href*="?id="] → títulos de coleção usam div, não h2
            //   – CardZoomIcons busca .SVGIcon_MagnifyingGlass → ausente na UI legada de coleções
            name: "CollectionItems",
            match: () => document.querySelector('.collectionItem') !== null,
            inject: () => {
                document.querySelectorAll('.collectionItem').forEach(item => {
                    if (item.dataset.swddInjected) return;

                    // O botão de inscrição tem id="SubscribeItemBtn{modId}"
                    const subscribeBtn = item.querySelector('[id^="SubscribeItemBtn"]');
                    if (!subscribeBtn) return;

                    const modId = subscribeBtn.id.replace('SubscribeItemBtn', '');
                    if (!modId || !/^\d+$/.test(modId)) return;

                    item.dataset.swddInjected = 'true';

                    const controls = subscribeBtn.parentElement;
                    if (!controls) return;

                    // Transforma o contêiner de controles em flex row para acomodar o widget
                    controls.style.display    = 'flex';
                    controls.style.alignItems = 'center';
                    controls.style.gap        = '6px';
                    controls.style.flexWrap   = 'wrap';

                    const container = document.createElement('div');
                    container.className      = 'swdd-widget-container';
                    container.dataset.modid  = modId;
                    container.dataset.iscard = 'false';

                    stopCardNav(container);
                    subscribeBtn.insertAdjacentElement('beforebegin', container);
                    activeWidgets.add(container);
                    scheduleWidgetRender(container, modId, false);
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
            console.error('[SWDD]', t.consoleWidgetInjectError, error);
        }
    }

    let domCheckTimeout;
    const observerTarget = document.body || document.documentElement;

    // MutationObserver: Fica de olho nas alterações do site da Steam e roda os injetores automaticamente.
    const observer = new MutationObserver((mutations) => {
        let hasElementNodes = false;
        // Laço otimizado evitando alocações e iterações pesadas de Array para não gerar gargalo na navegação nativa.
        // Elementos do próprio script (prefixo "swdd-") são ignorados explicitamente: tooltip, dropdown e widgets
        // são inseridos/movidos no body pelo script, o que disparava runInjectors() a cada hover ou abertura de
        // menu — causando querySelectorAll desnecessários na página inteira sem nenhum benefício.
        for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (node.nodeType === 1 && !node.className?.startsWith?.('swdd-')) {
                    hasElementNodes = true; break;
                }
            }
            if (hasElementNodes) break;
        }
        if (hasElementNodes) { clearTimeout(domCheckTimeout); domCheckTimeout = setTimeout(runInjectors, 150); }
        // Re-injeta o FAB imediatamente se o Steam remover os elementos do DOM
        // (sem debounce: o FAB deve reaparecer antes mesmo da próxima renderização).
        ensureSettingsFab();
    });

    observer.observe(observerTarget, { childList: true, subtree: true });
    runInjectors(); // Primeira injeção síncrona manual ao carregar

    // ========================================================================
    // MÓDULO 9: BOTÃO FLUTUANTE DE CONFIGURAÇÕES (FAB)
    // Botão fixo no canto inferior direito que abre um painel de configurações
    // inline, seguindo o mesmo padrão visual (cores, fontes e estilos) do
    // restante do script. Substitui o GM_registerMenuCommand anterior.
    // ========================================================================

    /**
     * Reconstrói o HTML interno do painel de configurações refletindo o estado
     * atual de showCacheInfo e showMirrorInfo. Chamado sempre que o painel é
     * aberto ou após alternar uma opção.
     */
    function buildSettingsPanelHtml() {
        const settingsTitle  = t.settingsTitle  || 'Configurações';
        const cacheLabel     = t.toggleCacheInfo  || t.labelCache  || 'Status do Cache';
        const mirrorLabel    = t.toggleMirrorInfo || t.checkedMirrors || 'Mirrors verificados';

        const cacheToggleClass  = showCacheInfo  ? 'swdd-tog-on' : 'swdd-tog-off';
        const mirrorToggleClass = showMirrorInfo ? 'swdd-tog-on' : 'swdd-tog-off';

        const SETTINGS_SVG = SvgIcon.build('settings', { size: 14, style: 'display:inline-block;vertical-align:middle;flex-shrink:0;' });

        return `
            <div class="swdd-settings-header">${SETTINGS_SVG}<span>${escapeHTML(settingsTitle)}</span></div>
            <div class="swdd-settings-subtitle">Steam Workshop Direct Download</div>
            <div class="swdd-settings-row" data-swdd-setting="cacheInfo">
                <span>${escapeHTML(cacheLabel)}</span>
                <div class="swdd-toggle-switch ${cacheToggleClass}"></div>
            </div>
            <div class="swdd-settings-row" data-swdd-setting="mirrorInfo">
                <span>${escapeHTML(mirrorLabel)}</span>
                <div class="swdd-toggle-switch ${mirrorToggleClass}"></div>
            </div>
        `;
    }

    // Criação do botão FAB e do painel de configurações
    const settingsFab   = document.createElement('button');
    const settingsPanel = document.createElement('div');

    settingsFab.id        = 'swdd-settings-fab';
    settingsFab.className = 'swdd-fab-el'; // className começa com "swdd-": o MutationObserver ignora re-inserções
    settingsFab.setAttribute('aria-label', t.settingsTitle || 'Configurações SWDD');
    settingsFab.innerHTML = SvgIcon.build('settings', { size: 18, style: 'display:block;' });

    settingsPanel.id        = 'swdd-settings-panel';
    settingsPanel.className = 'swdd-panel-el'; // idem

    document.body.appendChild(settingsPanel);
    document.body.appendChild(settingsFab);

    /**
     * Re-injeta FAB e painel no body se o Steam tiver removido os elementos
     * (ex.: navegação SPA que substitui o conteúdo do body).
     * Chamado pelo MutationObserver a cada mutação, sem debounce.
     * O `className` "swdd-*" dos elementos garante que sua própria re-inserção
     * não dispara o debounce de `runInjectors()`.
     */
    function ensureSettingsFab() {
        if (settingsFab.isConnected) return; // já no DOM, nada a fazer
        // Fecha o painel antes de re-injetar (a página mudou; estado antigo não é mais válido)
        settingsPanel.classList.remove('swdd-panel-show');
        settingsFab.classList.remove('swdd-fab-open');
        const target = document.body || document.documentElement;
        target.appendChild(settingsPanel);
        target.appendChild(settingsFab);
    }

    /**
     * Posiciona o painel acima do FAB e garante que não extrapole as bordas da tela.
     */
    function positionSettingsPanel() {
        const fabRect     = settingsFab.getBoundingClientRect();
        const panelWidth  = 240;
        const panelHeight = settingsPanel.offsetHeight || 110;

        let bottom = window.innerHeight - fabRect.top + 8;
        let right  = window.innerWidth  - fabRect.right;

        // Evita extrapolação à esquerda
        const leftEdge = window.innerWidth - right - panelWidth;
        if (leftEdge < 8) right = window.innerWidth - panelWidth - 8;

        // Evita extrapolação no topo
        const topEdge = window.innerHeight - bottom - panelHeight;
        if (topEdge < 8) bottom = window.innerHeight - panelHeight - 8;

        settingsPanel.style.bottom = bottom + 'px';
        settingsPanel.style.right  = right  + 'px';
    }

    // Clique no FAB: abre/fecha o painel
    settingsFab.addEventListener('click', (e) => {
        e.stopPropagation();
        closeUI(); // Fecha dropdown e tooltip se abertos

        if (settingsPanel.classList.contains('swdd-panel-show')) {
            settingsPanel.classList.remove('swdd-panel-show');
            settingsFab.classList.remove('swdd-fab-open');
        } else {
            settingsPanel.innerHTML = buildSettingsPanelHtml();
            settingsPanel.classList.add('swdd-panel-show');
            settingsFab.classList.add('swdd-fab-open');
            positionSettingsPanel();
        }
    });

    // Clique num item de configuração dentro do painel
    settingsPanel.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = e.target.closest('.swdd-settings-row');
        if (!row) return;

        const setting = row.dataset.swddSetting;
        if (setting === 'cacheInfo') {
            showCacheInfo = showCacheInfo ? 0 : 1;
            GM_setValue('showCacheInfo', showCacheInfo);
        } else if (setting === 'mirrorInfo') {
            showMirrorInfo = showMirrorInfo ? 0 : 1;
            GM_setValue('showMirrorInfo', showMirrorInfo);
        } else {
            return;
        }

        // Atualiza o painel visualmente sem fechar
        settingsPanel.innerHTML = buildSettingsPanelHtml();
        // Nota: positionSettingsPanel() é intencionalmente omitido aqui.
        // O painel tem altura fixa (o toggle só troca uma classe CSS, não
        // altera o tamanho do conteúdo). Recalcular a posição causava um
        // deslocamento para baixo na primeira interação: ao abrir o painel
        // o FAB ainda está em hover (transform: translateY(-2px)), então
        // getBoundingClientRect() retorna coords deslocadas; no primeiro
        // clique no toggle o cursor já está sobre o painel (FAB sem hover),
        // fazendo a posição calculada diferir em ~2 px do posicionamento
        // inicial — o que o usuário percebia como a interface "descendo".

        // Fecha tooltip aberto (seu HTML já está desatualizado) e re-renderiza widgets
        closeTooltipIfOpen();
        reRenderAllWidgets();
    });

})();
