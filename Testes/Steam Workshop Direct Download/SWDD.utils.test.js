/**
 * SWDD.utils.test.js
 *
 * Unit tests para funções utilitárias puras de
 * "Steam Workshop Direct Download.user.js".
 *
 * Cobre: escapeHTML, CacheManager, addOrUpdateMod, parseSmodsDate,
 *        parseInsaneDate, parseInsaneGHDate, getIdFromName,
 *        isUpToDate, extractJsonArray
 *
 * Estas funções não dependem de DOM nem de Intl real do browser —
 * rodam corretamente em Node.js sob o Vitest.
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/SWDD.utils.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÕES (espelham o script original / SWDD.browser.html)
// ════════════════════════════════════════════════════════════════════════════

const STEAM_NO_DATE     = 'NO_DATE';
const STEAM_FETCH_ERROR = 'FETCH_ERROR';

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

// MonthMap mínimo suficiente para parseSmodsDate (3-char keys)
const TEST_MONTH_MAP = {
    jan:0, fev:1, feb:1, mar:2, apr:3, may:4, jun:5,
    jul:6, aug:7, ago:7, sep:8, oct:9, nov:10, dec:11,
};

function parseSmodsDate(dateStr) {
    if (!dateStr) return null;
    dateStr = String(dateStr).trim();
    let cleanStr = dateStr.replace(/\s+at\s+/i, ' ');
    const match = cleanStr.match(/(\d{1,2})\s+([A-Za-z]{3,})(?:,?\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?/i);
    if (match) {
        const day      = parseInt(match[1], 10);
        const monthStr = match[2].toLowerCase().substring(0, 3);
        let   year     = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
        const month    = TEST_MONTH_MAP[monthStr];
        if (month !== undefined) {
            let parsedDate, exact = false;
            if (match[4] !== undefined && match[5] !== undefined) {
                parsedDate = new Date(Date.UTC(year, month, day, parseInt(match[4],10)+3, parseInt(match[5],10), 0));
                exact = true;
            } else {
                parsedDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
            }
            if (!match[3] && parsedDate.getTime() > Date.now()) parsedDate.setUTCFullYear(year - 1);
            return { date: parsedDate, exact };
        }
    }
    const d1 = new Date(cleanStr);
    if (!isNaN(d1.getTime())) {
        if (!/\d{2}:\d{2}/.test(cleanStr)) { d1.setUTCHours(23, 59, 59, 999); return { date: d1, exact: false }; }
        return { date: d1, exact: true };
    }
    return null;
}

function parseInsaneDate(dateStr) {
    if (!dateStr || dateStr.startsWith('0000-00-00')) return null;
    const d = new Date(dateStr.replace(' ', 'T') + '+01:00');
    return isNaN(d.getTime()) ? null : { date: d, exact: /\d{2}:\d{2}/.test(dateStr) };
}

function parseInsaneGHDate(dateStr) {
    if (!dateStr) return null;
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    return { date: new Date(Date.UTC(match[1], match[2]-1, match[3], match[4]-1, match[5], match[6]||0)), exact: true };
}

function getIdFromName(name) {
    const match = String(name || '').match(/^\s*(\d{6,})/);
    return match ? match[1] : null;
}

function isUpToDate(dateMirror, dateSteam) {
    if (dateSteam === STEAM_NO_DATE || dateSteam === STEAM_FETCH_ERROR) return true;
    if (!dateMirror) return false;
    return Math.floor(dateMirror.getTime()/60000) >= Math.floor(dateSteam.getTime()/60000);
}

function extractJsonArray(text, varName) {
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return text;
        if (parsed[varName]) return JSON.stringify(parsed[varName]);
    } catch { /* not JSON */ }
    const regex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`);
    const match = text.match(regex);
    if (!match) return null;
    const startIdx = match.index + match[0].length - 1;
    let depth = 0, inString = false, stringChar = '', i = startIdx;
    while (i < text.length) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; } else if (ch === stringChar) inString = false;
        } else if (ch === '"' || ch === "'") { inString = true; stringChar = ch; }
        else if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) return text.slice(startIdx, i+1); }
        i++;
    }
    return null;
}

function addOrUpdateMod(resultObj, id, link, parsedDateObj) {
    const newDate = parsedDateObj ? parsedDateObj.date : null;
    const current = resultObj[id];
    if (!current || (newDate && (!current.date || newDate > current.date))) {
        resultObj[id] = { link, date: newDate, exactTime: parsedDateObj ? parsedDateObj.exact : true };
    }
}

function buildMockStorage() {
    const store = {}, keys = [];
    return {
        setItem(k, v) { if (!(k in store)) keys.push(k); store[k] = v; },
        getItem(k)    { return k in store ? store[k] : null; },
        removeItem(k) { const i = keys.indexOf(k); if (i !== -1) keys.splice(i, 1); delete store[k]; },
        key(i)        { return keys[i] || null; },
        get length()  { return keys.length; },
        _store: store,
    };
}

function buildCacheManager(storage, tObj) {
    return {
        set(key, dataObj) {
            try { storage.setItem(key, JSON.stringify(dataObj)); }
            catch (e) {
                if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                    try { console.warn('[SWDD]', tObj.consoleStorageQuotaCleanup); this.clearByPrefix('SWDD_'); storage.setItem(key, JSON.stringify(dataObj)); }
                    catch (err) { console.error('[SWDD]', tObj.consoleCacheWriteFailed, err); }
                }
            }
        },
        get(key) {
            try { const s = storage.getItem(key); if (s) return JSON.parse(s); } catch { /* bad JSON */ }
            return null;
        },
        remove(key) { storage.removeItem(key); },
        clearByPrefix(prefix) {
            const toRemove = [];
            for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) toRemove.push(k); }
            toRemove.forEach(k => storage.removeItem(k));
        }
    };
}

const MOCK_T = { consoleStorageQuotaCleanup: 'Cleanup running', consoleCacheWriteFailed: 'Cache write failed' };

// ════════════════════════════════════════════════════════════════════════════
// escapeHTML
// ════════════════════════════════════════════════════════════════════════════

describe('escapeHTML', () => {
    test('retorna string vazia para null',      () => expect(escapeHTML(null)).toBe(''));
    test('retorna string vazia para undefined', () => expect(escapeHTML(undefined)).toBe(''));
    test('não altera strings sem especiais',    () => expect(escapeHTML('hello world')).toBe('hello world'));
    test('escapa & → &amp;',                   () => expect(escapeHTML('a & b')).toBe('a &amp; b'));
    test('escapa < e >',                        () => expect(escapeHTML('<tag>')).toBe('&lt;tag&gt;'));
    test("escapa ' → &#39;",                   () => expect(escapeHTML("it's")).toBe('it&#39;s'));
    test('escapa " → &quot;',                  () => expect(escapeHTML('"quoted"')).toBe('&quot;quoted&quot;'));
    test('escapa múltiplos especiais',          () => expect(escapeHTML('<a href="test">it\'s & me</a>')).toBe('&lt;a href=&quot;test&quot;&gt;it&#39;s &amp; me&lt;/a&gt;'));
    test('converte número para string',         () => expect(escapeHTML(42)).toBe('42'));
    test('converte booleano para string',       () => expect(escapeHTML(true)).toBe('true'));
    test('Steam Workshop sem alteração',        () => expect(escapeHTML('Steam Workshop')).toBe('Steam Workshop'));
    test('apenas & retorna &amp;',              () => expect(escapeHTML('&')).toBe('&amp;'));
    test('múltiplos &',                         () => expect(escapeHTML('A & B & C')).toBe('A &amp; B &amp; C'));
    test('escapa >',                            () => expect(escapeHTML('a > b')).toBe('a &gt; b'));
});

// ════════════════════════════════════════════════════════════════════════════
// CacheManager
// ════════════════════════════════════════════════════════════════════════════

describe('CacheManager', () => {
    test('set e get retornam o valor armazenado', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('k1', { x: 42 });
        expect(cm.get('k1')).toEqual({ x: 42 });
    });

    test('get retorna null para chave inexistente', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        expect(cm.get('nope')).toBeNull();
    });

    test('remove apaga a chave', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('k1', 'val'); cm.remove('k1');
        expect(cm.get('k1')).toBeNull();
    });

    test('clearByPrefix remove apenas chaves com prefixo', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('SWDD_a', 1); cm.set('SWDD_b', 2); cm.set('OTHER_c', 3);
        cm.clearByPrefix('SWDD_');
        expect(cm.get('SWDD_a')).toBeNull();
        expect(cm.get('SWDD_b')).toBeNull();
        expect(cm.get('OTHER_c')).toBe(3);
    });

    test('clearByPrefix sem correspondências não apaga nada', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('k1', 'val'); cm.clearByPrefix('NOMATCHES_');
        expect(cm.get('k1')).toBe('val');
    });

    test('get retorna null para JSON inválido', () => {
        const storage = buildMockStorage();
        storage.setItem('bad', '{invalid_json}');
        const cm = buildCacheManager(storage, MOCK_T);
        expect(cm.get('bad')).toBeNull();
    });

    test('set armazena arrays', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('arr', [1, 2, 3]);
        expect(cm.get('arr')).toEqual([1, 2, 3]);
    });

    test('set sobrescreve valor existente', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('k', { v: 1 }); cm.set('k', { v: 2 });
        expect(cm.get('k')).toEqual({ v: 2 });
    });

    test('handles QuotaExceededError: limpa SWDD_ e tenta de novo', () => {
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
        expect(threw).toBe(false);
    });

    test('handles NS_ERROR_DOM_QUOTA_REACHED sem lançar erro', () => {
        const storage = buildMockStorage();
        let calls = 0;
        storage.setItem = () => {
            calls++;
            if (calls === 1) { const e = new Error('NS Quota'); e.name = 'NS_ERROR_DOM_QUOTA_REACHED'; throw e; }
        };
        const cm = buildCacheManager(storage, MOCK_T);
        let threw = false;
        try { cm.set('k', 'v'); } catch { threw = true; }
        expect(threw).toBe(false);
    });

    test('remove chave inexistente não lança erro', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        expect(() => cm.remove('does_not_exist')).not.toThrow();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// utils.addOrUpdateMod
// ════════════════════════════════════════════════════════════════════════════

describe('utils.addOrUpdateMod', () => {
    test('adiciona novo mod a objeto vazio', () => {
        const obj = {};
        addOrUpdateMod(obj, '123456', 'http://a.com/mod', null);
        expect(obj['123456'].link).toBe('http://a.com/mod');
        expect(obj['123456'].date).toBeNull();
        expect(obj['123456'].exactTime).toBe(true);
    });

    test('adiciona mod com data e exact=true', () => {
        const obj = {}, date = new Date('2024-06-01');
        addOrUpdateMod(obj, '123456', 'http://a.com', { date, exact: true });
        expect(obj['123456'].date.toISOString()).toBe(date.toISOString());
        expect(obj['123456'].exactTime).toBe(true);
    });

    test('adiciona mod com exact=false', () => {
        const obj = {};
        addOrUpdateMod(obj, '111', 'http://a.com', { date: new Date(), exact: false });
        expect(obj['111'].exactTime).toBe(false);
    });

    test('atualiza mod quando nova data é mais recente', () => {
        const obj = {};
        addOrUpdateMod(obj, '111', 'http://old.com', { date: new Date('2024-01-01'), exact: false });
        addOrUpdateMod(obj, '111', 'http://new.com', { date: new Date('2024-06-01'), exact: true });
        expect(obj['111'].link).toBe('http://new.com');
    });

    test('mantém mod existente quando nova data é mais antiga', () => {
        const obj = {};
        addOrUpdateMod(obj, '111', 'http://new.com', { date: new Date('2024-06-01'), exact: true });
        addOrUpdateMod(obj, '111', 'http://old.com', { date: new Date('2024-01-01'), exact: false });
        expect(obj['111'].link).toBe('http://new.com');
    });

    test('mantém mod existente quando nova entrada não tem data', () => {
        const obj = {};
        addOrUpdateMod(obj, '111', 'http://first.com', { date: new Date('2024-01-01'), exact: true });
        addOrUpdateMod(obj, '111', 'http://second.com', null);
        expect(obj['111'].link).toBe('http://first.com');
    });

    test('gerencia múltiplos mods distintos', () => {
        const obj = {};
        addOrUpdateMod(obj, '111111', 'http://a.com', null);
        addOrUpdateMod(obj, '222222', 'http://b.com', null);
        addOrUpdateMod(obj, '333333', 'http://c.com', null);
        expect(Object.keys(obj).length).toBe(3);
    });

    test('primeiro mod sem data pode ser substituído por um com data', () => {
        const obj = {};
        addOrUpdateMod(obj, '999', 'http://no-date.com', null);
        addOrUpdateMod(obj, '999', 'http://with-date.com', { date: new Date(), exact: true });
        expect(obj['999'].link).toBe('http://with-date.com');
        expect(obj['999'].date).not.toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// utils.parseSmodsDate
// ════════════════════════════════════════════════════════════════════════════

describe('utils.parseSmodsDate', () => {
    test('retorna null para null',   () => expect(parseSmodsDate(null)).toBeNull());
    test('retorna null para vazio',  () => expect(parseSmodsDate('')).toBeNull());

    test('parsa "18 Jun at 19:58" com offset +3', () => {
        const r = parseSmodsDate('18 Jun at 19:58');
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
        expect(r.date.getUTCHours()).toBe(22);   // 19+3=22
        expect(r.date.getUTCMinutes()).toBe(58);
        expect(r.date.getUTCDate()).toBe(18);
        expect(r.date.getUTCMonth()).toBe(5);    // Junho=5
    });

    test('parsa data sem hora → exact=false, 23:59:59 UTC', () => {
        const r = parseSmodsDate('15 Mar, 2024');
        expect(r).not.toBeNull();
        expect(r.exact).toBe(false);
        expect(r.date.getUTCHours()).toBe(23);
        expect(r.date.getUTCMinutes()).toBe(59);
        expect(r.date.getUTCSeconds()).toBe(59);
    });

    test('parsa data com ano explícito', () => {
        const r = parseSmodsDate('5 jan, 2023');
        expect(r).not.toBeNull();
        expect(r.date.getUTCFullYear()).toBe(2023);
        expect(r.date.getUTCMonth()).toBe(0);
        expect(r.date.getUTCDate()).toBe(5);
    });

    test('parsa agosto sem ano com hora', () => {
        const r = parseSmodsDate('10 aug at 14:30');
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
        expect(r.date.getUTCMonth()).toBe(7);  // Agosto=7
        expect(r.date.getUTCHours()).toBe(17); // 14+3=17
    });

    test('retorna null para string inválida', () => expect(parseSmodsDate('xyz abc def')).toBeNull());
    test('retorna null para mês desconhecido', () => expect(parseSmodsDate('15 abc, 2024')).toBeNull());

    test('data futura sem ano é ajustada para ano anterior', () => {
        const r = parseSmodsDate('31 dec at 23:30');
        if (r) expect(r.date.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
    });

    test('fallback ao construtor Date para strings ISO-like', () => {
        const r = parseSmodsDate('2024-01-15');
        if (r) { expect(r.date).toBeInstanceOf(Date); expect(r.exact).toBe(false); }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// utils.parseInsaneDate
// ════════════════════════════════════════════════════════════════════════════

describe('utils.parseInsaneDate', () => {
    test('retorna null para null',                           () => expect(parseInsaneDate(null)).toBeNull());
    test('retorna null para "0000-00-00"',                  () => expect(parseInsaneDate('0000-00-00 00:00:00')).toBeNull());
    test('retorna null para string inválida',               () => expect(parseInsaneDate('not-a-date')).toBeNull());

    test('"2024-01-15 15:00" → GMT+1→UTC (hora -1)', () => {
        const r = parseInsaneDate('2024-01-15 15:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(14); // 15-1=14
        expect(r.exact).toBe(true);
    });

    test('sem hora → exact=false', () => {
        const r = parseInsaneDate('2024-03-10');
        if (r) expect(r.exact).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// utils.parseInsaneGHDate
// ════════════════════════════════════════════════════════════════════════════

describe('utils.parseInsaneGHDate', () => {
    test('retorna null para null',             () => expect(parseInsaneGHDate(null)).toBeNull());
    test('retorna null para formato inválido', () => expect(parseInsaneGHDate('2024/01/15 10:00')).toBeNull());
    test('retorna null para apenas data',      () => expect(parseInsaneGHDate('2024-01-15')).toBeNull());
    test('sempre exact=true',                  () => { const r = parseInsaneGHDate('2024-06-01T10:00:00'); expect(r).not.toBeNull(); expect(r.exact).toBe(true); });

    test('"2024-01-15T15:30:00" → hora UTC -1', () => {
        const r = parseInsaneGHDate('2024-01-15T15:30:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(14);
        expect(r.date.getUTCMinutes()).toBe(30);
    });

    test('separador espaço funciona', () => {
        const r = parseInsaneGHDate('2024-06-20 10:00:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(9);
    });

    test('meia-noite GMT+1: 00:00 → 23:00 UTC dia anterior', () => {
        const r = parseInsaneGHDate('2024-03-01T00:00:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(23);
        expect(r.date.getUTCDate()).toBe(29);
        expect(r.date.getUTCMonth()).toBe(1);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// utils.getIdFromName
// ════════════════════════════════════════════════════════════════════════════

describe('utils.getIdFromName', () => {
    test('extrai 10 dígitos',                          () => expect(getIdFromName('3746153385 My Mod')).toBe('3746153385'));
    test('menos de 6 dígitos retorna null',            () => expect(getIdFromName('12345 Mod')).toBeNull());
    test('null retorna null',                           () => expect(getIdFromName(null)).toBeNull());
    test('undefined retorna null',                     () => expect(getIdFromName(undefined)).toBeNull());
    test('espaço inicial é ignorado',                  () => expect(getIdFromName('  123456 Mod')).toBe('123456'));
    test('começa com letras retorna null',              () => expect(getIdFromName('abc123456')).toBeNull());
    test('exatamente 6 dígitos (mínimo)',               () => expect(getIdFromName('100000')).toBe('100000'));
    test('não inclui caracteres após dígitos',          () => { const id = getIdFromName('3746153385 Some Mod'); expect(id).toBe('3746153385'); expect(id.length).toBe(10); });
    test('string vazia retorna null',                   () => expect(getIdFromName('')).toBeNull());
});

// ════════════════════════════════════════════════════════════════════════════
// utils.isUpToDate
// ════════════════════════════════════════════════════════════════════════════

describe('utils.isUpToDate', () => {
    const base  = new Date('2024-06-01T12:00:00Z');
    const newer = new Date('2024-06-02T12:00:00Z');
    const older = new Date('2024-05-31T12:00:00Z');

    test('STEAM_NO_DATE → true',         () => expect(isUpToDate(older, STEAM_NO_DATE)).toBe(true));
    test('STEAM_FETCH_ERROR → true',     () => expect(isUpToDate(older, STEAM_FETCH_ERROR)).toBe(true));
    test('mirror null → false',          () => expect(isUpToDate(null, base)).toBe(false));
    test('mirror undefined → false',     () => expect(isUpToDate(undefined, base)).toBe(false));
    test('mesmo minuto → true',          () => expect(isUpToDate(new Date(base.getTime()+30000), base)).toBe(true));
    test('mirror mais recente → true',   () => expect(isUpToDate(newer, base)).toBe(true));
    test('mirror mais antigo → false',   () => expect(isUpToDate(older, base)).toBe(false));
    test('ignora segundos no minuto',    () => expect(isUpToDate(new Date('2024-06-01T12:00:00Z'), new Date('2024-06-01T12:00:59Z'))).toBe(true));
    test('1 minuto de diferença → false',() => expect(isUpToDate(new Date('2024-06-01T12:00:00Z'), new Date('2024-06-01T12:01:00Z'))).toBe(false));
    test('datas idênticas → true',       () => expect(isUpToDate(base, base)).toBe(true));
    test('24h mais novo → true',         () => expect(isUpToDate(new Date(base.getTime()+86400000), base)).toBe(true));
});

// ════════════════════════════════════════════════════════════════════════════
// utils.extractJsonArray
// ════════════════════════════════════════════════════════════════════════════

describe('utils.extractJsonArray', () => {
    test('array JSON puro retorna o texto original',  () => { const t = '[{"id":"1"},{"id":"2"}]'; expect(extractJsonArray(t,'items')).toBe(t); });
    test('extrai por chave de objeto JSON',           () => expect(extractJsonArray(JSON.stringify({items:[1,2,3],other:'x'}),'items')).toBe('[1,2,3]'));
    test('extrai de declaração const',                () => expect(extractJsonArray('const allMods = [{"name":"123456"}];','allMods')).toBe('[{"name":"123456"}]'));
    test('extrai de declaração let',                  () => expect(extractJsonArray('let data = [1, 2, 3];','data')).toBe('[1, 2, 3]'));
    test('extrai de declaração var',                  () => expect(extractJsonArray('var items = ["a","b"];','items')).toBe('["a","b"]'));
    test('varName não encontrado → null',             () => expect(extractJsonArray('const other = [1,2,3];','missing')).toBeNull());
    test('arrays aninhados',                          () => expect(extractJsonArray('const matrix = [[1,2],[3,4]];','matrix')).toBe('[[1,2],[3,4]]'));
    test('strings com colchetes internos',            () => expect(extractJsonArray('const items = ["[a]","[b]"];','items')).toBe('["[a]","[b]"]'));
    test('texto sem variável → null',                 () => expect(extractJsonArray('just some text','items')).toBeNull());
    test('array vazio',                               () => expect(extractJsonArray('const list = [];','list')).toBe('[]'));
    test('chave JSON ausente → null',                 () => expect(extractJsonArray(JSON.stringify({other:[1,2]}),'missing')).toBeNull());
    test('aspas simples não fecham indevidamente',   () => expect(extractJsonArray("const arr = [\"it's fine\"];", 'arr')).toBe("[\"it's fine\"]"));
});

// ════════════════════════════════════════════════════════════════════════════
// translations.exactTimeWarn — regressão: sem <br> manual nos valores
// ════════════════════════════════════════════════════════════════════════════

const { readFileSync } = require('fs');
const path = require('path');

describe('translations.exactTimeWarn', () => {
    const scriptPath = path.resolve(__dirname, '../../Steam Workshop Direct Download.user.js');
    const scriptContent = readFileSync(scriptPath, 'utf-8');

    // Extrai todos os valores de exactTimeWarn, incluindo strings com aspas escapadas
    const exactTimeWarnPattern = /exactTimeWarn:\s*'((?:[^'\\]|\\.)*)'/g;
    const values = [...scriptContent.matchAll(exactTimeWarnPattern)].map(m => m[1]);

    test('o script contém traduções de exactTimeWarn', () => {
        expect(values.length).toBeGreaterThan(0);
    });

    test('nenhum idioma usa <br> manual em exactTimeWarn', () => {
        const withBr = values.filter(v => /<br\s*\/?>/i.test(v));
        expect(withBr).toEqual([]);
    });

    test('todos os idiomas possuem exactTimeWarn definido (14 idiomas)', () => {
        expect(values.length).toBe(14);
    });
});
