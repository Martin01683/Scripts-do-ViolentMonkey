/**
 * SWDD.utils.test.js
 *
 * Unit tests for the pure utility functions extracted from
 * "Steam Workshop Direct Download.user.js".
 *
 * Cobre: escapeHTML, CacheManager, utils.addOrUpdateMod,
 *        utils.parseSmodsDate, utils.parseInsaneDate,
 *        utils.parseInsaneGHDate, utils.getIdFromName,
 *        utils.isUpToDate, utils.extractJsonArray
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/SWDD.utils.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTES (espelham o script original)
// ════════════════════════════════════════════════════════════════════════════

const STEAM_NO_DATE    = 'NO_DATE';
const STEAM_FETCH_ERROR = 'FETCH_ERROR';

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES EXTRAÍDAS (re-implementadas para teste isolado em Node.js)
// ════════════════════════════════════════════════════════════════════════════

// ── escapeHTML ────────────────────────────────────────────────────────────────
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

// ── MonthMap mínimo (dependência de parseSmodsDate) ───────────────────────────
const TEST_MONTH_MAP = {
    jan:0, january:0, janeiro:0, enero:0, janvier:0, januar:0, januari:0,
    feb:1, february:1, fevereiro:1, febrero:1, février:1, febbraio:1,
    mar:2, march:2, março:2, mars:2, mars2:2,
    apr:3, april:3, abril:3, avril:3, aprile:3,
    may:4, maio:4, mayo:4, mai:4, maggio:4,
    jun:5, june:5, junho:5, junio:5, juin:5,
    jul:6, july:6, julho:6, julio:6, juillet:6,
    aug:7, august:7, agosto:7, août:7,
    sep:8, september:8, setembro:8, septiembre:8,
    oct:9, october:9, outubro:9, octubre:9,
    nov:10, november:10, novembro:10, noviembre:10,
    dec:11, december:11, dezembro:11, diciembre:11,
};

// ── CacheManager ──────────────────────────────────────────────────────────────
function buildCacheManager(storage, tObj) {
    return {
        set(key, dataObj) {
            try {
                storage.setItem(key, JSON.stringify(dataObj));
            } catch(e) {
                if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                    try {
                        console.warn('[SWDD]', tObj.consoleStorageQuotaCleanup);
                        this.clearByPrefix('SWDD_');
                        storage.setItem(key, JSON.stringify(dataObj));
                    } catch(err) {
                        console.error('[SWDD]', tObj.consoleCacheWriteFailed, err);
                    }
                }
            }
        },
        get(key) {
            try {
                const stored = storage.getItem(key);
                if (stored) return JSON.parse(stored);
            } catch(e) { /* invalid JSON */ }
            return null;
        },
        remove(key) { storage.removeItem(key); },
        clearByPrefix(prefix) {
            const keysToRemove = [];
            for (let i = 0; i < storage.length; i++) {
                const k = storage.key(i);
                if (k && k.startsWith(prefix)) keysToRemove.push(k);
            }
            keysToRemove.forEach(k => storage.removeItem(k));
        }
    };
}

/** Cria um localStorage em memória para testes */
function buildMockStorage() {
    const store = {};
    const keys = [];
    return {
        setItem(k, v) { if (!(k in store)) keys.push(k); store[k] = v; },
        getItem(k) { return k in store ? store[k] : null; },
        removeItem(k) { const i = keys.indexOf(k); if (i !== -1) keys.splice(i, 1); delete store[k]; },
        key(i) { return keys[i] || null; },
        get length() { return keys.length; },
        _store: store,
    };
}

const MOCK_T = {
    consoleStorageQuotaCleanup: 'Cleanup running',
    consoleCacheWriteFailed: 'Cache write failed',
};

// ── utils.addOrUpdateMod ──────────────────────────────────────────────────────
function addOrUpdateMod(resultObj, id, link, parsedDateObj) {
    const newDate = parsedDateObj ? parsedDateObj.date : null;
    const currentData = resultObj[id];
    if (!currentData || (newDate && (!currentData.date || newDate > currentData.date))) {
        resultObj[id] = {
            link: link,
            date: newDate,
            exactTime: parsedDateObj ? parsedDateObj.exact : true
        };
    }
}

