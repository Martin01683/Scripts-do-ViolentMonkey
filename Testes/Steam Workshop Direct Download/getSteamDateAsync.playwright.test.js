/**
 * getSteamDateAsync.playwright.test.js
 *
 * Migração para Playwright dos testes do bugfix do caminho cache-hit de
 * getSteamDateAsync, originalmente executados com Vitest.
 *
 * Os mocks vi.fn() foram substituídos por createMockFn() (exposto via
 * window.__SWDD__), e toda a lógica de teste roda dentro de page.evaluate()
 * no browser real (Chromium). Datas ISO são passadas como parâmetros para
 * evitar interpolação incorreta dentro dos callbacks evaluate.
 *
 * BUG: Quando o cache era gerado na página de lista (isCurrentPage=false),
 * hasTimeMismatch era salvo como false. Na página de detalhe, o early-return
 * do cache pulava parseSteamHTMLDate(), então o mismatch nunca era detectado.
 *
 * FIX: Quando isCurrentPage=true, sempre re-executa parseSteamHTMLDate()
 * mesmo ao usar o cache, e atualiza hasTimeMismatch.
 *
 * Executar: npx playwright test "getSteamDateAsync.playwright.test.js"
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'SWDD.browser.html')}`;

// Datas canónicas (passadas via segundo argumento de page.evaluate)
const API_DATE_ISO  = '2025-11-18T17:38:00.000Z'; // data armazenada no cache
const HTML_DATE_ISO = '2025-11-18T16:38:00.000Z'; // data do HTML (1 h antes → mismatch)
const MOD_ID = '12345';

/** Parâmetros base reutilizados em todos os testes */
const BASE_PARAMS = { modId: MOD_ID, apiDateISO: API_DATE_ISO, htmlDateISO: HTML_DATE_ISO };

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
});


// ════════════════════════════════════════════════════════════════════════════
// 1. REGRESSÃO — comportamento bugado (guard de regressão)
// ════════════════════════════════════════════════════════════════════════════

