/**
 * collectionPage.playwright.test.js
 *
 * Testes Playwright para o injetor "CollectionItems" do
 * "Steam Workshop Direct Download.user.js".
 *
 * O injetor resolve o bug em que botões de download não apareciam em páginas
 * de coleção do Workshop (sharedfiles/filedetails?id=... com vários mods
 * listados), porque os outros três injetores (ModDetailPage, TitleLinks,
 * CardZoomIcons) não cobrem a estrutura HTML específica dessas páginas.
 *
 * Cobre:
 *   - Injeção básica: 3 containers criados para 3 itens válidos
 *   - Atributo data-modid correto em cada container
 *   - Atributo data-iscard="false" em todos os containers
 *   - Posição no DOM: container é irmão anterior ao botão de inscrição
 *   - Container inserido dentro do .subscriptionControls
 *   - Estilo flex aplicado no .subscriptionControls
 *   - Marcação data-swdd-injected nos itens processados
 *   - Itens sem botão de inscrição são ignorados
 *   - Itens com ID não-numérico são ignorados
 *   - Idempotência: segunda execução não cria duplicatas
 *   - activeWidgets tem o número correto de entradas
 *   - renderWidget é chamado com o modId correto
 *   - Itens adicionados dinamicamente são processados na re-execução
 *
 * Executar: npx playwright test Testes/collectionPage.playwright.test.js
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'collectionPage.browser.html')}`;

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
    // Garante estado limpo antes de cada teste
    await page.evaluate(() => window.__swddTest__.resetInjected());
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 1: Injeção básica
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: injeta widget em todos os 3 itens válidos', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const count = await page.locator('.swdd-widget-container').count();
    expect(count).toBe(3);
});

test('CollectionItems: widget do item 1 tem data-modid correto', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const modId = await page.locator('#sharedfile_1111111111 .swdd-widget-container').getAttribute('data-modid');
    expect(modId).toBe('1111111111');
});

test('CollectionItems: widget do item 2 tem data-modid correto', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const modId = await page.locator('#sharedfile_2222222222 .swdd-widget-container').getAttribute('data-modid');
    expect(modId).toBe('2222222222');
});

test('CollectionItems: widget do item 3 tem data-modid correto', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const modId = await page.locator('#sharedfile_3333333333 .swdd-widget-container').getAttribute('data-modid');
    expect(modId).toBe('3333333333');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2: Atributo data-iscard
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: widget tem data-iscard="false"', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const isCard = await page.locator('#sharedfile_1111111111 .swdd-widget-container').getAttribute('data-iscard');
    expect(isCard).toBe('false');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 3: Posição do widget no DOM
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: widget é o irmão imediatamente anterior ao botão de inscrição', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const isBeforeBtn = await page.evaluate(() => {
        const container = document.querySelector('#sharedfile_1111111111 .swdd-widget-container');
        const btn       = document.getElementById('SubscribeItemBtn1111111111');
        return container !== null && container.nextElementSibling === btn;
    });
    expect(isBeforeBtn).toBe(true);
});

test('CollectionItems: widget está dentro do .subscriptionControls', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const isInsideControls = await page.evaluate(() => {
        const container = document.querySelector('#sharedfile_1111111111 .swdd-widget-container');
        return container !== null && container.closest('.subscriptionControls') !== null;
    });
    expect(isInsideControls).toBe(true);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 4: Estilo flex no .subscriptionControls
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: .subscriptionControls recebe display:flex', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const display = await page.locator('#sharedfile_1111111111 .subscriptionControls').evaluate(el => el.style.display);
    expect(display).toBe('flex');
});

test('CollectionItems: .subscriptionControls recebe align-items:center', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const align = await page.locator('#sharedfile_1111111111 .subscriptionControls').evaluate(el => el.style.alignItems);
    expect(align).toBe('center');
});

test('CollectionItems: .subscriptionControls recebe gap:6px', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const gap = await page.locator('#sharedfile_1111111111 .subscriptionControls').evaluate(el => el.style.gap);
    expect(gap).toBe('6px');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 5: Marcação data-swdd-injected
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: item válido recebe data-swdd-injected="true"', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const injected = await page.locator('#sharedfile_1111111111').getAttribute('data-swdd-injected');
    expect(injected).toBe('true');
});

test('CollectionItems: item sem botão NÃO recebe data-swdd-injected', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const injected = await page.locator('#sharedfile_nobutton').getAttribute('data-swdd-injected');
    expect(injected).toBeNull();
});

test('CollectionItems: item com ID não-numérico NÃO recebe data-swdd-injected', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const injected = await page.locator('#sharedfile_badid').getAttribute('data-swdd-injected');
    expect(injected).toBeNull();
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 6: Itens ignorados (casos de borda)
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: item sem botão de inscrição não ganha widget', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const count = await page.locator('#sharedfile_nobutton .swdd-widget-container').count();
    expect(count).toBe(0);
});

test('CollectionItems: item com ID não-numérico no botão não ganha widget', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const count = await page.locator('#sharedfile_badid .swdd-widget-container').count();
    expect(count).toBe(0);
});

test('CollectionItems: itens inválidos não alteram .subscriptionControls para flex', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    // O item sem botão não deve ter tido o display alterado
    const display = await page.locator('#sharedfile_nobutton .subscriptionControls').evaluate(el => el.style.display);
    expect(display).toBe('');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 7: Idempotência
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: segunda execução não cria widgets duplicados', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    await page.evaluate(() => window.__swddTest__.runInjector()); // segunda vez
    const count = await page.locator('.swdd-widget-container').count();
    expect(count).toBe(3); // ainda exatamente 3, não 6
});

test('CollectionItems: activeWidgets tem exatamente 3 entradas após injeção', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const count = await page.evaluate(() => window.__swddTest__.getActiveWidgetCount());
    expect(count).toBe(3);
});

test('CollectionItems: activeWidgets não cresce em segunda execução', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    await page.evaluate(() => window.__swddTest__.runInjector());
    const count = await page.evaluate(() => window.__swddTest__.getActiveWidgetCount());
    expect(count).toBe(3);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 8: renderWidget chamado corretamente
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: renderWidget é chamado para todos os itens válidos', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const renderCount = await page.locator('.swdd-widget-container[data-render-called="true"]').count();
    expect(renderCount).toBe(3);
});

test('CollectionItems: renderWidget recebe o modId correto para item 1', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const renderModId = await page.locator('#sharedfile_1111111111 .swdd-widget-container').getAttribute('data-render-mod-id');
    expect(renderModId).toBe('1111111111');
});

test('CollectionItems: renderWidget recebe o modId correto para item 2', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const renderModId = await page.locator('#sharedfile_2222222222 .swdd-widget-container').getAttribute('data-render-mod-id');
    expect(renderModId).toBe('2222222222');
});

test('CollectionItems: renderWidget recebe o modId correto para item 3', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());
    const renderModId = await page.locator('#sharedfile_3333333333 .swdd-widget-container').getAttribute('data-render-mod-id');
    expect(renderModId).toBe('3333333333');
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 9: Itens adicionados dinamicamente
// ════════════════════════════════════════════════════════════════════════════

test('CollectionItems: novo item adicionado ao DOM é processado na re-execução', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());

    // Adiciona um quarto item dinamicamente após a primeira injeção
    await page.evaluate(() => {
        const newItem = document.createElement('div');
        newItem.id        = 'sharedfile_9999999999';
        newItem.className = 'collectionItem';
        newItem.innerHTML = `
            <div class="subscriptionControls">
                <a id="SubscribeItemBtn9999999999" class="general_btn subscribe">
                    <div class="subscribeIcon"></div>
                </a>
            </div>`;
        document.getElementById('mainContentsCollection').appendChild(newItem);
    });

    await page.evaluate(() => window.__swddTest__.runInjector()); // re-executa

    const totalWidgets = await page.locator('.swdd-widget-container').count();
    expect(totalWidgets).toBe(4); // 3 originais + 1 novo
});

test('CollectionItems: widget do item dinâmico tem data-modid correto', async ({ page }) => {
    await page.evaluate(() => window.__swddTest__.runInjector());

    await page.evaluate(() => {
        const newItem = document.createElement('div');
        newItem.id        = 'sharedfile_9999999999';
        newItem.className = 'collectionItem';
        newItem.innerHTML = `
            <div class="subscriptionControls">
                <a id="SubscribeItemBtn9999999999" class="general_btn subscribe">
                    <div class="subscribeIcon"></div>
                </a>
            </div>`;
        document.getElementById('mainContentsCollection').appendChild(newItem);
    });

    await page.evaluate(() => window.__swddTest__.runInjector());

    const modId = await page.locator('#sharedfile_9999999999 .swdd-widget-container').getAttribute('data-modid');
    expect(modId).toBe('9999999999');
});
