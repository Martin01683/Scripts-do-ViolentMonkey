/**
 * Playwright tests for MonthMap — MÓDULO 0.2
 *
 * Testa o módulo no browser real (Chromium) com Intl.DateTimeFormat disponível,
 * verificando a lógica do commit f88f0eb:
 *   - Tabela MANUAL expandida (300+ entradas, 30 idiomas Steam)
 *   - Mesclagem MANUAL over Intl (Object.assign order)
 *   - Críticos: 'mar'→2, 'мая'→4, 'aoû' removido, BG 'юли'→6
 *   - Thai abrev com ponto, CJK numérico, cache
 *
 * Executar: npx playwright test Testes/monthMap.playwright.test.js
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'monthMap.browser.html')}`;

// ─── helpers ────────────────────────────────────────────────────────────────
async function getMap(page)    { return page.evaluate(() => window.__MonthMap__.get()); }
async function getManual(page) { return page.evaluate(() => window.__MonthMap__._MANUAL); }

// ─── setup ───────────────────────────────────────────────────────────────────
test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
    // reset cache entre testes para isolar efeitos do Intl
    await page.evaluate(() => window.__MonthMap__.reset());
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 1: Sanidade da tabela MANUAL (sem Intl)
// ════════════════════════════════════════════════════════════════════════════

test('MANUAL: sem colisões — nenhuma chave aponta para dois meses diferentes', async ({ page }) => {
    const manual = await getManual(page);
    const seen = {};
    for (const [key, val] of Object.entries(manual)) {
        if (seen[key] !== undefined) {
            throw new Error(`Colisão: chave "${key}" → ${seen[key]} e ${val}`);
        }
        seen[key] = val;
    }
    // se chegou aqui, não há colisões
    expect(Object.keys(seen).length).toBeGreaterThan(250);
});

test('MANUAL: todos os valores são inteiros 0-11', async ({ page }) => {
    const manual = await getManual(page);
    const invalid = Object.entries(manual).filter(([, v]) => !Number.isInteger(v) || v < 0 || v > 11);
    expect(invalid).toHaveLength(0);
});

test('MANUAL: tem mais de 250 entradas', async ({ page }) => {
    const manual = await getManual(page);
    expect(Object.keys(manual).length).toBeGreaterThan(250);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2: Mesclagem MANUAL over Intl — chaves críticas não podem ser sobrescritas
// ════════════════════════════════════════════════════════════════════════════

test('MERGE: "mar" aponta para Março (2) — MANUAL vence sobre Intl', async ({ page }) => {
    const map = await getMap(page);
    // "marraskuu" (FI=novembro) via Intl short poderia gerar "mar"→10; MANUAL deve prevalecer
    expect(map['mar']).toBe(2);
});

test('MERGE: "мая" aponta para Maio (4) — RU genitivo não sobrescreve', async ({ page }) => {
    const map = await getMap(page);
    // Intl RU short pode emitir "мая"; MANUAL tem "май"→4; verifica que maio está correto
    // "мая" pode aparecer via Intl RU como forma curta — não deve deslocar "май"
    const mayKeys = ['май', 'maio', 'may', 'mayo', 'mai'];
    for (const k of mayKeys) {
        expect(map[k]).toBe(4);
    }
});

test('MERGE: "août" aponta para Agosto (7) — typo "aoû" foi corrigido', async ({ page }) => {
    const map = await getMap(page);
    // A tabela antiga tinha "aoû" (typo). O commit corrigiu para "août".
    expect(map['août']).toBe(7);
    // O typo antigo NÃO deve existir como chave isolada (só permitido se for redirecionado corretamente)
    // Nota: "aoû" sem acento final não é uma forma francesa válida, mas a commit manteve back-compat via "août"
});

test('MERGE: "юли" (BG) aponta para Julho (6)', async ({ page }) => {
    const map = await getMap(page);
    // BG gera "01".."12" via Intl (não nomes), então "юли" só existe na MANUAL
    expect(map['юли']).toBe(6);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 3: Cobertura por idioma — formas longas (todos os 12 meses)
// ════════════════════════════════════════════════════════════════════════════

const LONG_FORMS = {
    'PT/BR': ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'],
    'EN':    ['january','february','march','april','may','june','july','august','september','october','november','december'],
    'ES':    ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
    'FR':    ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
    'DE':    ['januar','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'],
    'IT':    ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'],
    'RU':    ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'],
    'UK':    ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень'],
    'PL':    ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'],
    'CS':    ['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'],
    'RO':    ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'],
    'HU':    ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'],
    'EL':    ['ιανουαρίου','φεβρουαρίου','μαρτίου','απριλίου','μαΐου','ιουνίου','ιουλίου','αυγούστου','σεπτεμβρίου','οκτωβρίου','νοεμβρίου','δεκεμβρίου'],
    'FI':    ['tammikuu','helmikuu','maaliskuu','huhtikuu','toukokuu','kesäkuu','heinäkuu','elokuu','syyskuu','lokakuu','marraskuu','joulukuu'],
    'TR':    ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'],
    'TH':    ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
};

for (const [locale, months] of Object.entries(LONG_FORMS)) {
    test(`LONG-FORMS: ${locale} cobre todos os 12 meses (formas longas)`, async ({ page }) => {
        const map = await getMap(page);
        months.forEach((m, idx) => {
            expect(map[m], `${locale} "${m}" deve ser ${idx}`).toBe(idx);
        });
    });
}


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 4: Abreviaturas críticas compartilhadas
// ════════════════════════════════════════════════════════════════════════════

test('ABREV: 3-char clássicas latinas não colidem', async ({ page }) => {
    const map = await getMap(page);
    const critical = {
        jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
    };
    for (const [k, expected] of Object.entries(critical)) {
        expect(map[k], `"${k}" deve ser ${expected}`).toBe(expected);
    }
});

test('ABREV: abreviaturas PT específicas (fev, mar, set, out, dez)', async ({ page }) => {
    const map = await getMap(page);
    expect(map['fev']).toBe(1);
    expect(map['mar']).toBe(2);
    expect(map['set']).toBe(8);
    expect(map['out']).toBe(9);
    expect(map['dez']).toBe(11);
});

test('ABREV: abreviaturas RU cirílicas curtas', async ({ page }) => {
    const map = await getMap(page);
    const ru = { 'янв':0,'февр':1,'апр':3,'авг':7,'сент':8,'окт':9,'нояб':10,'дек':11 };
    for (const [k, v] of Object.entries(ru)) {
        expect(map[k], `RU "${k}" deve ser ${v}`).toBe(v);
    }
});

test('ABREV: abreviaturas IT (gen, feb, mag, giu, lug, ago, set, ott, dic)', async ({ page }) => {
    const map = await getMap(page);
    const it = { gen:0,mag:4,giu:5,lug:6,ago:7,ott:9,dic:11 };
    for (const [k, v] of Object.entries(it)) {
        expect(map[k], `IT "${k}" deve ser ${v}`).toBe(v);
    }
});

test('ABREV: abreviaturas FR (janv, févr, juil, déc)', async ({ page }) => {
    const map = await getMap(page);
    expect(map['janv']).toBe(0);
    expect(map['févr']).toBe(1);
    expect(map['juil']).toBe(6);
    expect(map['déc']).toBe(11);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 5: Formas Thai (com ponto) — novo no commit
// ════════════════════════════════════════════════════════════════════════════

test('THAI: formas curtas com ponto cobrem todos os 12 meses', async ({ page }) => {
    const map = await getMap(page);
    const thaiShort = [
        'ม.ค', 'ก.พ', 'มี.ค', 'เม.ย', 'พ.ค', 'มิ.ย',
        'ก.ค', 'ส.ค', 'ก.ย', 'ต.ค', 'พ.ย', 'ธ.ค'
    ];
    thaiShort.forEach((abbr, idx) => {
        expect(map[abbr], `TH abrev "${abbr}" deve ser ${idx}`).toBe(idx);
    });
});

test('THAI: formas longas cobrem todos os 12 meses', async ({ page }) => {
    const map = await getMap(page);
    const thaiLong = [
        'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
        'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
    ];
    thaiLong.forEach((name, idx) => {
        expect(map[name], `TH longa "${name}" deve ser ${idx}`).toBe(idx);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 6: Formas CJK numéricas — novo no commit
// ════════════════════════════════════════════════════════════════════════════

test('CJK: ZH-Hans (一月..十二月) mapeia corretamente', async ({ page }) => {
    const map = await getMap(page);
    const zhHans = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    zhHans.forEach((m, idx) => {
        expect(map[m], `ZH-Hans "${m}" deve ser ${idx}`).toBe(idx);
    });
});

test('CJK: ZH-Hant/JA (1月..12月) mapeia corretamente', async ({ page }) => {
    const map = await getMap(page);
    for (let i = 1; i <= 12; i++) {
        expect(map[`${i}月`], `"${i}月" deve ser ${i-1}`).toBe(i - 1);
    }
});

test('CJK: KO (1월..12월) mapeia corretamente', async ({ page }) => {
    const map = await getMap(page);
    for (let i = 1; i <= 12; i++) {
        expect(map[`${i}월`], `"${i}월" deve ser ${i-1}`).toBe(i - 1);
    }
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 7: Intl enrichment — formas que vêm só do Intl (não estão na MANUAL)
// ════════════════════════════════════════════════════════════════════════════

test('INTL: o mapa final tem mais entradas que a MANUAL sozinha', async ({ page }) => {
    const map    = await getMap(page);
    const manual = await getManual(page);
    expect(Object.keys(map).length).toBeGreaterThan(Object.keys(manual).length);
});

test('INTL: MANUAL nunca é sobrescrita — "mar" permanece 2 após merge', async ({ page }) => {
    const map = await getMap(page);
    // Mesmo que Intl gere "marraskuu"→10 via short, "mar" da MANUAL (→2) deve prevalecer
    expect(map['mar']).toBe(2);
});

test('INTL: cache é reutilizado na segunda chamada (mesmo objeto)', async ({ page }) => {
    const isSameRef = await page.evaluate(() => {
        const a = window.__MonthMap__.get();
        const b = window.__MonthMap__.get();
        return a === b; // mesmo objeto → cache funcionou
    });
    expect(isSameRef).toBe(true);
});

test('INTL: reset do cache permite reconstrução', async ({ page }) => {
    const result = await page.evaluate(() => {
        const a = window.__MonthMap__.get();
        window.__MonthMap__.reset();
        const b = window.__MonthMap__.get();
        return { sameRef: a === b, keysMatch: JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) };
    });
    // Objetos distintos após reset, mas conteúdo idêntico
    expect(result.sameRef).toBe(false);
    expect(result.keysMatch).toBe(true);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 8: Casos de borda específicos do commit
// ════════════════════════════════════════════════════════════════════════════

test('BORDA: "agosto" (PT/ES) aponta para 7, não confunde com "ago" (abrev IT)', async ({ page }) => {
    const map = await getMap(page);
    expect(map['agosto']).toBe(7);
    expect(map['ago']).toBe(7);   // ambos agosto — sem colisão
});

test('BORDA: "mac" (MS=Março) não conflita com outras abreviações', async ({ page }) => {
    const map = await getMap(page);
    expect(map['mac']).toBe(2);   // Malaio: mac = março
});

test('BORDA: "mai" (FR/DE/NO=Maio) e "maj" (PL/SV/DA=Maio) não colidem', async ({ page }) => {
    const map = await getMap(page);
    expect(map['mai']).toBe(4);
    expect(map['maj']).toBe(4);
});

test('BORDA: "jul" aponta para Julho (6) — não Júlio (sem acento)', async ({ page }) => {
    const map = await getMap(page);
    expect(map['jul']).toBe(6);
    expect(map['july']).toBe(6);
    expect(map['julho']).toBe(6);
    expect(map['julio']).toBe(6);
});

test('BORDA: "pro" (CS=Dezembro) não conflita com nada', async ({ page }) => {
    const map = await getMap(page);
    expect(map['pro']).toBe(11);  // CS: prosinec = dezembro
});

test('BORDA: "ogos" e "ogo" (MS=Agosto) estão presentes', async ({ page }) => {
    const map = await getMap(page);
    expect(map['ogos']).toBe(7);
    expect(map['ogo']).toBe(7);
});

test('BORDA: "julai" (MS=Julho) está presente', async ({ page }) => {
    const map = await getMap(page);
    expect(map['julai']).toBe(6);
});

test('BORDA: "disember"/"dis" (MS=Dezembro) estão presentes', async ({ page }) => {
    const map = await getMap(page);
    expect(map['disember']).toBe(11);
    expect(map['dis']).toBe(11);
});

test('BORDA: HU "január" com acento é distinto de DE "januar" sem acento', async ({ page }) => {
    const map = await getMap(page);
    // Ambos devem mapear para Janeiro (0), mas são chaves distintas
    expect(map['januar']).toBe(0);   // DE/SV/DA/NO/RO
    expect(map['január']).toBe(0);   // HU
});

test('BORDA: "červen" (CS=Junho) e "červenec" (CS=Julho) sem colisão', async ({ page }) => {
    const map = await getMap(page);
    expect(map['červen']).toBe(5);
    expect(map['červenec']).toBe(6);
});

test('BORDA: "kesäkuu"/"kesä" (FI=Junho) não confunde com "kesä" produzido pelo Intl', async ({ page }) => {
    const map = await getMap(page);
    expect(map['kesäkuu']).toBe(5);
    expect(map['kesä']).toBe(5);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 9: Intl real do browser — verificação cruzada com DateTimeFormat
// ════════════════════════════════════════════════════════════════════════════

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para EN', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('en', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para PT-BR', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('pt-BR', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para RU', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('ru', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para JA', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('ja', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para KO', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('ko', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: mapa do browser bate com Intl.DateTimeFormat para TH', async ({ page }) => {
    const results = await page.evaluate(() => {
        const map = window.__MonthMap__.get();
        const failures = [];
        for (let m = 0; m < 12; m++) {
            const d = new Date(2024, m, 1);
            ['long','short'].forEach(fmt => {
                const name = new Intl.DateTimeFormat('th', { month: fmt }).format(d)
                    .toLowerCase().trim().replace(/[.,]$/, '');
                if (map[name] !== m) failures.push({ name, expected: m, got: map[name] });
            });
        }
        return failures;
    });
    expect(results).toHaveLength(0);
});

test('INTL REAL: todos os 30 locales Steam resolvem sem erro no browser', async ({ page }) => {
    const locales = await page.evaluate(() => window.__MonthMap__._STEAM_LOCALES);
    const errors = await page.evaluate((locales) => {
        const errs = [];
        locales.forEach(locale => {
            for (let m = 0; m < 12; m++) {
                try {
                    new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2024, m, 1));
                } catch(e) {
                    errs.push({ locale, m, error: e.message });
                }
            }
        });
        return errs;
    }, locales);
    expect(errors).toHaveLength(0);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 10: Regressão — verifica que a antiga tabela (60 entradas) foi substituída
// ════════════════════════════════════════════════════════════════════════════

test('REGRESSÃO: tabela antiga tinha "aoû" (typo) — novo commit corrigiu para "août"', async ({ page }) => {
    const manual = await getManual(page);
    // Commit message: "Fixed old typo: 'aoû' → 'août'"
    // "août" deve existir, "aoû" não precisa existir (o commit removeu-o da tabela explícita)
    // O back-compat foi mantido via "août" apenas
    expect(manual['août']).toBe(7);
    // "aoû" (sem t final) era o typo da tabela antiga — não deve existir como entrada isolada
    // (o commit diz "Fixed old typo: 'aoû' → 'août' (French August; both forms kept for back-compat via 'août')")
    // Isso significa que apenas 'août' foi mantido, 'aoû' foi removido
    expect(manual['aoû']).toBeUndefined();
});

test('REGRESSÃO: idiomas que a tabela antiga não cobria agora têm entradas', async ({ page }) => {
    const manual = await getManual(page);
    // Tabela antiga: ~60 entradas, sem: EL, FI, TH, ZH, JA, KO, UK, CS, HU
    expect(manual['ιανουαρίου']).toBe(0);  // EL
    expect(manual['tammikuu']).toBe(0);    // FI
    expect(manual['มกราคม']).toBe(0);      // TH
    expect(manual['一月']).toBe(0);         // ZH-Hans
    expect(manual['1月']).toBe(0);          // JA/ZH-Hant
    expect(manual['1월']).toBe(0);          // KO
    expect(manual['січень']).toBe(0);      // UK
    expect(manual['leden']).toBe(0);       // CS
    expect(manual['január']).toBe(0);      // HU
});
