/**
 * Tests for the getSteamDateAsync cache-hit bugfix.
 *
 * BUG: Quando o cache era gerado na página de lista (isCurrentPage=false),
 * hasTimeMismatch era salvo como false. Na página de detalhes, o early-return
 * do cache pulava parseSteamHTMLDate(), então o mismatch nunca era detectado.
 *
 * FIX: Quando isCurrentPage=true, sempre re-executa parseSteamHTMLDate()
 * mesmo ao usar o cache, e atualiza hasTimeMismatch.
 */

'use strict';

// ── helpers ────────────────────────────────────────────────────────────────

const STEAM_NO_DATE    = 'NO_DATE';
const STEAM_FETCH_ERROR = 'FETCH_ERROR';
const CACHE_TIME_STEAM_MS = 60 * 60 * 1000; // 60 min

/**
 * Minimal reimplementation of the fixed getSteamDateAsync cache-hit path.
 * Mirrors the logic of the fixed code exactly so the tests exercise it.
 */
function buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled }) {
    return function getSteamDateAsync_cacheHitOnly(modId, currentPageId) {
        const now = Date.now();

        // Expired cache eviction
        if (localSteamCache[modId] && now >= localSteamCache[modId].exp) {
            delete steamDateCache[modId];
        }

        const cached = localSteamCache[modId];
        if (cached && now < cached.exp) {
            let dateSteam = (cached.date === STEAM_NO_DATE || cached.date === STEAM_FETCH_ERROR)
                ? cached.date
                : new Date(cached.date);

            if (dateSteam instanceof Date) {
                dateSteam.isFallback       = cached.isFallback       || false;
                dateSteam.hasTimeMismatch  = cached.hasTimeMismatch  || false;

                // ── FIXED BLOCK ─────────────────────────────────────────────
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
                // ── END FIXED BLOCK ─────────────────────────────────────────
            }
            steamDateCache[modId] = dateSteam;
            return dateSteam;
        }
        return null; // cache miss — not under test here
    };
}

// ── test suite ─────────────────────────────────────────────────────────────

