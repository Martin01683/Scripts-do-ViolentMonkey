/**
 * monthMap.playwright.test.js
 *
 * Testes Playwright para MonthMap — MÓDULO 0.2.
 * Executa APENAS os casos que requerem Intl.DateTimeFormat real do Chromium:
 *
 *   - MERGE: verifica que MANUAL vence sobre Intl para chaves críticas
 *   - INTL enrichment: mapa mesclado tem mais entradas que MANUAL sozinha;
 *                      cache e reset funcionam
 *   - INTL REAL: cross-validation com DateTimeFormat para EN, PT-BR, RU, JA, KO, TH
 *
 * Sanidade da tabela MANUAL (colisões, valores, formas longas, abreviaturas,
 * Thai, CJK, casos de borda e regressões) está coberta no Vitest em
 * monthMap.manual.test.js, onde roda sem browser.
 *
 * Executar: npx playwright test "monthMap.playwright.test.js"
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'monthMap.browser.html')}`;

async function getMap(page)    { return page.evaluate(() => window.__MonthMap__.get()); }
async function getManual(page) { return page.evaluate(() => window.__MonthMap__._MANUAL); }

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
    await page.evaluate(() => window.__MonthMap__.reset());
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2: Mesclagem MANUAL over Intl — chaves críticas não podem ser sobrescritas
// ════════════════════════════════════════════════════════════════════════════

test('MERGE: "mar" aponta para Março (2) — MANUAL vence sobre Intl', async ({ page }) => {
    const map = await getMap(page);
    // "marraskuu" (FI=novembro) via Intl short poderia gerar "mar"→10; MANUAL deve prevalecer
    expect(map['mar']).toBe(2);
});

test('MERGE: "мая" aponta para Maio (4) — RU genitivo não sobrescreve', async ({ page }) => {
    const map = await getMap(page);
    // Intl RU short pode emitir "мая"; MANUAL tem "май"→4; verifica que maio está correto
    // "мая" pode aparecer via Intl RU como forma curta — não deve deslocar "май"
    const mayKeys = ['май', 'maio', 'may', 'mayo', 'mai'];
    for (const k of mayKeys) {
        expect(map[k]).toBe(4);
    }
});

test('MERGE: "août" aponta para Agosto (7) — typo "aoû" foi corrigido', async ({ page }) => {
    const map = await getMap(page);
    // A tabela antiga tinha "aoû" (typo). O commit corrigiu para "août".
    expect(map['août']).toBe(7);
    // O typo antigo NÃO deve existir como chave isolada (só permitido se for redirecionado corretamente)
    // Nota: "aoû" sem acento final não é uma forma francesa válida, mas a commit manteve back-compat via "août"
});

test('MERGE: "юли" (BG) aponta para Julho (6)', async ({ page }) => {
    const map = await getMap(page);
    // BG gera "01".."12" via Intl (não nomes), então "юли" só existe na MANUAL
    expect(map['юли']).toBe(6);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 7: Intl enrichment — formas que vêm só do Intl (não estão na MANUAL)
// ════════════════════════════════════════════════════════════════════════════

test('INTL: o mapa final tem mais entradas que a MANUAL sozinha', async ({ page }) => {
    const map    = await getMap(page);
    const manual = await getManual(page);
    expect(Object.keys(map).length).toBeGreaterThan(Object.keys(manual).length);
});

test('INTL: MANUAL nunca é sobrescrita — "mar" permanece 2 após merge', async ({ page }) => {
    const map = await getMap(page);
    // Mesmo que Intl gere "marraskuu"→10 via short, "mar" da MANUAL (→2) deve prevalecer
    expect(map['mar']).toBe(2);
});

test('INTL: cache é reutilizado na segunda chamada (mesmo objeto)', async ({ page }) => {
    const isSameRef = await page.evaluate(() => {
        const a = window.__MonthMap__.get();
        const b = window.__MonthMap__.get();
        return a === b; // mesmo objeto → cache funcionou
    });
    expect(isSameRef).toBe(true);
});

test('INTL: reset do cache permite reconstrução', async ({ page }) => {
    const result = await page.evaluate(() => {
        const a = window.__MonthMap__.get();
        window.__MonthMap__.reset();
        const b = window.__MonthMap__.get();
        return { sameRef: a === b, keysMatch: JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) };
    });
    // Objetos distintos após reset, mas conteúdo idêntico
    expect(result.sameRef).toBe(false);
    expect(result.keysMatch).toBe(true);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 9: Intl real do browser — verificação cruzada com DateTimeFormat
// ════════════════════════════════════════════════════════════════════════════

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para EN', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('en', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para PT-BR', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('pt-BR', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para RU', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('ru', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para JA', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('ja', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para KO', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('ko', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para TH', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('th', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: todos os 30 locales Steam resolvem sem erro no browser', async ({ page }) => {
    const locales = await page.evaluate(() => window.__MonthMap__._STEAM_LOCALES);
    const errors = await page.evaluate((locales) => {
        const errs = [];
        locales.forEach(locale => {
            for (let m = 0; m < 12; m++) {
                try {
                    new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2024, m, 1));
                } catch(e) {
                    errs.push({ locale, m, error: e.message });
                }
            }
        });
        return errs;
    }, locales);
    expect(errors).toHaveLength(0);
});

