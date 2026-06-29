/**
 * SWDD.templateEngine.test.js
 *
 * Unit tests para funções puras de TemplateEngine de
 * "Steam Workshop Direct Download.user.js".
 *
 * Cobre: formatCacheAge, formatTimeLeft, formatTextWrap
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/SWDD.templateEngine.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÕES (espelham o script original / SWDD.browser.html)
// ════════════════════════════════════════════════════════════════════════════

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

const t = { justNow: 'agora', minAgo: 'min atrás' };

function formatCacheAge(ms) {
    if (!ms || ms < 0 || isNaN(ms)) ms = 0;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return t.justNow;
    return `${minutes} ${t.minAgo}`;
}

function formatTimeLeft(expTimestamp) {
    if (!expTimestamp) return '0s';
    const left = expTimestamp - Date.now();
    if (left <= 0) return '0s';
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${m}m ${s}s`;
}

function formatTextWrap(text, maxChars=50) {
    if (!text) return '';
    return String(text).split(/<br\s*\/?>|\n/i).map(line => {
        const raw = line.trim();
        if (raw.length > maxChars && raw.includes(' ')) {
            const words = raw.split(' ');
            let cur = ''; const lines = [];
            for (const word of words) {
                if (cur.length+word.length>maxChars && cur.length>0) { lines.push(escapeHTML(cur.trim())); cur=word+' '; }
                else cur+=word+' ';
            }
            if (cur.trim()) lines.push(escapeHTML(cur.trim()));
            return lines.join('<br>');
        }
        return escapeHTML(raw);
    }).join('<br>');
}

// ════════════════════════════════════════════════════════════════════════════
// TemplateEngine.formatCacheAge
// ════════════════════════════════════════════════════════════════════════════

describe('TemplateEngine.formatCacheAge', () => {
    test('0 ms → "agora"',                () => expect(formatCacheAge(0)).toBe('agora'));
    test('null → "agora"',                () => expect(formatCacheAge(null)).toBe('agora'));
    test('undefined → "agora"',           () => expect(formatCacheAge(undefined)).toBe('agora'));
    test('negativo → "agora"',            () => expect(formatCacheAge(-5000)).toBe('agora'));
    test('NaN → "agora"',                 () => expect(formatCacheAge(NaN)).toBe('agora'));
    test('59 999 ms (< 1 min) → "agora"', () => expect(formatCacheAge(59999)).toBe('agora'));
    test('60 000 ms → "1 min atrás"',     () => expect(formatCacheAge(60000)).toBe('1 min atrás'));
    test('300 000 ms → "5 min atrás"',    () => expect(formatCacheAge(300000)).toBe('5 min atrás'));
    test('3 600 000 ms → "60 min atrás"', () => expect(formatCacheAge(3600000)).toBe('60 min atrás'));
    test('90 000 ms → "1 min atrás" (arredonda para baixo)', () => expect(formatCacheAge(90000)).toBe('1 min atrás'));
    test('59 min → "59 min atrás"',       () => expect(formatCacheAge(59*60000)).toBe('59 min atrás'));
    test('2 h → "120 min atrás"',         () => expect(formatCacheAge(2*3600000)).toBe('120 min atrás'));
});

// ════════════════════════════════════════════════════════════════════════════
// TemplateEngine.formatTimeLeft
// ════════════════════════════════════════════════════════════════════════════

describe('TemplateEngine.formatTimeLeft', () => {
    test('null → "0s"',           () => expect(formatTimeLeft(null)).toBe('0s'));
    test('0 → "0s"',              () => expect(formatTimeLeft(0)).toBe('0s'));
    test('passado → "0s"',        () => expect(formatTimeLeft(Date.now()-1000)).toBe('0s'));
    test('30 s no futuro → "0m Xs"', () => expect(formatTimeLeft(Date.now()+30000)).toMatch(/^0m \d+s$/));
    test('≈ 90 s no futuro → "1m Xs"', () => expect(formatTimeLeft(Date.now()+90000)).toMatch(/^1m \d+s$/));
    test('≈ 1 h no futuro → "60m Xs"', () => expect(formatTimeLeft(Date.now()+3600000)).toMatch(/^60m \d+s$/));
    test('2 min exatos → formato "2m Xs"', () => expect(formatTimeLeft(Date.now()+2*60000)).toMatch(/^2m \d+s$/));
});

// ════════════════════════════════════════════════════════════════════════════
// TemplateEngine.formatTextWrap
// ════════════════════════════════════════════════════════════════════════════

describe('TemplateEngine.formatTextWrap', () => {
    test('null → ""',                                () => expect(formatTextWrap(null)).toBe(''));
    test('undefined → ""',                           () => expect(formatTextWrap(undefined)).toBe(''));
    test('string vazia → ""',                        () => expect(formatTextWrap('')).toBe(''));
    test('texto curto sem especiais → inalterado',   () => expect(formatTextWrap('Hello world')).toBe('Hello world'));
    test('escapa HTML',                              () => expect(formatTextWrap('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;'));
    test('escapa &',                                 () => expect(formatTextWrap('a & b')).toBe('a &amp; b'));
    test('escapa aspas duplas',                      () => expect(formatTextWrap('"quoted"')).toBe('&quot;quoted&quot;'));
    test('separa <br> existente',                    () => expect(formatTextWrap('Linha 1<br>Linha 2')).toBe('Linha 1<br>Linha 2'));
    test('trata <br/> como separador',               () => expect(formatTextWrap('A<br/>B')).toBe('A<br>B'));
    test('trata <br /> como separador',              () => expect(formatTextWrap('A<br />B')).toBe('A<br>B'));
    test('trata \\n como separador',                 () => expect(formatTextWrap('Linha 1\nLinha 2')).toBe('Linha 1<br>Linha 2'));
    test('texto longo sem espaços não quebra',       () => expect(formatTextWrap('a'.repeat(60), 50)).toBe('a'.repeat(60)));
    test('texto longo com espaços quebra com <br>', () => expect(formatTextWrap('a'.repeat(25)+' '+'b'.repeat(25), 50)).toContain('<br>'));
    test('usa maxChars padrão de 50',               () => expect(formatTextWrap('a'.repeat(26)+' '+'b'.repeat(24))).toContain('<br>'));
    test('remove whitespace ao redor da linha',     () => expect(formatTextWrap('  trimado  ')).toBe('trimado'));
    test('separadores mistos',                       () => expect(formatTextWrap('L1\nL2<br>L3<br/>L4')).toBe('L1<br>L2<br>L3<br>L4'));
    test('HTML especial após split é escapado',     () => expect(formatTextWrap('antes<br><script>')).toBe('antes<br>&lt;script&gt;'));
    test('múltiplas palavras são distribuídas',     () => expect(formatTextWrap('palavra1234 palavra5678 palavraABCD', 15).split('<br>').length).toBeGreaterThan(1));
    test('cada linha não excede maxChars (margem)', () => {
        const lines = formatTextWrap('curta palavrinha outra curta novamente aqui', 20).split('<br>');
        lines.forEach(l => {
            const decoded = l.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
            expect(decoded.length).toBeLessThanOrEqual(35);
        });
    });
});
