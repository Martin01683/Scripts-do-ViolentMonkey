/**
 * SWDD.playwright.test.js
 *
 * Testes Playwright para "Steam Workshop Direct Download.user.js".
 * Executa as funções utilitárias e de template no browser real (Chromium),
 * incluindo a função DOM-dependente parseSteamHTMLDate.
 *
 * Cobre:
 *   - escapeHTML (browser)
 *   - MonthMap.get() — merge Intl + MANUAL no browser
 *   - parseSmodsDate  (com Intl real disponível)
 *   - parseInsaneDate / parseInsaneGHDate
 *   - getIdFromName / isUpToDate / extractJsonArray
 *   - addOrUpdateMod
 *   - formatCacheAge / formatTimeLeft / formatTextWrap
 *   - parseSteamHTMLDate (DOM real do harness)
 *
 * Executar: npx playwright test "Testes/Steam Workshop Direct Download/SWDD.playwright.test.js"
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'SWDD.browser.html')}`;

// ── setup ─────────────────────────────────────────────────────────────────────
test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
    // Reseta cache do MonthMap entre testes
    await page.evaluate(() => window.__SWDD__.MonthMap.reset());
});

// ── helper: acessa __SWDD__ de forma concisa ──────────────────────────────────
const sw = (page, fn, ...args) => page.evaluate(
    ({ fn, args }) => window.__SWDD__[fn](...args),
    { fn, args }
);


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 1 — escapeHTML
// ════════════════════════════════════════════════════════════════════════════

test('escapeHTML: retorna vazio para null', async ({ page }) => {
    expect(await sw(page, 'escapeHTML', null)).toBe('');
});

test('escapeHTML: escapa & < > \' "', async ({ page }) => {
    const result = await sw(page, 'escapeHTML', '<a href="x">it\'s & me</a>');
    expect(result).toBe('&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; me&lt;/a&gt;');
});

test('escapeHTML: não altera strings limpas', async ({ page }) => {
    expect(await sw(page, 'escapeHTML', 'Steam Workshop')).toBe('Steam Workshop');
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2 — MonthMap (merge Intl real + MANUAL no browser)
// ════════════════════════════════════════════════════════════════════════════

test('MonthMap: "mar" aponta para Março (2) — MANUAL vence sobre Intl', async ({ page }) => {
    const map = await page.evaluate(() => window.__SWDD__.MonthMap.get());
    expect(map['mar']).toBe(2);
});

test('MonthMap: mapa final tem mais entradas que a MANUAL sozinha', async ({ page }) => {
    const { total, manual } = await page.evaluate(() => {
        const map = window.__SWDD__.MonthMap.get();
        // MANUAL inline tem ~300 entradas; Intl adiciona mais
        return { total: Object.keys(map).length, manual: 300 };
    });
    expect(total).toBeGreaterThan(manual);
});

test('MonthMap: cache é reutilizado (mesmo objeto referência)', async ({ page }) => {
    const same = await page.evaluate(() => {
        const a = window.__SWDD__.MonthMap.get();
        const b = window.__SWDD__.MonthMap.get();
        return a === b;
    });
    expect(same).toBe(true);
});

test('MonthMap: reset permite reconstrução com mesmo conteúdo', async ({ page }) => {
    const result = await page.evaluate(() => {
        const a = window.__SWDD__.MonthMap.get();
        window.__SWDD__.MonthMap.reset();
        const b = window.__SWDD__.MonthMap.get();
        const keysA = Object.keys(a).sort().join(',');
        const keysB = Object.keys(b).sort().join(',');
        return { sameRef: a===b, keysMatch: keysA===keysB };
    });
    expect(result.sameRef).toBe(false);
    expect(result.keysMatch).toBe(true);
});

test('MonthMap: Intl EN bate com DateTimeFormat para todos os 12 meses', async ({ page }) => {
    const failures = await page.evaluate(() => {
        const map = window.__SWDD__.MonthMap.get();
        const fails = [];
        for (let m=0; m<12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('en', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) fails.push({ name, expected: m, got: map[name] });
            });
        }
        return fails;
    });
    expect(failures).toHaveLength(0);
});

test('MonthMap: Intl PT-BR bate com DateTimeFormat para todos os 12 meses', async ({ page }) => {
    const failures = await page.evaluate(() => {
        const map = window.__SWDD__.MonthMap.get();
        const fails = [];
        for (let m=0; m<12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('pt-BR', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) fails.push({ name, expected: m, got: map[name] });
            });
        }
        return fails;
    });
    expect(failures).toHaveLength(0);
});

test('MonthMap: "юли" (BG=Julho) existe via MANUAL', async ({ page }) => {
    const map = await page.evaluate(() => window.__SWDD__.MonthMap.get());
    expect(map['юли']).toBe(6);
});

test('MonthMap: abreviaturas clássicas EN são corretas', async ({ page }) => {
    const map = await page.evaluate(() => window.__SWDD__.MonthMap.get());
    const expected = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    for (const [k, v] of Object.entries(expected)) {
        expect(map[k]).toBe(v);
    }
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 3 — parseSmodsDate
// ════════════════════════════════════════════════════════════════════════════

test('parseSmodsDate: retorna null para null', async ({ page }) => {
    expect(await sw(page, 'parseSmodsDate', null)).toBeNull();
});

test('parseSmodsDate: "18 Jun at 19:58" → UTC offset +3 aplicado', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { parseSmodsDate } = window.__SWDD__;
        const result = parseSmodsDate('18 Jun at 19:58');
        if (!result) return null;
        return { utcH: result.date.getUTCHours(), utcM: result.date.getUTCMinutes(),
                 utcDay: result.date.getUTCDate(), utcMonth: result.date.getUTCMonth(), exact: result.exact };
    });
    expect(r).not.toBeNull();
    expect(r.utcH).toBe(22);          // 19+3=22
    expect(r.utcM).toBe(58);
    expect(r.utcDay).toBe(18);
    expect(r.utcMonth).toBe(5);       // Junho=5
    expect(r.exact).toBe(true);
});

test('parseSmodsDate: "15 Mar, 2024" sem hora → padrão 23:59:59', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseSmodsDate('15 Mar, 2024');
        return result ? { h: result.date.getUTCHours(), m: result.date.getUTCMinutes(),
                          s: result.date.getUTCSeconds(), exact: result.exact } : null;
    });
    expect(r).not.toBeNull();
    expect(r.h).toBe(23);
    expect(r.m).toBe(59);
    expect(r.s).toBe(59);
    expect(r.exact).toBe(false);
});

test('parseSmodsDate: data com ano explícito preserva ano', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseSmodsDate('5 jan, 2023');
        return result ? { y: result.date.getUTCFullYear(), mo: result.date.getUTCMonth() } : null;
    });
    expect(r).not.toBeNull();
    expect(r.y).toBe(2023);
    expect(r.mo).toBe(0);
});

test('parseSmodsDate: string sem dígitos/mês retorna null', async ({ page }) => {
    // "!!!invalid!!!" não tem dígitos nem nome de mês → regex não bate → Date() falha
    expect(await sw(page, 'parseSmodsDate', '!!!invalid!!!')).toBeNull();
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 4 — parseInsaneDate
// ════════════════════════════════════════════════════════════════════════════

test('parseInsaneDate: retorna null para null', async ({ page }) => {
    expect(await sw(page, 'parseInsaneDate', null)).toBeNull();
});

test('parseInsaneDate: "0000-00-00" retorna null', async ({ page }) => {
    expect(await sw(page, 'parseInsaneDate', '0000-00-00 00:00:00')).toBeNull();
});

test('parseInsaneDate: "2024-01-15 15:00" → GMT+1→UTC (hora -1)', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseInsaneDate('2024-01-15 15:00');
        return result ? { utcH: result.date.getUTCHours(), exact: result.exact } : null;
    });
    expect(r).not.toBeNull();
    expect(r.utcH).toBe(14);          // 15-1=14
    expect(r.exact).toBe(true);
});

test('parseInsaneDate: sem hora → exact=false', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseInsaneDate('2024-03-10');
        return result ? { exact: result.exact } : null;
    });
    if (r) expect(r.exact).toBe(false);
});

test('parseInsaneDate: string inválida retorna null', async ({ page }) => {
    expect(await sw(page, 'parseInsaneDate', 'not-a-date')).toBeNull();
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 5 — parseInsaneGHDate
// ════════════════════════════════════════════════════════════════════════════

test('parseInsaneGHDate: retorna null para null', async ({ page }) => {
    expect(await sw(page, 'parseInsaneGHDate', null)).toBeNull();
});

test('parseInsaneGHDate: "2024-01-15T15:30:00" → hora UTC -1', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseInsaneGHDate('2024-01-15T15:30:00');
        return result ? { utcH: result.date.getUTCHours(), utcMin: result.date.getUTCMinutes(), exact: result.exact } : null;
    });
    expect(r).not.toBeNull();
    expect(r.utcH).toBe(14);
    expect(r.utcMin).toBe(30);
    expect(r.exact).toBe(true);
});

test('parseInsaneGHDate: separador espaço funciona', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseInsaneGHDate('2024-06-20 10:00:00');
        return result ? result.date.getUTCHours() : null;
    });
    expect(r).toBe(9);
});

test('parseInsaneGHDate: formato inválido retorna null', async ({ page }) => {
    expect(await sw(page, 'parseInsaneGHDate', '2024/01/15 10:00')).toBeNull();
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 6 — getIdFromName
// ════════════════════════════════════════════════════════════════════════════

test('getIdFromName: extrai 10 dígitos de início', async ({ page }) => {
    expect(await sw(page, 'getIdFromName', '3605677866 My Mod')).toBe('3605677866');
});

test('getIdFromName: menos de 6 dígitos retorna null', async ({ page }) => {
    expect(await sw(page, 'getIdFromName', '12345 Mod')).toBeNull();
});

test('getIdFromName: null retorna null', async ({ page }) => {
    expect(await sw(page, 'getIdFromName', null)).toBeNull();
});

test('getIdFromName: espaço inicial é ignorado', async ({ page }) => {
    expect(await sw(page, 'getIdFromName', '  123456 Mod')).toBe('123456');
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 7 — isUpToDate
// ════════════════════════════════════════════════════════════════════════════

test('isUpToDate: STEAM_NO_DATE sempre retorna true', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { isUpToDate, STEAM_NO_DATE } = window.__SWDD__;
        return isUpToDate(new Date('2020-01-01'), STEAM_NO_DATE);
    });
    expect(r).toBe(true);
});

test('isUpToDate: STEAM_FETCH_ERROR sempre retorna true', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { isUpToDate, STEAM_FETCH_ERROR } = window.__SWDD__;
        return isUpToDate(new Date('2020-01-01'), STEAM_FETCH_ERROR);
    });
    expect(r).toBe(true);
});

test('isUpToDate: null mirror retorna false', async ({ page }) => {
    const r = await page.evaluate(() => window.__SWDD__.isUpToDate(null, new Date()));
    expect(r).toBe(false);
});

test('isUpToDate: mirror mais recente retorna true', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { isUpToDate } = window.__SWDD__;
        const steam  = new Date('2024-06-01T12:00:00Z');
        const mirror = new Date('2024-06-02T12:00:00Z');
        return isUpToDate(mirror, steam);
    });
    expect(r).toBe(true);
});

test('isUpToDate: mirror mais antigo retorna false', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { isUpToDate } = window.__SWDD__;
        const steam  = new Date('2024-06-01T12:00:00Z');
        const mirror = new Date('2024-05-31T12:00:00Z');
        return isUpToDate(mirror, steam);
    });
    expect(r).toBe(false);
});

test('isUpToDate: diferença de segundos no mesmo minuto → true', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { isUpToDate } = window.__SWDD__;
        const steam  = new Date('2024-06-01T12:00:59Z');
        const mirror = new Date('2024-06-01T12:00:00Z');
        return isUpToDate(mirror, steam);
    });
    expect(r).toBe(true);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 8 — extractJsonArray
// ════════════════════════════════════════════════════════════════════════════

test('extractJsonArray: retorna texto para array JSON puro', async ({ page }) => {
    const text = '[1,2,3]';
    expect(await sw(page, 'extractJsonArray', text, 'items')).toBe(text);
});

test('extractJsonArray: extrai por chave de objeto JSON', async ({ page }) => {
    const text = JSON.stringify({ mods: [10, 20], other: 'x' });
    const r = await sw(page, 'extractJsonArray', text, 'mods');
    expect(r).toBe('[10,20]');
});

test('extractJsonArray: extrai de declaração const', async ({ page }) => {
    const text = 'const allMods = [{"name":"123456","link":"http://a.com"}];';
    const r = await sw(page, 'extractJsonArray', text, 'allMods');
    expect(r).toBe('[{"name":"123456","link":"http://a.com"}]');
});

test('extractJsonArray: retorna null para varName inexistente', async ({ page }) => {
    expect(await sw(page, 'extractJsonArray', 'const other = [];', 'missing')).toBeNull();
});

test('extractJsonArray: array vazio', async ({ page }) => {
    expect(await sw(page, 'extractJsonArray', 'let list = [];', 'list')).toBe('[]');
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 9 — addOrUpdateMod
// ════════════════════════════════════════════════════════════════════════════

test('addOrUpdateMod: adiciona novo mod', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { addOrUpdateMod } = window.__SWDD__;
        const obj = {};
        addOrUpdateMod(obj, '123456', 'http://x.com', null);
        return obj['123456'];
    });
    expect(r.link).toBe('http://x.com');
    expect(r.date).toBeNull();
});

test('addOrUpdateMod: atualiza para data mais recente', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { addOrUpdateMod } = window.__SWDD__;
        const obj = {};
        addOrUpdateMod(obj, '111', 'http://old.com', { date: new Date('2024-01-01'), exact: false });
        addOrUpdateMod(obj, '111', 'http://new.com', { date: new Date('2024-06-01'), exact: true });
        return { link: obj['111'].link };
    });
    expect(r.link).toBe('http://new.com');
});

test('addOrUpdateMod: mantém versão mais recente quando nova é mais antiga', async ({ page }) => {
    const r = await page.evaluate(() => {
        const { addOrUpdateMod } = window.__SWDD__;
        const obj = {};
        addOrUpdateMod(obj, '222', 'http://new.com', { date: new Date('2024-06-01'), exact: true });
        addOrUpdateMod(obj, '222', 'http://old.com', { date: new Date('2024-01-01'), exact: false });
        return { link: obj['222'].link };
    });
    expect(r.link).toBe('http://new.com');
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 10 — TemplateEngine (browser)
// ════════════════════════════════════════════════════════════════════════════

test('formatCacheAge: 0 ms retorna "agora"', async ({ page }) => {
    expect(await sw(page, 'formatCacheAge', 0)).toBe('agora');
});

test('formatCacheAge: 5 minutos retorna "5 min atrás"', async ({ page }) => {
    expect(await sw(page, 'formatCacheAge', 300000)).toBe('5 min atrás');
});

test('formatCacheAge: null retorna "agora"', async ({ page }) => {
    expect(await sw(page, 'formatCacheAge', null)).toBe('agora');
});

test('formatTimeLeft: null retorna "0s"', async ({ page }) => {
    expect(await sw(page, 'formatTimeLeft', null)).toBe('0s');
});

test('formatTimeLeft: passado retorna "0s"', async ({ page }) => {
    const past = Date.now() - 5000;
    expect(await sw(page, 'formatTimeLeft', past)).toBe('0s');
});

test('formatTimeLeft: futuro tem formato Xm Ys', async ({ page }) => {
    const future = await page.evaluate(() => Date.now() + 90000);
    const result = await sw(page, 'formatTimeLeft', future);
    expect(result).toMatch(/^\dm \d+s$/);
});

test('formatTextWrap: null retorna ""', async ({ page }) => {
    expect(await sw(page, 'formatTextWrap', null)).toBe('');
});

test('formatTextWrap: escapa HTML', async ({ page }) => {
    expect(await sw(page, 'formatTextWrap', '<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
});

test('formatTextWrap: texto com \\n separa em <br>', async ({ page }) => {
    expect(await sw(page, 'formatTextWrap', 'L1\nL2')).toBe('L1<br>L2');
});

test('formatTextWrap: texto longo quebra com <br>', async ({ page }) => {
    const long = 'palavra '.repeat(10); // 80 chars com espaços
    const result = await sw(page, 'formatTextWrap', long, 20);
    expect(result).toContain('<br>');
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 11 — parseSteamHTMLDate (DOM real do harness)
// ════════════════════════════════════════════════════════════════════════════

test('parseSteamHTMLDate: lê "Updated" row do DOM (15 Jun, 2024 @ 3:00pm)', async ({ page }) => {
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseSteamHTMLDate();
        if (!result) return null;
        return {
            year:  result.date.getFullYear(),
            month: result.date.getMonth(),
            day:   result.date.getDate(),
            hours: result.date.getHours(),
            isFallback: result.isFallback,
        };
    });
    expect(r).not.toBeNull();
    expect(r.year).toBe(2024);
    expect(r.month).toBe(5);           // Junho = 5
    expect(r.day).toBe(15);
    expect(r.hours).toBe(15);          // 3:00pm = 15h
    expect(r.isFallback).toBe(true);
});

test('parseSteamHTMLDate: retorna null quando não há labels no DOM', async ({ page }) => {
    await page.evaluate(() => {
        // Remove todos os .detailsStatLeft e .detailsStatRight
        document.querySelectorAll('.detailsStatLeft, .detailsStatRight').forEach(el => el.remove());
    });
    const r = await page.evaluate(() => window.__SWDD__.parseSteamHTMLDate());
    expect(r).toBeNull();
});

test('parseSteamHTMLDate: lê data de estrutura alternativa (apenas posted)', async ({ page }) => {
    await page.evaluate(() => {
        // Recria estrutura com apenas "Posted"
        const container = document.getElementById('swdd-test-steam-detail');
        container.innerHTML = `
            <div class="detailsStatLeft">Posted</div>
            <div class="detailsStatRight">20 Mar, 2023</div>
        `;
    });
    const r = await page.evaluate(() => {
        const result = window.__SWDD__.parseSteamHTMLDate();
        return result ? { year: result.date.getFullYear(), month: result.date.getMonth() } : null;
    });
    expect(r).not.toBeNull();
    expect(r.year).toBe(2023);
    expect(r.month).toBe(2);           // Março = 2
});