// ── utils.parseSmodsDate ──────────────────────────────────────────────────────
function parseSmodsDate(dateStr, monthMap) {
    if (!dateStr) return null;
    dateStr = String(dateStr).trim();

    let cleanStr = dateStr.replace(/\s+at\s+/i, ' ');
    const match = cleanStr.match(/(\d{1,2})\s+([A-Za-z]{3,})(?:,?\s+(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?/i);

    if (match) {
        const day = parseInt(match[1], 10);
        const monthStr = match[2].toLowerCase().substring(0, 3);
        let year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
        const month = monthMap[monthStr];

        if (month !== undefined) {
            let parsedDate;
            let exact = false;
            if (match[4] !== undefined && match[5] !== undefined) {
                const hours = parseInt(match[4], 10);
                const minutes = parseInt(match[5], 10);
                // INTENCIONAL: +3 converte UTC-3 (Skymods) → UTC
                parsedDate = new Date(Date.UTC(year, month, day, hours + 3, minutes, 0));
                exact = true;
            } else {
                parsedDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
            }
            if (!match[3] && parsedDate.getTime() > Date.now()) {
                parsedDate.setUTCFullYear(year - 1);
            }
            return { date: parsedDate, exact };
        }
    }

    const d1 = new Date(cleanStr);
    if (!isNaN(d1.getTime())) {
        if (!/\d{2}:\d{2}/.test(cleanStr)) {
            d1.setUTCHours(23, 59, 59, 999);
            return { date: d1, exact: false };
        }
        return { date: d1, exact: true };
    }
    return null;
}

// ── utils.parseInsaneDate ─────────────────────────────────────────────────────
function parseInsaneDate(dateStr) {
    if (!dateStr || dateStr.startsWith('0000-00-00')) return null;
    // INTENCIONAL: '+01:00' declara GMT+1 → JS converte para UTC
    const d = new Date(dateStr.replace(' ', 'T') + '+01:00');
    return isNaN(d.getTime()) ? null : { date: d, exact: /\d{2}:\d{2}/.test(dateStr) };
}

// ── utils.parseInsaneGHDate ───────────────────────────────────────────────────
function parseInsaneGHDate(dateStr) {
    if (!dateStr) return null;
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    // INTENCIONAL: match[4] - 1 converte GMT+1 → UTC
    return {
        date: new Date(Date.UTC(match[1], match[2] - 1, match[3], match[4] - 1, match[5], match[6] || 0)),
        exact: true
    };
}

// ── utils.getIdFromName ───────────────────────────────────────────────────────
function getIdFromName(name) {
    const match = String(name || '').match(/^\s*(\d{6,})/);
    return match ? match[1] : null;
}

// ── utils.isUpToDate ──────────────────────────────────────────────────────────
function isUpToDate(dateMirror, dateSteam) {
    if (dateSteam === STEAM_NO_DATE || dateSteam === STEAM_FETCH_ERROR) return true;
    if (!dateMirror) return false;
    const minMirror = Math.floor(dateMirror.getTime() / 60000);
    const minSteam  = Math.floor(dateSteam.getTime()  / 60000);
    return minMirror >= minSteam;
}

// ── utils.extractJsonArray ────────────────────────────────────────────────────
function extractJsonArray(text, varName) {
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return text;
        if (parsed[varName]) return JSON.stringify(parsed[varName]);
    } catch (e) { /* not valid JSON */ }

    const regex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`);
    const match = text.match(regex);
    if (!match) return null;

    const startIdx = match.index + match[0].length - 1;
    let depth = 0, inString = false, stringChar = '';

    for (let i = startIdx; i < text.length; i++) {
        const char = text[i];
        if (!inString && (char === '"' || char === "'")) {
            inString = true; stringChar = char;
        } else if (inString && char === stringChar && text[i - 1] !== '\\') {
            inString = false;
        } else if (!inString) {
            if (char === '[') depth++;
            else if (char === ']') {
                depth--;
                if (depth === 0) return text.substring(startIdx, i + 1);
            }
        }
    }
    return null;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

// ── escapeHTML ────────────────────────────────────────────────────────────────

describe('escapeHTML', () => {
    test('retorna string vazia para null', () => {
        expect(escapeHTML(null)).toBe('');
    });

    test('retorna string vazia para undefined', () => {
        expect(escapeHTML(undefined)).toBe('');
    });

    test('não altera strings sem caracteres especiais', () => {
        expect(escapeHTML('hello world')).toBe('hello world');
    });

    test('escapa & → &amp;', () => {
        expect(escapeHTML('a & b')).toBe('a &amp; b');
    });

    test('escapa < → &lt;', () => {
        expect(escapeHTML('<tag>')).toBe('&lt;tag&gt;');
    });

    test('escapa > → &gt;', () => {
        expect(escapeHTML('a > b')).toBe('a &gt; b');
    });

    test("escapa ' → &#39;", () => {
        expect(escapeHTML("it's")).toBe('it&#39;s');
    });

    test('escapa " → &quot;', () => {
        expect(escapeHTML('"quoted"')).toBe('&quot;quoted&quot;');
    });

    test('escapa múltiplos caracteres especiais na mesma string', () => {
        expect(escapeHTML('<a href="test">it\'s & me</a>')).toBe(
            '&lt;a href=&quot;test&quot;&gt;it&#39;s &amp; me&lt;/a&gt;'
        );
    });

    test('converte número para string antes de escapar', () => {
        expect(escapeHTML(42)).toBe('42');
    });

    test('converte booleano para string', () => {
        expect(escapeHTML(true)).toBe('true');
    });

    test('string sem caracteres especiais retorna igual', () => {
        expect(escapeHTML('Steam Workshop')).toBe('Steam Workshop');
    });

    test('string com apenas & retorna &amp;', () => {
        expect(escapeHTML('&')).toBe('&amp;');
    });

    test('escapa múltiplos & na mesma string', () => {
        expect(escapeHTML('A & B & C')).toBe('A &amp; B &amp; C');
    });
});

// ── CacheManager ──────────────────────────────────────────────────────────────

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
        cm.set('k1', 'val');
        cm.remove('k1');
        expect(cm.get('k1')).toBeNull();
    });

    test('clearByPrefix remove apenas chaves com o prefixo dado', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('SWDD_a', 1);
        cm.set('SWDD_b', 2);
        cm.set('OTHER_c', 3);
        cm.clearByPrefix('SWDD_');
        expect(cm.get('SWDD_a')).toBeNull();
        expect(cm.get('SWDD_b')).toBeNull();
        expect(cm.get('OTHER_c')).toBe(3);
    });

    test('clearByPrefix sem correspondências não apaga nada', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('k1', 'val');
        cm.clearByPrefix('NOMATCHES_');
        expect(cm.get('k1')).toBe('val');
    });

    test('get retorna null para JSON inválido', () => {
        const storage = buildMockStorage();
        storage.setItem('bad', '{invalid_json}');
        const cm = buildCacheManager(storage, MOCK_T);
        expect(cm.get('bad')).toBeNull();
    });

    test('set armazena objetos complexos (arrays)', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('arr', [1, 2, 3]);
        expect(cm.get('arr')).toEqual([1, 2, 3]);
    });

    test('set sobrescreve valor existente', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        cm.set('k', { v: 1 });
        cm.set('k', { v: 2 });
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
        expect(() => cm.set('SWDD_new', { x: 1 })).not.toThrow();
    });

    test('handles NS_ERROR_DOM_QUOTA_REACHED sem lançar erro', () => {
        const storage = buildMockStorage();
        let calls = 0;
        storage.setItem = () => {
            calls++;
            if (calls === 1) { const e = new Error('NS Quota'); e.name = 'NS_ERROR_DOM_QUOTA_REACHED'; throw e; }
        };
        const cm = buildCacheManager(storage, MOCK_T);
        expect(() => cm.set('k', 'v')).not.toThrow();
    });

    test('remove chave inexistente não lança erro', () => {
        const cm = buildCacheManager(buildMockStorage(), MOCK_T);
        expect(() => cm.remove('does_not_exist')).not.toThrow();
    });
});

// ── utils.addOrUpdateMod ──────────────────────────────────────────────────────

describe('utils.addOrUpdateMod', () => {
    test('adiciona novo mod a objeto vazio', () => {
        const result = {};
        addOrUpdateMod(result, '123456', 'http://a.com/mod', null);
        expect(result['123456']).toEqual({ link: 'http://a.com/mod', date: null, exactTime: true });
    });

    test('adiciona mod com data e exact=true', () => {
        const result = {};
        const date = new Date('2024-06-01');
        addOrUpdateMod(result, '123456', 'http://a.com', { date, exact: true });
        expect(result['123456'].date).toBe(date);
        expect(result['123456'].exactTime).toBe(true);
    });

    test('adiciona mod com exact=false', () => {
        const result = {};
        addOrUpdateMod(result, '111', 'http://a.com', { date: new Date(), exact: false });
        expect(result['111'].exactTime).toBe(false);
    });

    test('atualiza mod quando nova data é mais recente', () => {
        const result = {};
        const old = new Date('2024-01-01');
        const newer = new Date('2024-06-01');
        addOrUpdateMod(result, '111', 'http://old.com', { date: old, exact: false });
        addOrUpdateMod(result, '111', 'http://new.com', { date: newer, exact: true });
        expect(result['111'].link).toBe('http://new.com');
        expect(result['111'].date).toBe(newer);
    });

    test('mantém mod existente quando nova data é mais antiga', () => {
        const result = {};
        const newer = new Date('2024-06-01');
        const old   = new Date('2024-01-01');
        addOrUpdateMod(result, '111', 'http://new.com', { date: newer, exact: true });
        addOrUpdateMod(result, '111', 'http://old.com', { date: old, exact: false });
        expect(result['111'].link).toBe('http://new.com');
    });

    test('mantém mod existente quando nova entrada não tem data', () => {
        const result = {};
        const date = new Date('2024-01-01');
        addOrUpdateMod(result, '111', 'http://first.com', { date, exact: true });
        addOrUpdateMod(result, '111', 'http://second.com', null);
        expect(result['111'].link).toBe('http://first.com');
    });

    test('gerencia múltiplos mods distintos', () => {
        const result = {};
        addOrUpdateMod(result, '111111', 'http://a.com', null);
        addOrUpdateMod(result, '222222', 'http://b.com', null);
        addOrUpdateMod(result, '333333', 'http://c.com', null);
        expect(Object.keys(result)).toHaveLength(3);
    });

    test('primeiro mod sem data pode ser substituído por um com data', () => {
        const result = {};
        addOrUpdateMod(result, '999', 'http://no-date.com', null);
        const date = new Date();
        addOrUpdateMod(result, '999', 'http://with-date.com', { date, exact: true });
        expect(result['999'].link).toBe('http://with-date.com');
        expect(result['999'].date).toBe(date);
    });
});

// ── utils.parseSmodsDate ──────────────────────────────────────────────────────

describe('utils.parseSmodsDate', () => {
    const MM = TEST_MONTH_MAP;

    test('retorna null para null', () => {
        expect(parseSmodsDate(null, MM)).toBeNull();
    });

    test('retorna null para string vazia', () => {
        expect(parseSmodsDate('', MM)).toBeNull();
    });

    test('parsa "18 Jun at 19:58" aplicando offset UTC-3→UTC (+3)', () => {
        const r = parseSmodsDate('18 Jun at 19:58', MM);
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
        expect(r.date.getUTCHours()).toBe(22);   // 19+3=22
        expect(r.date.getUTCMinutes()).toBe(58);
        expect(r.date.getUTCDate()).toBe(18);
        expect(r.date.getUTCMonth()).toBe(5);    // Junho=5
    });

    test('parsa data sem hora (padrão 23:59:59 UTC)', () => {
        const r = parseSmodsDate('15 Mar, 2024', MM);
        expect(r).not.toBeNull();
        expect(r.exact).toBe(false);
        expect(r.date.getUTCHours()).toBe(23);
        expect(r.date.getUTCMinutes()).toBe(59);
        expect(r.date.getUTCSeconds()).toBe(59);
    });

    test('parsa data com ano explícito', () => {
        const r = parseSmodsDate('5 jan, 2023', MM);
        expect(r).not.toBeNull();
        expect(r.date.getUTCFullYear()).toBe(2023);
        expect(r.date.getUTCMonth()).toBe(0);    // Janeiro=0
        expect(r.date.getUTCDate()).toBe(5);
    });

    test('parsa agosto sem ano', () => {
        const r = parseSmodsDate('10 aug at 14:30', MM);
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
        expect(r.date.getUTCMonth()).toBe(7);    // Agosto=7
        // 14+3=17 UTC
        expect(r.date.getUTCHours()).toBe(17);
    });

    test('parsa dezembro com ano e hora', () => {
        const r = parseSmodsDate('25 dec, 2023 at 10:00', MM);
        expect(r).not.toBeNull();
        expect(r.date.getUTCFullYear()).toBe(2023);
        expect(r.date.getUTCMonth()).toBe(11);   // Dezembro=11
        expect(r.date.getUTCDate()).toBe(25);
        expect(r.date.getUTCHours()).toBe(13);   // 10+3=13
    });

    test('retorna null para string completamente inválida', () => {
        expect(parseSmodsDate('xyz abc def', MM)).toBeNull();
    });

    test('retorna null para mês desconhecido', () => {
        // "abc" não está no monthMap
        expect(parseSmodsDate('15 abc, 2024', MM)).toBeNull();
    });

    test('data futura sem ano é ajustada para ano anterior', () => {
        // "31 dec" sem ano: se cair no futuro, o script ajusta para ano-1
        const r = parseSmodsDate('31 dec at 23:30', MM);
        if (r) {
            // A data nunca deve ser mais de 1 minuto no futuro
            expect(r.date.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
        }
    });

    test('fallback ao construtor Date nativo para strings ISO-like', () => {
        // "2024-01-15" é parsada pelo fallback (sem match do regex principal)
        const r = parseSmodsDate('2024-01-15', MM);
        // Pode ser null ou Date dependendo da implementação nativa — a função tenta
        // A string "2024-01-15" não tem "N mes" então vai para o fallback Date()
        if (r) {
            expect(r.date instanceof Date).toBe(true);
            // Sem HH:MM → exact=false
            expect(r.exact).toBe(false);
        }
    });

    test('fallback com data+hora retorna exact=true', () => {
        const r = parseSmodsDate('2024-06-01 10:30', MM);
        if (r) {
            expect(r.exact).toBe(true);
        }
    });
});

// ── utils.parseInsaneDate ─────────────────────────────────────────────────────

describe('utils.parseInsaneDate', () => {
    test('retorna null para null', () => {
        expect(parseInsaneDate(null)).toBeNull();
    });

    test('retorna null para string vazia', () => {
        expect(parseInsaneDate('')).toBeNull();
    });

    test('retorna null para "0000-00-00"', () => {
        expect(parseInsaneDate('0000-00-00')).toBeNull();
    });

    test('retorna null para "0000-00-00 00:00:00"', () => {
        expect(parseInsaneDate('0000-00-00 00:00:00')).toBeNull();
    });

    test('parsa "2024-01-15 15:00" com offset GMT+1 → UTC', () => {
        const r = parseInsaneDate('2024-01-15 15:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(14);   // 15-1=14
        expect(r.date.getUTCDate()).toBe(15);
        expect(r.date.getUTCMonth()).toBe(0);
        expect(r.exact).toBe(true);
    });

    test('parsa "2024-06-20T10:30" (formato ISO com T)', () => {
        const r = parseInsaneDate('2024-06-20T10:30');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(9);    // 10-1=9
        expect(r.exact).toBe(true);
    });

    test('exact=false quando sem componente de hora (apenas data)', () => {
        const r = parseInsaneDate('2024-03-10');
        if (r) {
            expect(r.exact).toBe(false);
        }
    });

    test('retorna null para string inválida', () => {
        expect(parseInsaneDate('not-a-date')).toBeNull();
    });

    test('parsa meia-noite: 00:00 GMT+1 → 23:00 UTC dia anterior', () => {
        const r = parseInsaneDate('2024-03-01 00:00');
        expect(r).not.toBeNull();
        // 00:00 GMT+1 = 23:00 UTC de 2024-02-29 (ano bissexto)
        expect(r.date.getUTCHours()).toBe(23);
        expect(r.date.getUTCDate()).toBe(29);
        expect(r.date.getUTCMonth()).toBe(1);    // Fevereiro=1
    });

    test('parsa data no final do ano', () => {
        const r = parseInsaneDate('2023-12-31 22:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(21);   // 22-1=21
        expect(r.date.getUTCDate()).toBe(31);
        expect(r.date.getUTCMonth()).toBe(11);
    });
});

// ── utils.parseInsaneGHDate ───────────────────────────────────────────────────

describe('utils.parseInsaneGHDate', () => {
    test('retorna null para null', () => {
        expect(parseInsaneGHDate(null)).toBeNull();
    });

    test('retorna null para string vazia', () => {
        expect(parseInsaneGHDate('')).toBeNull();
    });

    test('parsa "2024-01-15T15:30:00" com GMT+1→UTC', () => {
        const r = parseInsaneGHDate('2024-01-15T15:30:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(14);   // 15-1=14
        expect(r.date.getUTCMinutes()).toBe(30);
        expect(r.date.getUTCDate()).toBe(15);
        expect(r.date.getUTCMonth()).toBe(0);
        expect(r.date.getUTCFullYear()).toBe(2024);
        expect(r.exact).toBe(true);
    });

    test('parsa "2024-01-15 15:30" (separador espaço)', () => {
        const r = parseInsaneGHDate('2024-01-15 15:30');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(14);
        expect(r.exact).toBe(true);
    });

    test('parsa sem segundos opcionais', () => {
        const r = parseInsaneGHDate('2024-06-20T12:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(11);   // 12-1=11
    });

    test('retorna null para formato inválido (barras)', () => {
        expect(parseInsaneGHDate('2024/01/15 15:30')).toBeNull();
    });

    test('retorna null para apenas data sem hora', () => {
        expect(parseInsaneGHDate('2024-01-15')).toBeNull();
    });

    test('sempre marca como exact=true', () => {
        const r = parseInsaneGHDate('2024-06-01T10:00:00');
        expect(r).not.toBeNull();
        expect(r.exact).toBe(true);
    });

    test('meia-noite GMT+1: 00:00 → 23:00 UTC dia anterior', () => {
        const r = parseInsaneGHDate('2024-03-01T00:00:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(23);
        expect(r.date.getUTCDate()).toBe(29);    // 2024 é ano bissexto
        expect(r.date.getUTCMonth()).toBe(1);
    });

    test('parsa data de virada de ano', () => {
        const r = parseInsaneGHDate('2024-01-01T01:00:00');
        expect(r).not.toBeNull();
        expect(r.date.getUTCHours()).toBe(0);    // 1-1=0
        expect(r.date.getUTCDate()).toBe(1);
        expect(r.date.getUTCMonth()).toBe(0);
        expect(r.date.getUTCFullYear()).toBe(2024);
    });
});

// ── utils.getIdFromName ───────────────────────────────────────────────────────

describe('utils.getIdFromName', () => {
    test('extrai ID de "123456 Nome do Mod"', () => {
        expect(getIdFromName('123456 Nome do Mod')).toBe('123456');
    });

    test('extrai ID de 7 dígitos', () => {
        expect(getIdFromName('1234567_arquivo')).toBe('1234567');
    });

    test('extrai ID de 10 dígitos (Steam IDs longos)', () => {
        expect(getIdFromName('3012345678 Mod')).toBe('3012345678');
    });

    test('retorna null para número com menos de 6 dígitos', () => {
        expect(getIdFromName('12345 Mod')).toBeNull();
    });

    test('retorna null para string vazia', () => {
        expect(getIdFromName('')).toBeNull();
    });

    test('retorna null para null', () => {
        expect(getIdFromName(null)).toBeNull();
    });

    test('retorna null para undefined', () => {
        expect(getIdFromName(undefined)).toBeNull();
    });

    test('aceita espaços iniciais antes do ID', () => {
        expect(getIdFromName('  123456 Mod')).toBe('123456');
    });

    test('retorna null quando começa com letras', () => {
        expect(getIdFromName('abc123456')).toBeNull();
    });

    test('retorna exatamente 6 dígitos (mínimo)', () => {
        expect(getIdFromName('100000')).toBe('100000');
    });

    test('não inclui caracteres após os dígitos', () => {
        const id = getIdFromName('3746153385 Some Mod Name Here');
        expect(id).toBe('3746153385');
        expect(id.length).toBe(10);
    });
});

// ── utils.isUpToDate ──────────────────────────────────────────────────────────

describe('utils.isUpToDate', () => {
    const base   = new Date('2024-06-01T12:00:00Z');
    const newer  = new Date('2024-06-02T12:00:00Z');
    const older  = new Date('2024-05-31T12:00:00Z');

    test('retorna true quando dateSteam é STEAM_NO_DATE', () => {
        expect(isUpToDate(older, STEAM_NO_DATE)).toBe(true);
    });

    test('retorna true quando dateSteam é STEAM_FETCH_ERROR', () => {
        expect(isUpToDate(older, STEAM_FETCH_ERROR)).toBe(true);
    });

    test('retorna false quando dateMirror é null', () => {
        expect(isUpToDate(null, base)).toBe(false);
    });

    test('retorna false quando dateMirror é undefined', () => {
        expect(isUpToDate(undefined, base)).toBe(false);
    });

    test('retorna true quando mirror é igual ao Steam (mesmo minuto)', () => {
        const sameMin = new Date(base.getTime() + 30000); // +30s, mesmo minuto
        expect(isUpToDate(sameMin, base)).toBe(true);
    });

    test('retorna true quando mirror é mais recente', () => {
        expect(isUpToDate(newer, base)).toBe(true);
    });

    test('retorna false quando mirror é mais antigo', () => {
        expect(isUpToDate(older, base)).toBe(false);
    });

    test('ignora diferença de segundos dentro do mesmo minuto', () => {
        const steam  = new Date('2024-06-01T12:00:59Z');
        const mirror = new Date('2024-06-01T12:00:00Z');
        expect(isUpToDate(mirror, steam)).toBe(true);
    });

    test('detecta diferença de 1 minuto como desatualizado', () => {
        const steam  = new Date('2024-06-01T12:01:00Z');
        const mirror = new Date('2024-06-01T12:00:00Z');
        expect(isUpToDate(mirror, steam)).toBe(false);
    });

    test('datas idênticas retornam true', () => {
        expect(isUpToDate(base, base)).toBe(true);
    });

    test('mirror exatamente 24h mais novo retorna true', () => {
        const mirrorAhead = new Date(base.getTime() + 86400000);
        expect(isUpToDate(mirrorAhead, base)).toBe(true);
    });
});

// ── utils.extractJsonArray ────────────────────────────────────────────────────

describe('utils.extractJsonArray', () => {
    test('retorna o texto original se for um array JSON válido', () => {
        const text = '[{"id":"1"},{"id":"2"}]';
        expect(extractJsonArray(text, 'items')).toBe(text);
    });

    test('extrai array de objeto JSON por chave', () => {
        const text = JSON.stringify({ items: [1, 2, 3], other: 'x' });
        expect(extractJsonArray(text, 'items')).toBe('[1,2,3]');
    });

    test('extrai array de declaração const', () => {
        const text = 'const allMods = [{"name":"123456","link":"http://a.com"}];';
        const r = extractJsonArray(text, 'allMods');
        expect(r).toBe('[{"name":"123456","link":"http://a.com"}]');
    });

    test('extrai array de declaração let', () => {
        const text = 'let data = [1, 2, 3];';
        expect(extractJsonArray(text, 'data')).toBe('[1, 2, 3]');
    });

    test('extrai array de declaração var', () => {
        const text = 'var items = ["a","b"];';
        expect(extractJsonArray(text, 'items')).toBe('["a","b"]');
    });

    test('retorna null quando varName não é encontrado', () => {
        const text = 'const other = [1, 2, 3];';
        expect(extractJsonArray(text, 'missing')).toBeNull();
    });

    test('lida com arrays aninhados', () => {
        const text = 'const matrix = [[1,2],[3,4]];';
        expect(extractJsonArray(text, 'matrix')).toBe('[[1,2],[3,4]]');
    });

    test('strings com colchetes internos não confundem o parser', () => {
        const text = 'const items = ["[a]","[b]"];';
        expect(extractJsonArray(text, 'items')).toBe('["[a]","[b]"]');
    });

    test('retorna null para texto sem variável correspondente', () => {
        expect(extractJsonArray('just some text', 'items')).toBeNull();
    });

    test('array vazio', () => {
        const text = 'const list = [];';
        expect(extractJsonArray(text, 'list')).toBe('[]');
    });

    test('objeto JSON com chave faltando retorna null', () => {
        const text = JSON.stringify({ other: [1, 2] });
        expect(extractJsonArray(text, 'missing')).toBeNull();
    });

    test('array com objetos complexos', () => {
        const mods = [{ name: '123456 Mod', link: 'http://x.com', uploaded: '2024-01-01 10:00' }];
        const text = `const allMods = ${JSON.stringify(mods)};`;
        const r = extractJsonArray(text, 'allMods');
        expect(r).not.toBeNull();
        const parsed = JSON.parse(r);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe('123456 Mod');
    });

    test('strings com aspas simples não fecham indevidamente', () => {
        const text = "const arr = [\"it's fine\"];";
        const r = extractJsonArray(text, 'arr');
        expect(r).toBe("[\"it's fine\"]");
    });
});
