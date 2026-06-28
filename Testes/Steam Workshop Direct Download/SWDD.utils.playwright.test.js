/**
 * SWDD.utils.playwright.test.js
 *
 * Migração para Playwright dos unit tests de utilitários, originalmente
 * executados com Vitest (SWDD.utils.test.js).
 *
 * Cobre: escapeHTML, CacheManager, addOrUpdateMod, parseSmodsDate,
 *        parseInsaneDate, parseInsaneGHDate, getIdFromName,
 *        isUpToDate, extractJsonArray
 *
 * Todas as funções são invocadas via window.__SWDD__ no browser real (Chromium).
 * CacheManager usa buildMockStorage + buildCacheManager expostos no mesmo objeto.
 *
 * Executar: npx playwright test "SWDD.utils.playwright.test.js"
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'SWDD.browser.html')}`;

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
});


// ════════════════════════════════════════════════════════════════════════════
// escapeHTML
// ════════════════════════════════════════════════════════════════════════════

test.describe('escapeHTML', () => {

    test('retorna string vazia para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML(null));
        expect(r).toBe('');
    });

    test('retorna string vazia para undefined', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML(undefined));
        expect(r).toBe('');
    });

    test('não altera strings sem caracteres especiais', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('hello world'));
        expect(r).toBe('hello world');
    });

    test('escapa & → &amp;', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('a & b'));
        expect(r).toBe('a &amp; b');
    });

    test('escapa < → &lt;', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('<tag>'));
        expect(r).toBe('&lt;tag&gt;');
    });

    test('escapa > → &gt;', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('a > b'));
        expect(r).toBe('a &gt; b');
    });

    test("escapa ' → &#39;", async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML("it's"));
        expect(r).toBe('it&#39;s');
    });

    test('escapa " → &quot;', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('"quoted"'));
        expect(r).toBe('&quot;quoted&quot;');
    });

    test('escapa múltiplos caracteres especiais na mesma string', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('<a href="test">it\'s & me</a>'));
        expect(r).toBe('&lt;a href=&quot;test&quot;&gt;it&#39;s &amp; me&lt;/a&gt;');
    });

    test('converte número para string antes de escapar', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML(42));
        expect(r).toBe('42');
    });

    test('converte booleano para string', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML(true));
        expect(r).toBe('true');
    });

    test('string sem caracteres especiais retorna igual', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('Steam Workshop'));
        expect(r).toBe('Steam Workshop');
    });

    test('string com apenas & retorna &amp;', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('&'));
        expect(r).toBe('&amp;');
    });

    test('escapa múltiplos & na mesma string', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.escapeHTML('A & B & C'));
        expect(r).toBe('A &amp; B &amp; C');
    });
});


// ════════════════════════════════════════════════════════════════════════════
// CacheManager
// ════════════════════════════════════════════════════════════════════════════

test.describe('CacheManager', () => {

    test('set e get retornam o valor armazenado', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            cm.set('k1', { x: 42 });
            return cm.get('k1');
        });
        expect(r).toEqual({ x: 42 });
    });

    test('get retorna null para chave inexistente', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            return cm.get('nope');
        });
        expect(r).toBeNull();
    });

    test('remove apaga a chave', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            cm.set('k1', 'val');
            cm.remove('k1');
            return cm.get('k1');
        });
        expect(r).toBeNull();
    });

    test('clearByPrefix remove apenas chaves com o prefixo dado', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            cm.set('SWDD_a', 1);
            cm.set('SWDD_b', 2);
            cm.set('OTHER_c', 3);
            cm.clearByPrefix('SWDD_');
            return {
                a: cm.get('SWDD_a'),
                b: cm.get('SWDD_b'),
                c: cm.get('OTHER_c'),
            };
        });
        expect(r.a).toBeNull();
        expect(r.b).toBeNull();
        expect(r.c).toBe(3);
    });

    test('clearByPrefix sem correspondências não apaga nada', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            cm.set('k1', 'val');
            cm.clearByPrefix('NOMATCHES_');
            return cm.get('k1');
        });
        expect(r).toBe('val');
    });

    test('get retorna null para JSON inválido', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const storage = buildMockStorage();
            storage.setItem('bad', '{invalid_json}');
            const cm = buildCacheManager(storage, MOCK_T);
            return cm.get('bad');
        });
        expect(r).toBeNull();
    });

    test('set armazena objetos complexos (arrays)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            cm.set('arr', [1, 2, 3]);
            return cm.get('arr');
        });
        expect(r).toEqual([1, 2, 3]);
    });

    test('set sobrescreve valor existente', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            cm.set('k', { v: 1 });
            cm.set('k', { v: 2 });
            return cm.get('k');
        });
        expect(r).toEqual({ v: 2 });
    });

    test('handles QuotaExceededError: limpa SWDD_ e tenta de novo', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const storage = buildMockStorage();
            let calls = 0;
            const origSet = storage.setItem.bind(storage);
            storage.setItem = (k, v) => {
                calls++;
                if (calls === 1) { const e = new Error('Quota'); e.name = 'QuotaExceededError'; throw e; }
                origSet(k, v);
            };
            const cm = buildCacheManager(storage, MOCK_T);
            let threw = false;
            try { cm.set('SWDD_new', { x: 1 }); } catch { threw = true; }
            return { threw };
        });
        expect(r.threw).toBe(false);
    });

    test('handles NS_ERROR_DOM_QUOTA_REACHED sem lançar erro', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const storage = buildMockStorage();
            let calls = 0;
            storage.setItem = () => {
                calls++;
                if (calls === 1) { const e = new Error('NS Quota'); e.name = 'NS_ERROR_DOM_QUOTA_REACHED'; throw e; }
            };
            const cm = buildCacheManager(storage, MOCK_T);
            let threw = false;
            try { cm.set('k', 'v'); } catch { threw = true; }
            return { threw };
        });
        expect(r.threw).toBe(false);
    });

    test('remove chave inexistente não lança erro', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { buildCacheManager, buildMockStorage, MOCK_T } = window.__SWDD__;
            const cm = buildCacheManager(buildMockStorage(), MOCK_T);
            let threw = false;
            try { cm.remove('does_not_exist'); } catch { threw = true; }
            return { threw };
        });
        expect(r.threw).toBe(false);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.addOrUpdateMod
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.addOrUpdateMod', () => {

    test('adiciona novo mod a objeto vazio', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            addOrUpdateMod(obj, '123456', 'http://a.com/mod', null);
            return obj['123456'];
        });
        expect(r.link).toBe('http://a.com/mod');
        expect(r.date).toBeNull();
        expect(r.exactTime).toBe(true);
    });

    test('adiciona mod com data e exact=true', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            const date = new Date('2024-06-01');
            addOrUpdateMod(obj, '123456', 'http://a.com', { date, exact: true });
            return { dateISO: obj['123456'].date.toISOString(), exactTime: obj['123456'].exactTime };
        });
        expect(r.dateISO).toBe(new Date('2024-06-01').toISOString());
        expect(r.exactTime).toBe(true);
    });

    test('adiciona mod com exact=false', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            addOrUpdateMod(obj, '111', 'http://a.com', { date: new Date(), exact: false });
            return obj['111'].exactTime;
        });
        expect(r).toBe(false);
    });

    test('atualiza mod quando nova data é mais recente', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            const old = new Date('2024-01-01');
            const newer = new Date('2024-06-01');
            addOrUpdateMod(obj, '111', 'http://old.com', { date: old, exact: false });
            addOrUpdateMod(obj, '111', 'http://new.com', { date: newer, exact: true });
            return {
                link: obj['111'].link,
                dateIsNewer: obj['111'].date.getTime() === newer.getTime()
            };
        });
        expect(r.link).toBe('http://new.com');
        expect(r.dateIsNewer).toBe(true);
    });

    test('mantém mod existente quando nova data é mais antiga', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            const newer = new Date('2024-06-01');
            const old   = new Date('2024-01-01');
            addOrUpdateMod(obj, '111', 'http://new.com', { date: newer, exact: true });
            addOrUpdateMod(obj, '111', 'http://old.com', { date: old, exact: false });
            return obj['111'].link;
        });
        expect(r).toBe('http://new.com');
    });

    test('mantém mod existente quando nova entrada não tem data', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            addOrUpdateMod(obj, '111', 'http://first.com', { date: new Date('2024-01-01'), exact: true });
            addOrUpdateMod(obj, '111', 'http://second.com', null);
            return obj['111'].link;
        });
        expect(r).toBe('http://first.com');
    });

    test('gerencia múltiplos mods distintos', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            addOrUpdateMod(obj, '111111', 'http://a.com', null);
            addOrUpdateMod(obj, '222222', 'http://b.com', null);
            addOrUpdateMod(obj, '333333', 'http://c.com', null);
            return Object.keys(obj).length;
        });
        expect(r).toBe(3);
    });

    test('primeiro mod sem data pode ser substituído por um com data', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { addOrUpdateMod } = window.__SWDD__;
            const obj = {};
            addOrUpdateMod(obj, '999', 'http://no-date.com', null);
            const date = new Date();
            addOrUpdateMod(obj, '999', 'http://with-date.com', { date, exact: true });
            return { link: obj['999'].link, hasDate: obj['999'].date !== null };
        });
        expect(r.link).toBe('http://with-date.com');
        expect(r.hasDate).toBe(true);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.parseSmodsDate
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.parseSmodsDate', () => {

    test('retorna null para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseSmodsDate(null));
        expect(r).toBeNull();
    });

    test('retorna null para string vazia', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseSmodsDate(''));
        expect(r).toBeNull();
    });

    test('parsa "18 Jun at 19:58" aplicando offset UTC-3→UTC (+3)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('18 Jun at 19:58');
            if (!result) return null;
            return {
                exact:    result.exact,
                utcH:     result.date.getUTCHours(),
                utcM:     result.date.getUTCMinutes(),
                utcDay:   result.date.getUTCDate(),
                utcMonth: result.date.getUTCMonth(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
        expect(r.utcH).toBe(22);    // 19+3=22
        expect(r.utcM).toBe(58);
        expect(r.utcDay).toBe(18);
        expect(r.utcMonth).toBe(5); // Junho=5
    });

    test('parsa data sem hora (padrão 23:59:59 UTC)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('15 Mar, 2024');
            if (!result) return null;
            return {
                exact: result.exact,
                h:     result.date.getUTCHours(),
                m:     result.date.getUTCMinutes(),
                s:     result.date.getUTCSeconds(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.exact).toBe(false);
        expect(r.h).toBe(23);
        expect(r.m).toBe(59);
        expect(r.s).toBe(59);
    });

    test('parsa data com ano explícito', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('5 jan, 2023');
            if (!result) return null;
            return { year: result.date.getUTCFullYear(), month: result.date.getUTCMonth(), day: result.date.getUTCDate() };
        });
        expect(r).not.toBeNull();
        expect(r.year).toBe(2023);
        expect(r.month).toBe(0); // Janeiro=0
        expect(r.day).toBe(5);
    });

    test('parsa agosto sem ano', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('10 aug at 14:30');
            if (!result) return null;
            return { exact: result.exact, utcMonth: result.date.getUTCMonth(), utcH: result.date.getUTCHours() };
        });
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
        expect(r.utcMonth).toBe(7);  // Agosto=7
        expect(r.utcH).toBe(17);     // 14+3=17
    });

    test('parsa dezembro com ano e hora', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('25 dec, 2023 at 10:00');
            if (!result) return null;
            return {
                year:  result.date.getUTCFullYear(),
                month: result.date.getUTCMonth(),
                day:   result.date.getUTCDate(),
                utcH:  result.date.getUTCHours(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.year).toBe(2023);
        expect(r.month).toBe(11); // Dezembro=11
        expect(r.day).toBe(25);
        expect(r.utcH).toBe(13);  // 10+3=13
    });

    test('retorna null para string completamente inválida', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseSmodsDate('xyz abc def'));
        expect(r).toBeNull();
    });

    test('retorna null para mês desconhecido', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseSmodsDate('15 abc, 2024'));
        expect(r).toBeNull();
    });

    test('data futura sem ano é ajustada para ano anterior', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('31 dec at 23:30');
            if (!result) return null;
            return { time: result.date.getTime(), now: Date.now() };
        });
        if (r) {
            expect(r.time).toBeLessThanOrEqual(r.now + 60000);
        }
    });

    test('fallback ao construtor Date nativo para strings ISO-like', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('2024-01-15');
            if (!result) return null;
            return { isDate: result.date instanceof Date, exact: result.exact };
        });
        if (r) {
            expect(r.isDate).toBe(true);
            expect(r.exact).toBe(false);
        }
    });

    test('fallback com data+hora retorna exact=true', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseSmodsDate('2024-06-01 10:30');
            if (!result) return null;
            return { exact: result.exact };
        });
        if (r) expect(r.exact).toBe(true);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.parseInsaneDate
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.parseInsaneDate', () => {

    test('retorna null para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneDate(null));
        expect(r).toBeNull();
    });

    test('retorna null para string vazia', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneDate(''));
        expect(r).toBeNull();
    });

    test('retorna null para "0000-00-00"', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneDate('0000-00-00'));
        expect(r).toBeNull();
    });

    test('retorna null para "0000-00-00 00:00:00"', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneDate('0000-00-00 00:00:00'));
        expect(r).toBeNull();
    });

    test('parsa "2024-01-15 15:00" com offset GMT+1 → UTC', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneDate('2024-01-15 15:00');
            if (!result) return null;
            return {
                utcH:     result.date.getUTCHours(),
                utcDay:   result.date.getUTCDate(),
                utcMonth: result.date.getUTCMonth(),
                exact:    result.exact,
            };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(14);     // 15-1=14
        expect(r.utcDay).toBe(15);
        expect(r.utcMonth).toBe(0);
        expect(r.exact).toBe(true);
    });

    test('parsa "2024-06-20T10:30" (formato ISO com T)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneDate('2024-06-20T10:30');
            if (!result) return null;
            return { utcH: result.date.getUTCHours(), exact: result.exact };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(9);  // 10-1=9
        expect(r.exact).toBe(true);
    });

    test('exact=false quando sem componente de hora', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneDate('2024-03-10');
            return result ? { exact: result.exact } : null;
        });
        if (r) expect(r.exact).toBe(false);
    });

    test('retorna null para string inválida', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneDate('not-a-date'));
        expect(r).toBeNull();
    });

    test('parsa meia-noite: 00:00 GMT+1 → 23:00 UTC dia anterior', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneDate('2024-03-01 00:00');
            if (!result) return null;
            return {
                utcH:     result.date.getUTCHours(),
                utcDay:   result.date.getUTCDate(),
                utcMonth: result.date.getUTCMonth(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(23);
        expect(r.utcDay).toBe(29);   // 2024 é ano bissexto
        expect(r.utcMonth).toBe(1);  // Fevereiro=1
    });

    test('parsa data no final do ano', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneDate('2023-12-31 22:00');
            if (!result) return null;
            return {
                utcH:     result.date.getUTCHours(),
                utcDay:   result.date.getUTCDate(),
                utcMonth: result.date.getUTCMonth(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(21);   // 22-1=21
        expect(r.utcDay).toBe(31);
        expect(r.utcMonth).toBe(11);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.parseInsaneGHDate
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.parseInsaneGHDate', () => {

    test('retorna null para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneGHDate(null));
        expect(r).toBeNull();
    });

    test('retorna null para string vazia', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneGHDate(''));
        expect(r).toBeNull();
    });

    test('parsa "2024-01-15T15:30:00" com GMT+1→UTC', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneGHDate('2024-01-15T15:30:00');
            if (!result) return null;
            return {
                utcH:    result.date.getUTCHours(),
                utcMin:  result.date.getUTCMinutes(),
                utcDay:  result.date.getUTCDate(),
                utcMonth:result.date.getUTCMonth(),
                utcYear: result.date.getUTCFullYear(),
                exact:   result.exact,
            };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(14);    // 15-1=14
        expect(r.utcMin).toBe(30);
        expect(r.utcDay).toBe(15);
        expect(r.utcMonth).toBe(0);
        expect(r.utcYear).toBe(2024);
        expect(r.exact).toBe(true);
    });

    test('parsa "2024-01-15 15:30" (separador espaço)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneGHDate('2024-01-15 15:30');
            return result ? { utcH: result.date.getUTCHours(), exact: result.exact } : null;
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(14);
        expect(r.exact).toBe(true);
    });

    test('parsa sem segundos opcionais', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneGHDate('2024-06-20T12:00');
            return result ? result.date.getUTCHours() : null;
        });
        expect(r).toBe(11); // 12-1=11
    });

    test('retorna null para formato inválido (barras)', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneGHDate('2024/01/15 15:30'));
        expect(r).toBeNull();
    });

    test('retorna null para apenas data sem hora', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.parseInsaneGHDate('2024-01-15'));
        expect(r).toBeNull();
    });

    test('sempre marca como exact=true', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneGHDate('2024-06-01T10:00:00');
            return result ? result.exact : null;
        });
        expect(r).toBe(true);
    });

    test('meia-noite GMT+1: 00:00 → 23:00 UTC dia anterior', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneGHDate('2024-03-01T00:00:00');
            if (!result) return null;
            return {
                utcH:     result.date.getUTCHours(),
                utcDay:   result.date.getUTCDate(),
                utcMonth: result.date.getUTCMonth(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(23);
        expect(r.utcDay).toBe(29);   // 2024 bissexto
        expect(r.utcMonth).toBe(1);
    });

    test('parsa data de virada de ano', async ({ page }) => {
        const r = await page.evaluate(() => {
            const result = window.__SWDD__.parseInsaneGHDate('2024-01-01T01:00:00');
            if (!result) return null;
            return {
                utcH:    result.date.getUTCHours(),
                utcDay:  result.date.getUTCDate(),
                utcMonth:result.date.getUTCMonth(),
                utcYear: result.date.getUTCFullYear(),
            };
        });
        expect(r).not.toBeNull();
        expect(r.utcH).toBe(0);     // 1-1=0
        expect(r.utcDay).toBe(1);
        expect(r.utcMonth).toBe(0);
        expect(r.utcYear).toBe(2024);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.getIdFromName
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.getIdFromName', () => {

    test('extrai ID de "123456 Nome do Mod"', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('123456 Nome do Mod'));
        expect(r).toBe('123456');
    });

    test('extrai ID de 7 dígitos', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('1234567_arquivo'));
        expect(r).toBe('1234567');
    });

    test('extrai ID de 10 dígitos (Steam IDs longos)', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('3012345678 Mod'));
        expect(r).toBe('3012345678');
    });

    test('retorna null para número com menos de 6 dígitos', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('12345 Mod'));
        expect(r).toBeNull();
    });

    test('retorna null para string vazia', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName(''));
        expect(r).toBeNull();
    });

    test('retorna null para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName(null));
        expect(r).toBeNull();
    });

    test('retorna null para undefined', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName(undefined));
        expect(r).toBeNull();
    });

    test('aceita espaços iniciais antes do ID', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('  123456 Mod'));
        expect(r).toBe('123456');
    });

    test('retorna null quando começa com letras', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('abc123456'));
        expect(r).toBeNull();
    });

    test('retorna exatamente 6 dígitos (mínimo)', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('100000'));
        expect(r).toBe('100000');
    });

    test('não inclui caracteres após os dígitos', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.getIdFromName('3746153385 Some Mod Name Here'));
        expect(r).toBe('3746153385');
        expect(r.length).toBe(10);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.isUpToDate
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.isUpToDate', () => {

    test('retorna true quando dateSteam é STEAM_NO_DATE', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate, STEAM_NO_DATE } = window.__SWDD__;
            return isUpToDate(new Date('2024-05-31T12:00:00Z'), STEAM_NO_DATE);
        });
        expect(r).toBe(true);
    });

    test('retorna true quando dateSteam é STEAM_FETCH_ERROR', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate, STEAM_FETCH_ERROR } = window.__SWDD__;
            return isUpToDate(new Date('2024-05-31T12:00:00Z'), STEAM_FETCH_ERROR);
        });
        expect(r).toBe(true);
    });

    test('retorna false quando dateMirror é null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.isUpToDate(null, new Date('2024-06-01T12:00:00Z')));
        expect(r).toBe(false);
    });

    test('retorna false quando dateMirror é undefined', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.isUpToDate(undefined, new Date('2024-06-01T12:00:00Z')));
        expect(r).toBe(false);
    });

    test('retorna true quando mirror é igual ao Steam (mesmo minuto)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            const base    = new Date('2024-06-01T12:00:00Z');
            const sameMin = new Date(base.getTime() + 30000); // +30s, mesmo minuto
            return isUpToDate(sameMin, base);
        });
        expect(r).toBe(true);
    });

    test('retorna true quando mirror é mais recente', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            return isUpToDate(new Date('2024-06-02T12:00:00Z'), new Date('2024-06-01T12:00:00Z'));
        });
        expect(r).toBe(true);
    });

    test('retorna false quando mirror é mais antigo', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            return isUpToDate(new Date('2024-05-31T12:00:00Z'), new Date('2024-06-01T12:00:00Z'));
        });
        expect(r).toBe(false);
    });

    test('ignora diferença de segundos dentro do mesmo minuto', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            const steam  = new Date('2024-06-01T12:00:59Z');
            const mirror = new Date('2024-06-01T12:00:00Z');
            return isUpToDate(mirror, steam);
        });
        expect(r).toBe(true);
    });

    test('detecta diferença de 1 minuto como desatualizado', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            const steam  = new Date('2024-06-01T12:01:00Z');
            const mirror = new Date('2024-06-01T12:00:00Z');
            return isUpToDate(mirror, steam);
        });
        expect(r).toBe(false);
    });

    test('datas idênticas retornam true', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            const base = new Date('2024-06-01T12:00:00Z');
            return isUpToDate(base, base);
        });
        expect(r).toBe(true);
    });

    test('mirror exatamente 24h mais novo retorna true', async ({ page }) => {
        const r = await page.evaluate(() => {
            const { isUpToDate } = window.__SWDD__;
            const base        = new Date('2024-06-01T12:00:00Z');
            const mirrorAhead = new Date(base.getTime() + 86400000);
            return isUpToDate(mirrorAhead, base);
        });
        expect(r).toBe(true);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// utils.extractJsonArray
// ════════════════════════════════════════════════════════════════════════════

test.describe('utils.extractJsonArray', () => {

    test('retorna o texto original se for um array JSON válido', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = '[{"id":"1"},{"id":"2"}]';
            return window.__SWDD__.extractJsonArray(text, 'items');
        });
        expect(r).toBe('[{"id":"1"},{"id":"2"}]');
    });

    test('extrai array de objeto JSON por chave', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = JSON.stringify({ items: [1, 2, 3], other: 'x' });
            return window.__SWDD__.extractJsonArray(text, 'items');
        });
        expect(r).toBe('[1,2,3]');
    });

    test('extrai array de declaração const', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = 'const allMods = [{"name":"123456","link":"http://a.com"}];';
            return window.__SWDD__.extractJsonArray(text, 'allMods');
        });
        expect(r).toBe('[{"name":"123456","link":"http://a.com"}]');
    });

    test('extrai array de declaração let', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('let data = [1, 2, 3];', 'data'));
        expect(r).toBe('[1, 2, 3]');
    });

    test('extrai array de declaração var', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('var items = ["a","b"];', 'items'));
        expect(r).toBe('["a","b"]');
    });

    test('retorna null quando varName não é encontrado', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('const other = [1, 2, 3];', 'missing'));
        expect(r).toBeNull();
    });

    test('lida com arrays aninhados', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('const matrix = [[1,2],[3,4]];', 'matrix'));
        expect(r).toBe('[[1,2],[3,4]]');
    });

    test('strings com colchetes internos não confundem o parser', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('const items = ["[a]","[b]"];', 'items'));
        expect(r).toBe('["[a]","[b]"]');
    });

    test('retorna null para texto sem variável correspondente', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('just some text', 'items'));
        expect(r).toBeNull();
    });

    test('array vazio', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('const list = [];', 'list'));
        expect(r).toBe('[]');
    });

    test('objeto JSON com chave faltando retorna null', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = JSON.stringify({ other: [1, 2] });
            return window.__SWDD__.extractJsonArray(text, 'missing');
        });
        expect(r).toBeNull();
    });

    test('array com objetos complexos', async ({ page }) => {
        const r = await page.evaluate(() => {
            const mods = [{ name: '123456 Mod', link: 'http://x.com', uploaded: '2024-01-01 10:00' }];
            const text = `const allMods = ${JSON.stringify(mods)};`;
            return window.__SWDD__.extractJsonArray(text, 'allMods');
        });
        expect(r).not.toBeNull();
        const parsed = JSON.parse(r);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe('123456 Mod');
    });

    test("strings com aspas simples não fecham indevidamente", async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.extractJsonArray('const arr = ["it\'s fine"];', 'arr'));
        expect(r).toBe('["it\'s fine"]');
    });
});
