/**
 * SWDD.playwright.test.js
 *
 * Testes Playwright para "Steam Workshop Direct Download.user.js".
 * Executa APENAS os casos que requerem browser real:
 *
 *   - MonthMap.get() — merge Intl + MANUAL no Chromium (Intl real necessário)
 *   - parseSteamHTMLDate — lê e interpreta nós do DOM real do harness
 *
 * As funções puras (escapeHTML, parseSmodsDate, parseInsaneDate,
 * parseInsaneGHDate, getIdFromName, isUpToDate, extractJsonArray,
 * addOrUpdateMod, formatCacheAge, formatTimeLeft, formatTextWrap)
 * estão cobertas no Vitest em SWDD.utils.test.js e
 * SWDD.templateEngine.test.js, onde rodam sem browser.
 *
 * Executar: npx playwright test "SWDD.playwright.test.js"
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'SWDD.browser.html')}`;

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
    await page.evaluate(() => window.__SWDD__.MonthMap.reset());
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
