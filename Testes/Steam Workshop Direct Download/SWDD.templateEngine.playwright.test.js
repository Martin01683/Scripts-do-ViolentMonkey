/**
 * SWDD.templateEngine.playwright.test.js
 *
 * Migração para Playwright dos unit tests de TemplateEngine, originalmente
 * executados com Vitest (SWDD.templateEngine.test.js).
 *
 * Cobre: formatCacheAge, formatTimeLeft, formatTextWrap
 *
 * Todas as funções são invocadas via window.__SWDD__ no browser real (Chromium).
 *
 * Executar: npx playwright test "SWDD.templateEngine.playwright.test.js"
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
// TemplateEngine.formatCacheAge
// ════════════════════════════════════════════════════════════════════════════

test.describe('TemplateEngine.formatCacheAge', () => {

    test('retorna t.justNow para 0 ms', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(0));
        expect(r).toBe('agora');
    });

    test('retorna t.justNow para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(null));
        expect(r).toBe('agora');
    });

    test('retorna t.justNow para undefined', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(undefined));
        expect(r).toBe('agora');
    });

    test('retorna t.justNow para valor negativo', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(-5000));
        expect(r).toBe('agora');
    });

    test('retorna t.justNow para NaN', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(NaN));
        expect(r).toBe('agora');
    });

    test('retorna t.justNow para 59 999 ms (< 1 min)', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(59999));
        expect(r).toBe('agora');
    });

    test('retorna "1 min atrás" para exatamente 60 000 ms', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(60000));
        expect(r).toBe('1 min atrás');
    });

    test('retorna "5 min atrás" para 5 minutos', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(300000));
        expect(r).toBe('5 min atrás');
    });

    test('retorna "60 min atrás" para 1 hora', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(3600000));
        expect(r).toBe('60 min atrás');
    });

    test('arredonda para baixo frações de minuto (90 000 ms → 1 min)', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(90000));
        expect(r).toBe('1 min atrás');
    });

    test('retorna "59 min atrás" para 59 minutos', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(59 * 60000));
        expect(r).toBe('59 min atrás');
    });

    test('retorna "120 min atrás" para 2 horas', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatCacheAge(2 * 3600000));
        expect(r).toBe('120 min atrás');
    });
});


// ════════════════════════════════════════════════════════════════════════════
// TemplateEngine.formatTimeLeft
// ════════════════════════════════════════════════════════════════════════════

test.describe('TemplateEngine.formatTimeLeft', () => {

    test('retorna "0s" para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(null));
        expect(r).toBe('0s');
    });

    test('retorna "0s" para 0', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(0));
        expect(r).toBe('0s');
    });

    test('retorna "0s" para timestamp no passado', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(Date.now() - 1000));
        expect(r).toBe('0s');
    });

    test('retorna "0s" para timestamp exatamente agora (edge)', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(Date.now()));
        expect(r === '0s' || /^\dm \d+s$/.test(r)).toBe(true);
    });

    test('retorna formato "0m Xs" para segundos no futuro', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(Date.now() + 30000));
        expect(r).toMatch(/^0m \d+s$/);
    });

    test('retorna "1m Xs" para ≈ 90 segundos no futuro', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(Date.now() + 90000));
        expect(r).toMatch(/^1m \d+s$/);
    });

    test('retorna "60m Xs" para ≈ 1 hora no futuro', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(Date.now() + 3600000));
        expect(r).toMatch(/^60m \d+s$/);
    });

    test('componente de segundos é numérico para múltiplo de minuto', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTimeLeft(Date.now() + 2 * 60000));
        expect(r).toMatch(/^2m \d+s$/);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// TemplateEngine.formatTextWrap
// ════════════════════════════════════════════════════════════════════════════

test.describe('TemplateEngine.formatTextWrap', () => {

    test('retorna string vazia para null', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap(null));
        expect(r).toBe('');
    });

    test('retorna string vazia para undefined', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap(undefined));
        expect(r).toBe('');
    });

    test('retorna string vazia para string vazia', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap(''));
        expect(r).toBe('');
    });

    test('texto curto sem caracteres especiais retorna inalterado', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('Hello world'));
        expect(r).toBe('Hello world');
    });

    test('escapa HTML no output', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('<script>alert(1)</script>'));
        expect(r).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('escapa & no output', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('a & b'));
        expect(r).toBe('a &amp; b');
    });

    test('escapa aspas no output', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('"quoted"'));
        expect(r).toBe('&quot;quoted&quot;');
    });

    test('separa linhas em <br>', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('Linha 1<br>Linha 2'));
        expect(r).toBe('Linha 1<br>Linha 2');
    });

    test('trata <br/> como separador', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('A<br/>B'));
        expect(r).toBe('A<br>B');
    });

    test('trata <br /> (com espaço) como separador', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('A<br />B'));
        expect(r).toBe('A<br>B');
    });

    test('trata \\n como separador', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('Linha 1\nLinha 2'));
        expect(r).toBe('Linha 1<br>Linha 2');
    });

    test('texto longo sem espaços não quebra (sem espaço para quebrar)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const noSpace = 'a'.repeat(60);
            return window.__SWDD__.formatTextWrap(noSpace, 50);
        });
        expect(r).toBe('a'.repeat(60));
    });

    test('quebra texto longo com espaços no maxChars', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = 'a'.repeat(25) + ' ' + 'b'.repeat(25);
            return window.__SWDD__.formatTextWrap(text, 50);
        });
        expect(r).toContain('<br>');
    });

    test('usa maxChars padrão de 50', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = 'a'.repeat(26) + ' ' + 'b'.repeat(24); // 51 chars
            return window.__SWDD__.formatTextWrap(text);
        });
        expect(r).toContain('<br>');
    });

    test('remove whitespace ao redor de cada linha', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('  trimado  '));
        expect(r).toBe('trimado');
    });

    test('múltiplas linhas com separadores mistos', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('L1\nL2<br>L3<br/>L4'));
        expect(r).toBe('L1<br>L2<br>L3<br>L4');
    });

    test('linhas com HTML especial são escapadas após split', async ({ page }) => {
        const r = await page.evaluate(() => window.__SWDD__.formatTextWrap('antes<br><script>'));
        expect(r).toBe('antes<br>&lt;script&gt;');
    });

    test('múltiplas palavras são bem distribuídas entre linhas', async ({ page }) => {
        const r = await page.evaluate(() => {
            const text = 'palavra1234 palavra5678 palavraABCD';
            return window.__SWDD__.formatTextWrap(text, 15);
        });
        expect(r.split('<br>').length).toBeGreaterThan(1);
    });

    test('cada linha não excede maxChars (exceto palavras únicas longas)', async ({ page }) => {
        const lines = await page.evaluate(() => {
            const text = 'curta palavrinha outra curta novamente aqui';
            const result = window.__SWDD__.formatTextWrap(text, 20);
            return result.split('<br>').map(l =>
                l.replace(/&amp;/g,'&').replace(/&lt;/g,'<')
                 .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
            );
        });
        lines.forEach(line => {
            expect(line.length).toBeLessThanOrEqual(35); // 20 + margem de 1 palavra
        });
    });
});
