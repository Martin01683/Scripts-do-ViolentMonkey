/**
 * Playwright tests for Settings FAB — MÓDULO 9
 *
 * Testa o botão flutuante de configurações (FAB) adicionado ao script:
 *   - Existência e posicionamento do FAB no canto inferior direito
 *   - Abertura/fechamento do painel ao clicar no FAB
 *   - Alternância visual dos toggles (swdd-tog-on / swdd-tog-off)
 *   - Persistência das configurações via GM_getValue/GM_setValue
 *   - Fechamento ao clicar fora do painel
 *   - Estado ativo do FAB (swdd-fab-open) quando o painel está aberto
 *
 * Executar: npx playwright test Testes/settingsFab.playwright.test.js
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'settingsFab.browser.html')}`;

// ─── setup ───────────────────────────────────────────────────────────────────
test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
});

// ─── helpers ─────────────────────────────────────────────────────────────────
const fab      = () => '#swdd-settings-fab';
const panel    = () => '#swdd-settings-panel';
const rowCache  = () => '[data-swdd-setting="cacheInfo"]';
const rowMirror = () => '[data-swdd-setting="mirrorInfo"]';

async function openPanel(page) {
    await page.click(fab());
    await page.waitForSelector(`${panel()}.swdd-panel-show`);
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 1: Presença e posicionamento do FAB
// ════════════════════════════════════════════════════════════════════════════

test('FAB: botão existe no DOM', async ({ page }) => {
    await expect(page.locator(fab())).toBeAttached();
});

test('FAB: tem aria-label acessível', async ({ page }) => {
    const label = await page.locator(fab()).getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label.length).toBeGreaterThan(2);
});

test('FAB: está posicionado fixed no canto inferior direito', async ({ page }) => {
    const pos = await page.locator(fab()).evaluate(el => {
        const cs = getComputedStyle(el);
        return { position: cs.position, bottom: cs.bottom, right: cs.right };
    });
    expect(pos.position).toBe('fixed');
    // bottom e right devem ser valores numéricos positivos (px)
    expect(parseFloat(pos.bottom)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(pos.right)).toBeGreaterThanOrEqual(0);
});

test('FAB: é visível e clicável', async ({ page }) => {
    await expect(page.locator(fab())).toBeVisible();
    await expect(page.locator(fab())).toBeEnabled();
});

test('FAB: tem z-index alto (acima de todo conteúdo da página)', async ({ page }) => {
    const z = await page.locator(fab()).evaluate(el => parseInt(getComputedStyle(el).zIndex, 10));
    expect(z).toBeGreaterThan(9000);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2: Abertura e fechamento do painel
// ════════════════════════════════════════════════════════════════════════════

test('Painel: começa oculto', async ({ page }) => {
    await expect(page.locator(panel())).not.toHaveClass(/swdd-panel-show/);
    const display = await page.locator(panel()).evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('none');
});

test('Painel: abre ao clicar no FAB', async ({ page }) => {
    await openPanel(page);
    const display = await page.locator(panel()).evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');
});

test('Painel: fecha ao clicar no FAB novamente', async ({ page }) => {
    await openPanel(page);
    await page.click(fab()); // segundo clique fecha
    await page.waitForFunction(() => !document.querySelector('#swdd-settings-panel').classList.contains('swdd-panel-show'));
    const display = await page.locator(panel()).evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('none');
});

test('Painel: FAB recebe classe swdd-fab-open quando painel está aberto', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator(fab())).toHaveClass(/swdd-fab-open/);
});

test('Painel: FAB perde classe swdd-fab-open ao fechar', async ({ page }) => {
    await openPanel(page);
    await page.click(fab());
    await expect(page.locator(fab())).not.toHaveClass(/swdd-fab-open/);
});

test('Painel: fecha ao clicar fora do painel e do FAB', async ({ page }) => {
    await openPanel(page);
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForFunction(() => !document.querySelector('#swdd-settings-panel').classList.contains('swdd-panel-show'));
    await expect(page.locator(panel())).not.toHaveClass(/swdd-panel-show/);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 3: Conteúdo do painel
// ════════════════════════════════════════════════════════════════════════════

test('Painel: tem cabeçalho visível', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator('.swdd-settings-header')).toBeVisible();
    const text = await page.locator('.swdd-settings-header').innerText();
    expect(text.trim().length).toBeGreaterThan(0);
});

test('Painel: contém exatamente duas linhas de configuração', async ({ page }) => {
    await openPanel(page);
    const rows = page.locator('.swdd-settings-row');
    await expect(rows).toHaveCount(2);
});

test('Painel: linha "cacheInfo" está presente', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator(rowCache())).toBeAttached();
    await expect(page.locator(rowCache())).toBeVisible();
});

test('Painel: linha "mirrorInfo" está presente', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator(rowMirror())).toBeAttached();
    await expect(page.locator(rowMirror())).toBeVisible();
});

test('Painel: cada linha tem um toggle switch', async ({ page }) => {
    await openPanel(page);
    const switches = page.locator('.swdd-toggle-switch');
    await expect(switches).toHaveCount(2);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 4: Estado inicial dos toggles
// ════════════════════════════════════════════════════════════════════════════

test('Toggle Cache: começa DESLIGADO (padrão 0)', async ({ page }) => {
    await openPanel(page);
    const cls = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-off');
    expect(cls).not.toContain('swdd-tog-on');
});

test('Toggle Mirror: começa LIGADO (padrão 1)', async ({ page }) => {
    await openPanel(page);
    const cls = await page.locator(`${rowMirror()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-on');
    expect(cls).not.toContain('swdd-tog-off');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 5: Alternância dos toggles
// ════════════════════════════════════════════════════════════════════════════

test('Toggle Cache: liga ao clicar (off → on)', async ({ page }) => {
    await openPanel(page);
    await page.click(rowCache());
    const cls = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-on');
});

test('Toggle Mirror: desliga ao clicar (on → off)', async ({ page }) => {
    await openPanel(page);
    await page.click(rowMirror());
    const cls = await page.locator(`${rowMirror()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-off');
});

test('Toggle Cache: alterna duas vezes retorna ao estado original', async ({ page }) => {
    await openPanel(page);
    const clsBefore = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    await page.click(rowCache());
    await page.click(rowCache());
    const clsAfter = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    expect(clsAfter).toBe(clsBefore);
});

test('Toggle Mirror: alterna duas vezes retorna ao estado original', async ({ page }) => {
    await openPanel(page);
    const clsBefore = await page.locator(`${rowMirror()} .swdd-toggle-switch`).getAttribute('class');
    await page.click(rowMirror());
    await page.click(rowMirror());
    const clsAfter = await page.locator(`${rowMirror()} .swdd-toggle-switch`).getAttribute('class');
    expect(clsAfter).toBe(clsBefore);
});

test('Toggle: painel permanece aberto após alternar uma opção', async ({ page }) => {
    await openPanel(page);
    await page.click(rowCache());
    await expect(page.locator(panel())).toHaveClass(/swdd-panel-show/);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 6: Persistência via GM_setValue/GM_getValue
// ════════════════════════════════════════════════════════════════════════════

test('Persistência: ligar Cache grava showCacheInfo=1 no store', async ({ page }) => {
    await openPanel(page);
    await page.click(rowCache()); // off → on
    const stored = await page.evaluate(() => window.__swddTest__.getStoredCacheInfo());
    expect(stored).toBe(1);
});

test('Persistência: desligar Mirror grava showMirrorInfo=0 no store', async ({ page }) => {
    await openPanel(page);
    await page.click(rowMirror()); // on → off
    const stored = await page.evaluate(() => window.__swddTest__.getStoredMirrorInfo());
    expect(stored).toBe(0);
});

test('Persistência: estado interno sincroniza com GM store após toggle', async ({ page }) => {
    await openPanel(page);
    await page.click(rowCache());
    const internal = await page.evaluate(() => window.__swddTest__.getShowCacheInfo());
    const stored   = await page.evaluate(() => window.__swddTest__.getStoredCacheInfo());
    expect(internal).toBe(stored);
});

test('Persistência: dois toggles independentes não interferem entre si', async ({ page }) => {
    await openPanel(page);
    await page.click(rowCache());   // cache: 0 → 1
    // mirror não foi tocado, continua 1
    const cacheVal  = await page.evaluate(() => window.__swddTest__.getStoredCacheInfo());
    const mirrorVal = await page.evaluate(() => window.__swddTest__.getStoredMirrorInfo());
    expect(cacheVal).toBe(1);
    expect(mirrorVal).toBe(1);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 7: Estilo visual
// ════════════════════════════════════════════════════════════════════════════

test('Estilo: toggle ON tem fundo verde (#A3E33B)', async ({ page }) => {
    await openPanel(page);
    // Mirror começa ON; verifica cor de fundo
    const bg = await page.locator(`${rowMirror()} .swdd-toggle-switch`).evaluate(el => getComputedStyle(el).backgroundColor);
    // rgb(163, 227, 59) = #A3E33B
    expect(bg).toBe('rgb(163, 227, 59)');
});

test('Estilo: toggle OFF tem fundo escuro (#455366)', async ({ page }) => {
    await openPanel(page);
    // Cache começa OFF; verifica cor de fundo
    const bg = await page.locator(`${rowCache()} .swdd-toggle-switch`).evaluate(el => getComputedStyle(el).backgroundColor);
    // rgb(69, 83, 102) = #455366
    expect(bg).toBe('rgb(69, 83, 102)');
});

test('Estilo: painel tem fundo escuro (#171a21)', async ({ page }) => {
    await openPanel(page);
    const bg = await page.locator(panel()).evaluate(el => getComputedStyle(el).backgroundColor);
    // rgb(23, 26, 33) = #171a21
    expect(bg).toBe('rgb(23, 26, 33)');
});