test.describe('getSteamDateAsync — cache-hit + isCurrentPage bugfix', () => {

    test('BUG-REGRESSION: old code returned cached hasTimeMismatch=false on detail page', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { CACHE_TIME_STEAM_MS, createMockFn } = window.__SWDD__;

            // ── Simula o BUGGY early-return (sem verificação HTML) ──
            // Note: o parâmetro de pageId existe mas é completamente ignorado (esse é o bug)
            function buggyCacheHit(localSteamCache, id) {
                const now    = Date.now();
                const cached = localSteamCache[id];
                if (cached && now < cached.exp) {
                    const dateSteam = new Date(cached.date);
                    dateSteam.isFallback      = cached.isFallback      || false;
                    dateSteam.hasTimeMismatch = cached.hasTimeMismatch || false;
                    // BUG: sem verificação HTML aqui
                    return dateSteam;
                }
                return null;
            }

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };

            const mockParse = createMockFn();
            mockParse.mockReturnValue({ date: new Date(htmlDateISO) });

            const result = buggyCacheHit(localSteamCache, modId); // simula isCurrentPage=true
            return {
                hasTimeMismatch: result.hasTimeMismatch,
                parseCallCount:  mockParse.getCallCount(), // bug: nunca chamado
            };
        }, BASE_PARAMS);

        expect(r.hasTimeMismatch).toBe(false);  // bugado: mismatch NÃO detectado
        expect(r.parseCallCount).toBe(0);        // HTML nunca consultado
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. FIX — mismatch detectado na página de detalhe
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: detects mismatch when cache was built on list page and HTML differs', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const steamDateCache       = {};
            const saveSteamCacheCalled = [];
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
            const result = fn(modId, modId); // isCurrentPage = true

            return {
                isDate:          result instanceof Date,
                hasTimeMismatch: result ? result.hasTimeMismatch : null,
                parseCallCount:  utils.parseSteamHTMLDate.getCallCount(),
            };
        }, BASE_PARAMS);

        expect(r.isDate).toBe(true);
        expect(r.hasTimeMismatch).toBe(true);
        expect(r.parseCallCount).toBe(1);
    });

    test('FIXED: cache entry hasTimeMismatch is updated and saveSteamCache is called once', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const saveSteamCacheCalled = [];
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled });
            fn(modId, modId);

            return {
                cacheHasTimeMismatch: localSteamCache[modId].hasTimeMismatch,
                saveCalled:           saveSteamCacheCalled.length,
            };
        }, BASE_PARAMS);

        expect(r.cacheHasTimeMismatch).toBe(true);
        expect(r.saveCalled).toBe(1);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. FIX — sem falso positivo quando HTML coincide com API
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: no mismatch when HTML date equals cached API date', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const saveSteamCacheCalled = [];
            const utils = { parseSteamHTMLDate: createMockFn() };
            // HTML retorna a mesma data → sem mismatch
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(apiDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled });
            const result = fn(modId, modId);

            return {
                hasTimeMismatch: result ? result.hasTimeMismatch : null,
                saveCalled:      saveSteamCacheCalled.length,
            };
        }, BASE_PARAMS);

        expect(r.hasTimeMismatch).toBe(false);
        expect(r.saveCalled).toBe(0);
    });

    test('FIXED: small difference (<= 5 min) does not trigger mismatch', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const slightlyOff = new Date(new Date(apiDateISO).getTime() + 4 * 60 * 1000); // +4 min

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: slightlyOff });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);
            return result ? result.hasTimeMismatch : null;
        }, BASE_PARAMS);

        expect(r).toBe(false);
    });

    test('FIXED: exactly 5 min difference does not trigger mismatch (boundary)', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const exactly5Min = new Date(new Date(apiDateISO).getTime() + 300000);

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: exactly5Min });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);
            return result ? result.hasTimeMismatch : null;
        }, BASE_PARAMS);

        expect(r).toBe(false); // threshold é ESTRITAMENTE maior que 300 000
    });

    test('FIXED: 5 min + 1 ms does trigger mismatch (boundary + 1)', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const justOver = new Date(new Date(apiDateISO).getTime() + 300001);

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: justOver });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);
            return result ? result.hasTimeMismatch : null;
        }, BASE_PARAMS);

        expect(r).toBe(true);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. FIX — HTML check IGNORADO em páginas de lista
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: does NOT call parseSteamHTMLDate when NOT on detail page', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const saveSteamCacheCalled = [];
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled });
            const result = fn(modId, 'OTHER_ID'); // isCurrentPage = false

            return {
                hasTimeMismatch: result ? result.hasTimeMismatch : null,
                parseCallCount:  utils.parseSteamHTMLDate.getCallCount(),
                saveCalled:      saveSteamCacheCalled.length,
            };
        }, BASE_PARAMS);

        expect(r.hasTimeMismatch).toBe(false); // mantido do cache
        expect(r.parseCallCount).toBe(0);
        expect(r.saveCalled).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. FIX — parseSteamHTMLDate retornando null não lança exceção
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: handles parseSteamHTMLDate returning null gracefully', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const saveSteamCacheCalled = [];
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue(null); // DOM indisponível

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled });
            const result = fn(modId, modId);

            return {
                hasTimeMismatch: result ? result.hasTimeMismatch : null,
                saveCalled:      saveSteamCacheCalled.length,
            };
        }, BASE_PARAMS);

        expect(r.hasTimeMismatch).toBe(false);
        expect(r.saveCalled).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 6. FIX — sentinelas STEAM_NO_DATE / STEAM_FETCH_ERROR não são afetados
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: STEAM_NO_DATE sentinel is returned unchanged (no HTML check)', async ({ page }) => {
        const r = await page.evaluate(({ modId, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS, STEAM_NO_DATE } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            STEAM_NO_DATE,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);

            return {
                resultIsNoDate: result === STEAM_NO_DATE,
                parseCallCount: utils.parseSteamHTMLDate.getCallCount(),
            };
        }, BASE_PARAMS);

        expect(r.resultIsNoDate).toBe(true);
        expect(r.parseCallCount).toBe(0);
    });

    test('FIXED: STEAM_FETCH_ERROR sentinel is returned unchanged (no HTML check)', async ({ page }) => {
        const r = await page.evaluate(({ modId, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS, STEAM_FETCH_ERROR } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            STEAM_FETCH_ERROR,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);

            return {
                resultIsFetchError: result === STEAM_FETCH_ERROR,
                parseCallCount:     utils.parseSteamHTMLDate.getCallCount(),
            };
        }, BASE_PARAMS);

        expect(r.resultIsFetchError).toBe(true);
        expect(r.parseCallCount).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 7. FIX — cache expirado cai para o caminho de API fetch
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: expired cache falls through to API fetch path (returns null)', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() - 1000, // expirado
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache: {}, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);

            return {
                resultIsNull:   result === null,
                parseCallCount: utils.parseSteamHTMLDate.getCallCount(),
            };
        }, BASE_PARAMS);

        expect(r.resultIsNull).toBe(true);   // cache miss → deve buscar na API
        expect(r.parseCallCount).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 8. FIX — steamDateCache é populado corretamente
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: steamDateCache is updated with the corrected date object', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const steamDateCache = {};
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn     = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled: [] });
            const result = fn(modId, modId);

            return {
                cacheEqualsResult:    steamDateCache[modId] === result,
                cacheHasTimeMismatch: steamDateCache[modId] ? steamDateCache[modId].hasTimeMismatch : null,
            };
        }, BASE_PARAMS);

        expect(r.cacheEqualsResult).toBe(true);
        expect(r.cacheHasTimeMismatch).toBe(true);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 9. FIX — segunda chamada reutiliza cache atualizado sem re-salvar
    // ═══════════════════════════════════════════════════════════════════════

    test('FIXED: second call with already-corrected cache does not call saveSteamCache again', async ({ page }) => {
        const r = await page.evaluate(({ modId, apiDateISO, htmlDateISO }) => {
            const { buildFixedCacheHitPath, createMockFn, CACHE_TIME_STEAM_MS } = window.__SWDD__;

            const localSteamCache = {
                [modId]: {
                    date:            apiDateISO,
                    exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
                    isFallback:      false,
                    hasTimeMismatch: false,
                }
            };
            const steamDateCache       = {};
            const saveSteamCacheCalled = [];
            const utils = { parseSteamHTMLDate: createMockFn() };
            utils.parseSteamHTMLDate.mockReturnValue({ date: new Date(htmlDateISO) });

            const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
            fn(modId, modId); // primeira chamada — cache atualizado
            fn(modId, modId); // segunda chamada — hasTimeMismatch já true, não re-salva

            return {
                saveCalled:     saveSteamCacheCalled.length,
                parseCallCount: utils.parseSteamHTMLDate.getCallCount(),
            };
        }, BASE_PARAMS);

        expect(r.saveCalled).toBe(1);     // salvo apenas uma vez
        expect(r.parseCallCount).toBe(2); // HTML ainda verificado em ambas as chamadas
    });
});
