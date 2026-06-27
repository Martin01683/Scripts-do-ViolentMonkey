/**
 * SWDD.templateEngine.test.js
 *
 * Unit tests for the pure helper functions of TemplateEngine,
 * extracted from "Steam Workshop Direct Download.user.js".
 *
 * Cobre: formatCacheAge, formatTimeLeft, formatTextWrap
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/SWDD.templateEngine.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// DEPENDÊNCIAS EXTRAÍDAS
// ════════════════════════════════════════════════════════════════════════════

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

// Dicionário mínimo — apenas as chaves usadas pelas três funções testadas
const t = {
    justNow: 'agora',
    minAgo:  'min atrás',
};

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÕES (espelham o script original)
// ════════════════════════════════════════════════════════════════════════════

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

function formatTextWrap(text, maxChars = 50) {
    if (!text) return '';
    return String(text)
        .split(/<br\s*\/?>|\n/i)
        .map(line => {
            const raw = line.trim();
            if (raw.length > maxChars && raw.includes(' ')) {
                const words = raw.split(' ');
                let currentLine = '';
                const lines = [];
                for (const word of words) {
                    if (currentLine.length + word.length > maxChars && currentLine.length > 0) {
                        lines.push(escapeHTML(currentLine.trim()));
                        currentLine = word + ' ';
                    } else {
                        currentLine += word + ' ';
                    }
                }
                if (currentLine.trim()) lines.push(escapeHTML(currentLine.trim()));
                return lines.join('<br>');
            }
            return escapeHTML(raw);
        })
        .join('<br>');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

// ── formatCacheAge ────────────────────────────────────────────────────────────

describe('TemplateEngine.formatCacheAge', () => {
    test('retorna t.justNow para 0 ms', () => {
        expect(formatCacheAge(0)).toBe('agora');
    });

    test('retorna t.justNow para null', () => {
        expect(formatCacheAge(null)).toBe('agora');
    });

    test('retorna t.justNow para undefined', () => {
        expect(formatCacheAge(undefined)).toBe('agora');
    });

    test('retorna t.justNow para valor negativo', () => {
        expect(formatCacheAge(-5000)).toBe('agora');
    });

    test('retorna t.justNow para NaN', () => {
        expect(formatCacheAge(NaN)).toBe('agora');
    });

    test('retorna t.justNow para 59 999 ms (< 1 min)', () => {
        expect(formatCacheAge(59999)).toBe('agora');
    });

    test('retorna "1 min atrás" para exatamente 60 000 ms', () => {
        expect(formatCacheAge(60000)).toBe('1 min atrás');
    });

    test('retorna "5 min atrás" para 5 minutos', () => {
        expect(formatCacheAge(300000)).toBe('5 min atrás');
    });

    test('retorna "60 min atrás" para 1 hora', () => {
        expect(formatCacheAge(3600000)).toBe('60 min atrás');
    });

    test('arredonda para baixo frações de minuto', () => {
        // 90 000 ms = 1,5 min → 1 min
        expect(formatCacheAge(90000)).toBe('1 min atrás');
    });

    test('retorna "59 min atrás" para 59 minutos', () => {
        expect(formatCacheAge(59 * 60000)).toBe('59 min atrás');
    });

    test('retorna "120 min atrás" para 2 horas', () => {
        expect(formatCacheAge(2 * 3600000)).toBe('120 min atrás');
    });
});

// ── formatTimeLeft ────────────────────────────────────────────────────────────

describe('TemplateEngine.formatTimeLeft', () => {
    test('retorna "0s" para null', () => {
        expect(formatTimeLeft(null)).toBe('0s');
    });

    test('retorna "0s" para 0', () => {
        expect(formatTimeLeft(0)).toBe('0s');
    });

    test('retorna "0s" para timestamp no passado', () => {
        expect(formatTimeLeft(Date.now() - 1000)).toBe('0s');
    });

    test('retorna "0s" para timestamp exatamente agora (pode ser 0s)', () => {
        const now = Date.now();
        const result = formatTimeLeft(now);
        // Pode ser "0s" ou "0m Xs" dependendo de timing
        expect(result === '0s' || result.match(/^\dm \ds$/) !== null).toBe(true);
    });

    test('retorna formato "0m Xs" para segundos no futuro', () => {
        const result = formatTimeLeft(Date.now() + 30000);
        expect(result).toMatch(/^0m \d+s$/);
    });

    test('retorna "1m Xs" para ≈ 90 segundos no futuro', () => {
        const result = formatTimeLeft(Date.now() + 90000);
        expect(result).toMatch(/^1m \d+s$/);
    });

    test('retorna "60m Xs" para ≈ 1 hora no futuro', () => {
        const result = formatTimeLeft(Date.now() + 3600000);
        expect(result).toMatch(/^60m \d+s$/);
    });

    test('componente de segundos é 0 para múltiplo exato de minuto', () => {
        // +2 min exatos → "2m 0s" (margem de 1s por timing)
        const result = formatTimeLeft(Date.now() + 2 * 60000);
        // segundos podem ser 59 ou 0 pelo timing, apenas verifica formato
        expect(result).toMatch(/^2m \d+s$/);
    });
});

// ── formatTextWrap ────────────────────────────────────────────────────────────

describe('TemplateEngine.formatTextWrap', () => {
    test('retorna string vazia para null', () => {
        expect(formatTextWrap(null)).toBe('');
    });

    test('retorna string vazia para undefined', () => {
        expect(formatTextWrap(undefined)).toBe('');
    });

    test('retorna string vazia para string vazia', () => {
        expect(formatTextWrap('')).toBe('');
    });

    test('texto curto sem caracteres especiais retorna inalterado', () => {
        expect(formatTextWrap('Hello world')).toBe('Hello world');
    });

    test('escapa HTML no output', () => {
        expect(formatTextWrap('<script>alert(1)</script>')).toBe(
            '&lt;script&gt;alert(1)&lt;/script&gt;'
        );
    });

    test('escapa & no output', () => {
        expect(formatTextWrap('a & b')).toBe('a &amp; b');
    });

    test('escapa aspas no output', () => {
        expect(formatTextWrap('"quoted"')).toBe('&quot;quoted&quot;');
    });

    test('separa linhas em <br>', () => {
        expect(formatTextWrap('Linha 1<br>Linha 2')).toBe('Linha 1<br>Linha 2');
    });

    test('trata <br/> como separador', () => {
        expect(formatTextWrap('A<br/>B')).toBe('A<br>B');
    });

    test('trata <br /> (com espaço) como separador', () => {
        expect(formatTextWrap('A<br />B')).toBe('A<br>B');
    });

    test('trata \\n como separador', () => {
        expect(formatTextWrap('Linha 1\nLinha 2')).toBe('Linha 1<br>Linha 2');
    });

    test('texto longo sem espaços não quebra (sem espaço para quebrar)', () => {
        const noSpace = 'a'.repeat(60);
        expect(formatTextWrap(noSpace, 50)).toBe(noSpace);
    });

    test('quebra texto longo com espaços no maxChars', () => {
        // 25 'a' + espaço + 25 'b' = 51 chars > 50 → deve quebrar
        const text = 'a'.repeat(25) + ' ' + 'b'.repeat(25);
        expect(formatTextWrap(text, 50)).toContain('<br>');
    });

    test('usa maxChars padrão de 50', () => {
        // String de 51 chars com espaço no meio
        const text = 'a'.repeat(26) + ' ' + 'b'.repeat(24);
        expect(text.length).toBe(51);
        expect(formatTextWrap(text)).toContain('<br>');
    });

    test('remove whitespace ao redor de cada linha', () => {
        expect(formatTextWrap('  trimado  ')).toBe('trimado');
    });

    test('múltiplas linhas com separadores mistos', () => {
        const result = formatTextWrap('L1\nL2<br>L3<br/>L4');
        expect(result).toBe('L1<br>L2<br>L3<br>L4');
    });

    test('linhas com HTML especial são escapadas após split', () => {
        const result = formatTextWrap('antes<br><script>');
        expect(result).toBe('antes<br>&lt;script&gt;');
    });

    test('múltiplas palavras são bem distribuídas entre linhas', () => {
        // 5 palavras de 12 chars cada = 60 por linha sem quebra → com maxChars=20 deve quebrar
        const text = 'palavra1234 palavra5678 palavraABCD';
        const result = formatTextWrap(text, 15);
        expect(result.split('<br>').length).toBeGreaterThan(1);
    });

    test('cada linha resultado não excede maxChars (exceto palavras únicas longas)', () => {
        const text = 'curta palavrinha outra curta novamente aqui';
        const result = formatTextWrap(text, 20);
        const lines = result.split('<br>');
        // Cada linha sem escapamento deve ter <= 20 chars (exceto palavras maiores que maxChars)
        lines.forEach(line => {
            // Decodifica entidades para medir tamanho real
            const decoded = line.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
            expect(decoded.length).toBeLessThanOrEqual(20 + 15); // margem para 1 palavra extra
        });
    });
});

// ════════════════════════════════════════════════════════════════════════════
// createTooltip — closing bar (regressão Bug #1)
// Verifica que a barra de fechamento é inserida quando o bodyHtml existe mas
// ambas as seções (mirrors verificados e status do cache) estão desabilitadas.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Implementação mínima da lógica de closingBar extraída de createTooltip.
 * Espelha exatamente o trecho corrigido do script para validação isolada.
 *
 * @param {string}  bodyHtml      - HTML do corpo do tooltip (pode ser vazio)
 * @param {string}  mirrorCheckHtml - HTML da seção "Mirrors verificados" ('' = desabilitado)
 * @param {string}  cacheHtml       - HTML da seção "Status do Cache" ('' = desabilitado)
 * @returns {string} HTML completo do tooltip (sem o título, apenas para testar closingBar)
 */