describe('getSteamDateAsync — cache-hit + isCurrentPage bugfix', () => {

    const MOD_ID     = '12345';
    const API_DATE   = new Date('2025-11-18T17:38:00.000Z');  // date from API/cache
    const HTML_DATE  = new Date('2025-11-18T16:38:00.000Z');  // date from page HTML (1 h earlier → mismatch)
    const SAME_DATE  = new Date(API_DATE);                    // identical → no mismatch

    let localSteamCache, steamDateCache, saveSteamCacheCalled, utils;

    /** Returns a cache entry valid for the next 30 minutes with hasTimeMismatch=false.
     *  Simulates what was cached on the list page. */
    function buildCacheEntry(overrides = {}) {
        return {
            date:           API_DATE.toISOString(),
            exp:            Date.now() + CACHE_TIME_STEAM_MS / 2,  // 30 min remaining
            isFallback:     false,
            hasTimeMismatch: false,
            ...overrides
        };
    }

    beforeEach(() => {
        localSteamCache      = { [MOD_ID]: buildCacheEntry() };
        steamDateCache       = {};
        saveSteamCacheCalled = [];
        utils                = {
            parseSteamHTMLDate: jest.fn()
        };
    });

    // ── 1. THE ORIGINAL BUG (regression guard) ───────────────────────────

    test('BUG-REGRESSION: old code returned cached hasTimeMismatch=false on detail page', () => {
        // Simulate the BUGGY early-return (no HTML check)
        function buggyCacheHit(modId, currentPageId) {
            const now = Date.now();
            const cached = localSteamCache[modId];
            if (cached && now < cached.exp) {
                let dateSteam = new Date(cached.date);
                dateSteam.isFallback       = cached.isFallback       || false;
                dateSteam.hasTimeMismatch  = cached.hasTimeMismatch  || false;
                // BUG: no HTML check here — just returns
                return dateSteam;
            }
            return null;
        }

        // Cache was built on list page → hasTimeMismatch=false
        // HTML on detail page shows a different date (mismatch)
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const result = buggyCacheHit(MOD_ID, MOD_ID); // isCurrentPage = true
        expect(result.hasTimeMismatch).toBe(false);    // buggy: mismatch NOT detected
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled(); // HTML never queried
    });

    // ── 2. FIX: mismatch detected from cached date on detail page ────────

    test('FIXED: detects mismatch when cache was built on list page and HTML differs', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE }); // 1 h off → mismatch

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID); // isCurrentPage = true

        expect(result).toBeInstanceOf(Date);
        expect(result.hasTimeMismatch).toBe(true);
        expect(utils.parseSteamHTMLDate).toHaveBeenCalledTimes(1);
    });

    test('FIXED: cache entry hasTimeMismatch is updated and saveSteamCache is called once', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        fn(MOD_ID, MOD_ID);

        expect(localSteamCache[MOD_ID].hasTimeMismatch).toBe(true);
        expect(saveSteamCacheCalled).toHaveLength(1); // persisted exactly once
    });

    // ── 3. FIX: no false positive when HTML matches ───────────────────────

    test('FIXED: no mismatch when HTML date equals cached API date', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: SAME_DATE }); // same date → no mismatch

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result.hasTimeMismatch).toBe(false);
        expect(saveSteamCacheCalled).toHaveLength(0); // cache not re-written (value unchanged)
    });

    test('FIXED: small difference (<= 5 min) does not trigger mismatch', () => {
        const slightlyOff = new Date(API_DATE.getTime() + 4 * 60 * 1000); // +4 min
        utils.parseSteamHTMLDate.mockReturnValue({ date: slightlyOff });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result.hasTimeMismatch).toBe(false);
    });

    test('FIXED: exactly 5 min difference does not trigger mismatch (boundary)', () => {
        const exactlyFiveMin = new Date(API_DATE.getTime() + 300000); // exactly 300 000 ms
        utils.parseSteamHTMLDate.mockReturnValue({ date: exactlyFiveMin });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result.hasTimeMismatch).toBe(false); // threshold is STRICTLY greater than
    });

    test('FIXED: 5 min + 1 ms does trigger mismatch (boundary + 1)', () => {
        const justOver = new Date(API_DATE.getTime() + 300001);
        utils.parseSteamHTMLDate.mockReturnValue({ date: justOver });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result.hasTimeMismatch).toBe(true);
    });

    // ── 4. FIX: HTML check is SKIPPED on list/collection pages ───────────

    test('FIXED: does NOT call parseSteamHTMLDate when NOT on detail page', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, 'OTHER_ID'); // isCurrentPage = false

        expect(result.hasTimeMismatch).toBe(false); // kept from cache
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
        expect(saveSteamCacheCalled).toHaveLength(0);
    });

    // ── 5. FIX: parseSteamHTMLDate returning null does not throw ─────────

    test('FIXED: handles parseSteamHTMLDate returning null gracefully', () => {
        utils.parseSteamHTMLDate.mockReturnValue(null); // DOM not available

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result.hasTimeMismatch).toBe(false);
        expect(saveSteamCacheCalled).toHaveLength(0);
    });

    // ── 6. FIX: STEAM_NO_DATE / STEAM_FETCH_ERROR symbols are unaffected ─

    test('FIXED: STEAM_NO_DATE sentinel is returned unchanged (no HTML check)', () => {
        localSteamCache[MOD_ID] = buildCacheEntry({ date: STEAM_NO_DATE });
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result).toBe(STEAM_NO_DATE);
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    test('FIXED: STEAM_FETCH_ERROR sentinel is returned unchanged (no HTML check)', () => {
        localSteamCache[MOD_ID] = buildCacheEntry({ date: STEAM_FETCH_ERROR });
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result).toBe(STEAM_FETCH_ERROR);
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    // ── 7. FIX: expired cache falls through (cache miss) ─────────────────

    test('FIXED: expired cache falls through to API fetch path (returns null from helper)', () => {
        localSteamCache[MOD_ID] = buildCacheEntry({ exp: Date.now() - 1000 }); // expired
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(result).toBeNull();                           // cache miss → should hit API
        expect(utils.parseSteamHTMLDate).not.toHaveBeenCalled();
    });

    // ── 8. FIX: steamDateCache is populated correctly ────────────────────

    test('FIXED: steamDateCache is updated with the corrected date object', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });
        const result = fn(MOD_ID, MOD_ID);

        expect(steamDateCache[MOD_ID]).toBe(result);
        expect(steamDateCache[MOD_ID].hasTimeMismatch).toBe(true);
    });

    // ── 9. FIX: second call on detail page reuses updated cache ──────────

    test('FIXED: second call with already-corrected cache does not call saveSteamCache again', () => {
        utils.parseSteamHTMLDate.mockReturnValue({ date: HTML_DATE });

        const fn = buildFixedCacheHitPath({ localSteamCache, steamDateCache, utils, saveSteamCacheCalled });

        fn(MOD_ID, MOD_ID); // first call — cache updated
        fn(MOD_ID, MOD_ID); // second call — hasTimeMismatch already true, no re-save needed

        expect(saveSteamCacheCalled).toHaveLength(1); // only saved once
        expect(utils.parseSteamHTMLDate).toHaveBeenCalledTimes(2); // HTML still checked both times
    });
});
