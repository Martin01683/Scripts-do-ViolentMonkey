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

test('Estilo: toggle ON tem fundo azul (#1a9fff)', async ({ page }) => {
    await openPanel(page);
    // Mirror começa ON; verifica cor de fundo
    const bg = await page.locator(`${rowMirror()} .swdd-toggle-switch`).evaluate(el => getComputedStyle(el).backgroundColor);
    // rgb(26, 159, 255) = #1a9fff
    expect(bg).toBe('rgb(26, 159, 255)');
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

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 8: Estabilidade de posicionamento (regressão Bug #2)
// Garante que o painel NÃO se desloca ao clicar num toggle pela primeira vez.
// Causa original: positionSettingsPanel() no handler de toggle usava
// getBoundingClientRect() do FAB enquanto o hover transform já havia desfeito
// (cursor estava sobre o painel, não o FAB), provocando deslocamento de ~2 px.
// ════════════════════════════════════════════════════════════════════════════

test('Posição: painel não se move ao alternar Cache (primeira interação)', async ({ page }) => {
    // Hover sobre o FAB para ativar o transform: translateY(-2px)
    await page.hover(fab());
    // Click abre o painel enquanto o FAB ainda está em hover (posição deslocada)
    await page.click(fab());
    await page.waitForSelector(`${panel()}.swdd-panel-show`);

    const bottomBefore = await page.evaluate(() => window.__swddTest__.getPanelBottom());

    // Move o cursor para o toggle (FAB perde o hover, transform some)
    await page.hover(rowCache());
    await page.click(rowCache());

    const bottomAfter = await page.evaluate(() => window.__swddTest__.getPanelBottom());

    expect(bottomAfter).toBe(bottomBefore);
});

test('Posição: painel não se move ao alternar Mirror (primeira interação)', async ({ page }) => {
    await page.hover(fab());
    await page.click(fab());
    await page.waitForSelector(`${panel()}.swdd-panel-show`);

    const bottomBefore = await page.evaluate(() => window.__swddTest__.getPanelBottom());

    await page.hover(rowMirror());
    await page.click(rowMirror());

    const bottomAfter = await page.evaluate(() => window.__swddTest__.getPanelBottom());

    expect(bottomAfter).toBe(bottomBefore);
});

test('Posição: painel não se move em toggles sucessivos', async ({ page }) => {
    await page.hover(fab());
    await page.click(fab());
    await page.waitForSelector(`${panel()}.swdd-panel-show`);

    const bottomBefore = await page.evaluate(() => window.__swddTest__.getPanelBottom());

    // Alterna cache 3 vezes, mirror 2 vezes
    for (let i = 0; i < 3; i++) await page.click(rowCache());
    for (let i = 0; i < 2; i++) await page.click(rowMirror());

    const bottomAfter = await page.evaluate(() => window.__swddTest__.getPanelBottom());

    expect(bottomAfter).toBe(bottomBefore);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 9: Identificação do script — subtítulo (opção ①)
// Garante que o painel exibe o nome completo do script como subtítulo
// logo abaixo do cabeçalho, sem interferir nas linhas de configuração.
// ════════════════════════════════════════════════════════════════════════════

test('Subtítulo: existe e está visível quando o painel está aberto', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator('.swdd-settings-subtitle')).toBeVisible();
});

test('Subtítulo: exibe o nome completo "Steam Workshop Direct Download"', async ({ page }) => {
    await openPanel(page);
    const text = await page.locator('.swdd-settings-subtitle').innerText();
    expect(text.trim()).toBe('Steam Workshop Direct Download');
});

test('Subtítulo: tem a mesma cor do cabeçalho (#66c0f4)', async ({ page }) => {
    await openPanel(page);
    const color = await page.locator('.swdd-settings-subtitle').evaluate(el => getComputedStyle(el).color);
    // rgb(102, 192, 244) = #66c0f4
    expect(color).toBe('rgb(102, 192, 244)');
});

test('Subtítulo: aparece entre o cabeçalho e a primeira linha de configuração', async ({ page }) => {
    await openPanel(page);
    const headerBottom = await page.locator('.swdd-settings-header').evaluate(el => el.getBoundingClientRect().bottom);
    const subtitleTop  = await page.locator('.swdd-settings-subtitle').evaluate(el => el.getBoundingClientRect().top);
    const firstRowTop  = await page.locator('.swdd-settings-row').first().evaluate(el => el.getBoundingClientRect().top);
    expect(subtitleTop).toBeGreaterThanOrEqual(headerBottom);
    expect(firstRowTop).toBeGreaterThan(subtitleTop);
});

test('Subtítulo: não é uma linha de configuração (não tem data-swdd-setting)', async ({ page }) => {
    await openPanel(page);
    const attr = await page.locator('.swdd-settings-subtitle').getAttribute('data-swdd-setting');
    expect(attr).toBeNull();
});

test('Subtítulo: não interfere na contagem de linhas de configuração', async ({ page }) => {
    await openPanel(page);
    await expect(page.locator('.swdd-settings-row')).toHaveCount(2);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 10: Sincronização entre abas (GM_addValueChangeListener)
// Garante que mudanças de configuração feitas em outra aba/janela propagam-se
// para este contexto via o mecanismo de listener remoto.
// ════════════════════════════════════════════════════════════════════════════

test('Sync: mudança remota de showCacheInfo atualiza estado interno', async ({ page }) => {
    // Estado inicial: showCacheInfo = 0 (padrão)
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 1));
    const internal = await page.evaluate(() => window.__swddTest__.getShowCacheInfo());
    expect(internal).toBe(1);
});

test('Sync: mudança remota de showMirrorInfo atualiza estado interno', async ({ page }) => {
    // Estado inicial: showMirrorInfo = 1 (padrão)
    await page.evaluate(() => window.__triggerRemoteChange('showMirrorInfo', 0));
    const internal = await page.evaluate(() => window.__swddTest__.getShowMirrorInfo());
    expect(internal).toBe(0);
});

test('Sync: mudança remota com painel aberto atualiza toggle de cache', async ({ page }) => {
    await openPanel(page);
    // showCacheInfo começa OFF (0) — trigger remoto para ON (1)
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 1));
    const cls = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-on');
    expect(cls).not.toContain('swdd-tog-off');
});

test('Sync: mudança remota com painel aberto atualiza toggle de mirror', async ({ page }) => {
    await openPanel(page);
    // showMirrorInfo começa ON (1) — trigger remoto para OFF (0)
    await page.evaluate(() => window.__triggerRemoteChange('showMirrorInfo', 0));
    const cls = await page.locator(`${rowMirror()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-off');
    expect(cls).not.toContain('swdd-tog-on');
});

test('Sync: mudança remota com painel fechado é refletida ao abrir', async ({ page }) => {
    // Painel ainda fechado; simula outra aba ligando o cache
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 1));
    // Abre o painel agora — deve mostrar cache ON
    await openPanel(page);
    const cls = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-on');
});

test('Sync: mudança local não é tratada como remota pelo listener', async ({ page }) => {
    await openPanel(page);
    // Clique local: showCacheInfo 0 → 1
    await page.click(rowCache());
    const afterClick = await page.evaluate(() => window.__swddTest__.getShowCacheInfo());
    expect(afterClick).toBe(1);
    // Trigger remoto de retorno: 1 → 0 (confirma que o listener remoto ainda funciona)
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 0));
    const afterRemote = await page.evaluate(() => window.__swddTest__.getShowCacheInfo());
    expect(afterRemote).toBe(0);
    const cls = await page.locator(`${rowCache()} .swdd-toggle-switch`).getAttribute('class');
    expect(cls).toContain('swdd-tog-off');
});

test('Sync: múltiplas mudanças remotas preservam o estado final correto', async ({ page }) => {
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 1));
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 0));
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo', 1));
    const internal = await page.evaluate(() => window.__swddTest__.getShowCacheInfo());
    expect(internal).toBe(1);
});

test('Sync: mudanças remotas em cache e mirror são independentes', async ({ page }) => {
    await page.evaluate(() => window.__triggerRemoteChange('showCacheInfo',  1));
    await page.evaluate(() => window.__triggerRemoteChange('showMirrorInfo', 0));
    const cache  = await page.evaluate(() => window.__swddTest__.getShowCacheInfo());
    const mirror = await page.evaluate(() => window.__swddTest__.getShowMirrorInfo());
    expect(cache).toBe(1);
    expect(mirror).toBe(0);
});