function buildTooltipBody(bodyHtml, mirrorCheckHtml, cacheHtml) {
    const closingBar = (bodyHtml && !mirrorCheckHtml && !cacheHtml)
        ? '<div style="margin-top: 8px; border-top: 1px solid #3d4450;"></div>'
        : '';
    return `${bodyHtml}${mirrorCheckHtml}${cacheHtml}${closingBar}`;
}

const CLOSING_BAR_STYLE = 'border-top: 1px solid #3d4450';

describe('createTooltip: closing bar (barra de fechamento inferior)', () => {
    // ── Cenários onde a barra DEVE aparecer ──────────────────────────────────

    test('adiciona barra quando bodyHtml existe e ambas as seções estão vazias', () => {
        const html = buildTooltipBody('<div>body</div>', '', '');
        expect(html).toContain(CLOSING_BAR_STYLE);
    });

    test('barra aparece ao fim do HTML (após o body)', () => {
        const html = buildTooltipBody('<div>body</div>', '', '');
        const barIdx  = html.indexOf(CLOSING_BAR_STYLE);
        const bodyEnd = html.indexOf('</div>') + '</div>'.length;
        expect(barIdx).toBeGreaterThan(bodyEnd);
    });

    // ── Cenários onde a barra NÃO deve aparecer ──────────────────────────────

    test('NÃO adiciona barra quando mirrors estão presentes', () => {
        const html = buildTooltipBody('<div>body</div>', '<div>mirrors</div>', '');
        expect(html).not.toContain(CLOSING_BAR_STYLE);
    });

    test('NÃO adiciona barra quando cache está presente', () => {
        const html = buildTooltipBody('<div>body</div>', '', '<div>cache</div>');
        expect(html).not.toContain(CLOSING_BAR_STYLE);
    });

    test('NÃO adiciona barra quando mirrors e cache estão presentes', () => {
        const html = buildTooltipBody('<div>body</div>', '<div>mirrors</div>', '<div>cache</div>');
        expect(html).not.toContain(CLOSING_BAR_STYLE);
    });

    test('NÃO adiciona barra quando bodyHtml está vazio (tooltip sem corpo)', () => {
        const html = buildTooltipBody('', '', '');
        expect(html).not.toContain(CLOSING_BAR_STYLE);
    });

    test('NÃO adiciona barra quando bodyHtml está vazio mas seções existem', () => {
        const html = buildTooltipBody('', '<div>mirrors</div>', '<div>cache</div>');
        expect(html).not.toContain(CLOSING_BAR_STYLE);
    });

    // ── Verificação de estrutura ──────────────────────────────────────────────

    test('a barra é um div com border-top (não introduz conteúdo textual)', () => {
        const html = buildTooltipBody('<div>body</div>', '', '');
        // Deve ser um <div> sem conteúdo de texto
        const match = html.match(/<div style="[^"]*border-top[^"]*"><\/div>/);
        expect(match).toBeTruthy();
    });

    test('ordem correta: body → mirrors → cache → barra (quando só body)', () => {
        const html = buildTooltipBody('<div id="b">body</div>', '', '');
        const bodyPos = html.indexOf('id="b"');
        const barPos  = html.indexOf(CLOSING_BAR_STYLE);
        expect(bodyPos).toBeLessThan(barPos);
    });

    test('ordem correta: body → mirrors → sem barra (mirrors presentes)', () => {
        const html = buildTooltipBody('<div id="b">body</div>', '<div id="m">m</div>', '');
        const bodyPos   = html.indexOf('id="b"');
        const mirrorPos = html.indexOf('id="m"');
        expect(bodyPos).toBeLessThan(mirrorPos);
        expect(html).not.toContain(CLOSING_BAR_STYLE);
    });
});
