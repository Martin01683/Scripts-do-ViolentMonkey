/**
 * getSteamDateAsync.test.js
 *
 * Unit tests para o bugfix do caminho cache-hit de getSteamDateAsync.
 *
 * BUG: Quando o cache era gerado na página de lista (isCurrentPage=false),
 * hasTimeMismatch era salvo como false. Na página de detalhe, o early-return
 * do cache pulava parseSteamHTMLDate(), então o mismatch nunca era detectado.
 *
 * FIX: Quando isCurrentPage=true, sempre re-executa parseSteamHTMLDate()
 * mesmo ao usar o cache, e atualiza hasTimeMismatch.
 *
 * Usa vi.fn() do Vitest (equivalente ao createMockFn() do browser harness).
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/getSteamDateAsync.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÕES (espelham SWDD.browser.html)
// ════════════════════════════════════════════════════════════════════════════

const STEAM_NO_DATE     = 'NO_DATE';
const STEAM_FETCH_ERROR = 'FETCH_ERROR';
const CACHE_TIME_STEAM_MS = 60 * 60 * 1000;

function buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled }) {
    return function getSteamDateAsync_cacheHitOnly(modId, currentPageId) {
        const now = Date.now();
        if (localSteamCache[modId] && now >= localSteamCache[modId].exp) {
            delete steamDateCache[modId];
        }
        const cached = localSteamCache[modId];
        if (cached && now < cached.exp) {
            let dateSteam = (cached.date === STEAM_NO_DATE || cached.date === STEAM_FETCH_ERROR)
                ? cached.date
                : new Date(cached.date);
            if (dateSteam instanceof Date) {
                dateSteam.isFallback      = cached.isFallback      || false;
                dateSteam.hasTimeMismatch = cached.hasTimeMismatch || false;
                const isCurrentPage = currentPageId === modId;
                if (isCurrentPage) {
                    const htmlDate = utils.parseSteamHTMLDate();
                    const mismatch = !!(htmlDate && Math.abs(htmlDate.date.getTime() - dateSteam.getTime()) > 300000);
                    dateSteam.hasTimeMismatch = mismatch;
                    if (cached.hasTimeMismatch !== mismatch) {
                        cached.hasTimeMismatch = mismatch;
                        saveSteamCacheCalled.push(true);
                    }
                }
            }
            steamDateCache[modId] = dateSteam;
            return dateSteam;
        }
        return null;
    };
}

// ════════════════════════════════════════════════════════════════════════════
// FIXTURES
// ════════════════════════════════════════════════════════════════════════════

const MOD_ID      = '12345';
const API_DATE    = new Date('2025-11-18T17:38:00.000Z');
const HTML_DATE   = new Date('2025-11-18T16:38:00.000Z'); // 1 h antes → mismatch
const SAME_DATE   = new Date(API_DATE);

let localSteamCache, steamDateCache, saveSteamCacheCalled, utils;

function buildCacheEntry(overrides = {}) {
    return {
        date:            API_DATE.toISOString(),
        exp:             Date.now() + CACHE_TIME_STEAM_MS / 2,
        isFallback:      false,
        hasTimeMismatch: false,
        ...overrides,
    };
}

beforeEach(() => {
    localSteamCache      = { [MOD_ID]: buildCacheEntry() };
    steamDateCache       = {};
    saveSteamCacheCalled = [];
    utils                = { parseSteamHTMLDate: vi.fn() };
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

describe('getSteamDateAsync — cache-hit + isCurrentPage bugfix', () => {

    // 1. REGRESSÃO
    test('BUG-REGRESSION: old code returned cached hasTimeMismatch=false on detail page', () => {
        function buggyCacheHit(id) {
            const now = Date.now(), cached = localSteamCache[id];
            if (cached && now < cached.exp) {
                const dateSteam = new Date(cached.date);
                dateSteam.hasTimeMismatch = cached.hasTimeMismatch || false;
                return dateSteam; // BUG: sem check HTML
            }
            return null;
        }
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const result = buggyCacheHit(MOD_ID);
        expect(result.hasTimeMismatch).toBe(false);
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    // 2. FIX — mismatch detectado
    test('FIXED: detects mismatch when cache was built on list page and HTML differs', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);
        expect(result).toBeInstanceOf(Date);
        expect(result.hasTimeMismatch).toBe(true);
        expect(utils.parseSteamHTMLDate).toHaveBeenCalledTimes(1);
    });

    test('FIXED: cache entry hasTimeMismatch is updated and saveSteamCache is called once', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        fn(MOD_ID, MOD_ID);
        expect(localSteamCache[MOD_ID].hasTimeMismatch).toBe(true);
        expect(saveSteamCacheCalled).toHaveLength(1);
    });

    // 3. FIX — sem falso positivo
    test('FIXED: no mismatch when HTML date equals cached API date', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: SAME_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);
        expect(result.hasTimeMismatch).toBe(false);
        expect(saveSteamCacheCalled).toHaveLength(0);
    });

    test('FIXED: small difference (<= 5 min) does not trigger mismatch', () => {
        const slightlyOff = new Date(API_DATE.getTime() + 4 * 60 * 1000);
        utils.parseSteamHTMLDate.mockReturnValue({ date: slightlyOff });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        expect(fn(MOD_ID, MOD_ID).hasTimeMismatch).toBe(false);
    });

    test('FIXED: exactly 5 min difference does not trigger mismatch (boundary)', () => {
        const exactly5Min = new Date(API_DATE.getTime() + 300000);
        utils.parseSteamHTMLDate.mockReturnValue({ date: exactly5Min });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        expect(fn(MOD_ID, MOD_ID).hasTimeMismatch).toBe(false);
    });

    test('FIXED: 5 min + 1 ms does trigger mismatch (boundary + 1)', () => {
        const justOver = new Date(API_DATE.getTime() + 300001);
        utils.parseSteamHTMLDate.mockReturnValue({ date: justOver });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        expect(fn(MOD_ID, MOD_ID).hasTimeMismatch).toBe(true);
    });

    // 4. FIX — HTML check ignorado em páginas de lista
    test('FIXED: does NOT call parseSteamHTMLDate when NOT on detail page', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, 'OTHER_ID');
        expect(result.hasTimeMismatch).toBe(false);
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
        expect(saveSteamCacheCalled).toHaveLength(0);
    });

    // 5. FIX — parseSteamHTMLDate retornando null
    test('FIXED: handles parseSteamHTMLDate returning null gracefully', () => {
        utils.parseSteamHTMLDate.mockReturnValue(null);
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);
        expect(result.hasTimeMismatch).toBe(false);
        expect(saveSteamCacheCalled).toHaveLength(0);
    });

    // 6. FIX — sentinelas
    test('FIXED: STEAM_NO_DATE sentinel is returned unchanged (no HTML check)', () => {
        localSteamCache[MOD_ID] = buildCacheEntry({ date: STEAM_NO_DATE });
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        expect(fn(MOD_ID, MOD_ID)).toBe(STEAM_NO_DATE);
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    test('FIXED: STEAM_FETCH_ERROR sentinel is returned unchanged (no HTML check)', () => {
        localSteamCache[MOD_ID] = buildCacheEntry({ date: STEAM_FETCH_ERROR });
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        expect(fn(MOD_ID, MOD_ID)).toBe(STEAM_FETCH_ERROR);
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    // 7. FIX — cache expirado
    test('FIXED: expired cache falls through to API fetch path (returns null)', () => {
        localSteamCache[MOD_ID] = buildCacheEntry({ exp: Date.now() - 1000 });
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        expect(fn(MOD_ID, MOD_ID)).toBeNull();
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    // 8. FIX — steamDateCache populado
    test('FIXED: steamDateCache is updated with the corrected date object', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);
        expect(steamDateCache[MOD_ID]).toBe(result);
        expect(steamDateCache[MOD_ID].hasTimeMismatch).toBe(true);
    });

    // 9. FIX — segunda chamada não re-salva
    test('FIXED: second call with already-corrected cache does not call saveSteamCache again', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });
        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        fn(MOD_ID, MOD_ID);
        fn(MOD_ID, MOD_ID);
        expect(saveSteamCacheCalled).toHaveLength(1);
        expect(utils.parseSteamHTMLDate).toHaveBeenCalledTimes(2);
    });
});
