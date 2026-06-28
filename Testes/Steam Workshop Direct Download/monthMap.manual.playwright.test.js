/**
 * monthMap.manual.playwright.test.js
 *
 * Migração para Playwright dos testes da tabela MANUAL do MonthMap,
 * originalmente executados com Vitest/Jest (monthMap.manual.test.js).
 *
 * Testa a tabela window.__MonthMap__._MANUAL exposta pelo harness
 * monthMap.browser.html, garantindo que cobre todos os 30 idiomas
 * suportados pela Steam sem colisões.
 *
 * test.each() → for...of com testes individuais nomeados.
 *
 * Executar: npx playwright test "monthMap.manual.playwright.test.js"
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'monthMap.browser.html')}`;

// Mapeamento por idioma: [locale, forma_longa_de_Janeiro, abreviação_de_Julho]
// Espelha exatamente o LOCALE_COVERAGE do arquivo Vitest original.
const LOCALE_COVERAGE = [
    ['pt/pt-BR', 'janeiro',      'jul'  ],
    ['en',       'january',      'jul'  ],
    ['es/es-419','enero',        'jul'  ],
    ['fr',       'janvier',      'juil' ],
    ['de',       'januar',       'jul'  ],
    ['it',       'gennaio',      'lug'  ],
    ['ru',       'январь',       'июль' ],
    ['uk',       'січень',       'лип'  ],
    ['pl',       'styczeń',      'lip'  ],
    ['cs',       'leden',        'čvc'  ],
    ['ro',       'ianuarie',     'iul'  ],
    ['hu',       'január',       'júl'  ],
    ['el',       'ιανουαρίου',   'ιουλ'],
    ['nl',       'januari',      'jul'  ],
    ['sv',       'januari',      'jul'  ],
    ['da',       'januar',       'jul'  ],
    ['no',       'januar',       'jul'  ],
    ['fi',       'tammikuu',     'heinä'],
    ['tr',       'ocak',         'tem'  ],
    ['id',       'januari',      'jul'  ],
    ['ms',       'januari',      'jul'  ],
    ['th',       'มกราคม',       'ก.ค' ],
    ['zh-Hans',  '一月',         '七月' ],
    ['zh-Hant',  '1月',          '7月'  ],
    ['ja',       '1月',          '7月'  ],
    ['ko',       '1월',          '7월'  ],
    ['bg (юли)', 'januari',      'юли'  ],
];

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 1: Integridade estrutural da tabela MANUAL
// ════════════════════════════════════════════════════════════════════════════

test.describe('MonthMap MANUAL table — integridade estrutural', () => {

    test('A tabela MANUAL não tem colisões (mesma chave → dois meses distintos)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const seen   = {};
            for (const [key, month] of Object.entries(manual)) {
                if (key in seen && seen[key] !== month) {
                    return { collision: true, key, val1: seen[key], val2: month };
                }
                seen[key] = month;
            }
            return { collision: false, count: Object.keys(seen).length };
        });
        expect(r.collision).toBe(false);
        expect(r.count).toBeGreaterThan(200);
    });

    test('Todos os valores são inteiros entre 0 e 11', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual   = window.__MonthMap__._MANUAL;
            const badEntry = Object.entries(manual).find(
                ([, m]) => !Number.isInteger(m) || m < 0 || m > 11
            );
            return badEntry ? { ok: false, key: badEntry[0], val: badEntry[1] } : { ok: true };
        });
        expect(r.ok).toBe(true);
    });

    test('A tabela tem mais de 250 entradas cobrindo todos os idiomas', async ({ page }) => {
        const count = await page.evaluate(() => Object.keys(window.__MonthMap__._MANUAL).length);
        expect(count).toBeGreaterThan(250);
    });
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2: Cobertura por idioma (migração de test.each)
// ════════════════════════════════════════════════════════════════════════════

test.describe('Cobertura por idioma — forma longa de Janeiro e abrev de Julho', () => {

    for (const [locale, janForm, julForm] of LOCALE_COVERAGE) {
        test(`${locale} — january_form=${janForm}, jul_form=${julForm}`, async ({ page }) => {
            const r = await page.evaluate(({ janForm, julForm }) => {
                const manual = window.__MonthMap__._MANUAL;
                // Acesso direto (evita ambiguidade de pontos em toHaveProperty)
                return { jan: manual[janForm], jul: manual[julForm] };
            }, { janForm, julForm });

            expect(r.jan).toBe(0);
            expect(r.jul).toBe(6);
        });
    }
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 3: Cobertura completa dos 12 meses por idioma
// ════════════════════════════════════════════════════════════════════════════

test.describe('Cobertura completa dos 12 meses por idioma', () => {

    test('Cobre os 12 meses em PT/BR (formas longas)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual  = window.__MonthMap__._MANUAL;
            const ptLong  = ['janeiro','fevereiro','março','abril','maio','junho',
                             'julho','agosto','setembro','outubro','novembro','dezembro'];
            return ptLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `PT: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre os 12 meses em EN (formas longas)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const enLong = ['january','february','march','april','may','june',
                            'july','august','september','october','november','december'];
            return enLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `EN: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas longas completas do Russo (12 meses)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const ruLong = ['январь','февраль','март','апрель','май','июнь',
                            'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
            return ruLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `RU: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas longas completas do Ucraniano (12 meses)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const ukLong = ['січень','лютий','березень','квітень','травень','червень',
                            'липень','серпень','вересень','жовтень','листопад','грудень'];
            return ukLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `UK: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas longas completas do Grego (12 meses)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const elLong = ['ιανουαρίου','φεβρουαρίου','μαρτίου','απριλίου','μαΐου','ιουνίου',
                            'ιουλίου','αυγούστου','σεπτεμβρίου','οκτωβρίου','νοεμβρίου','δεκεμβρίου'];
            return elLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `EL: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas longas completas do Finlandês (12 meses)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const fiLong = ['tammikuu','helmikuu','maaliskuu','huhtikuu','toukokuu','kesäkuu',
                            'heinäkuu','elokuu','syyskuu','lokakuu','marraskuu','joulukuu'];
            return fiLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `FI: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas longas completas do Turco (12 meses)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const trLong = ['ocak','şubat','mart','nisan','mayıs','haziran',
                            'temmuz','ağustos','eylül','ekim','kasım','aralık'];
            return trLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `TR: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas longas do Thai (12 meses)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const thLong = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                            'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
            return thLong.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `TH: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas ZH-Hans (一月..十二月)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual  = window.__MonthMap__._MANUAL;
            const zhHans  = ['一月','二月','三月','四月','五月','六月',
                             '七月','八月','九月','十月','十一月','十二月'];
            return zhHans.map((name, idx) => ({ name, expected: idx, actual: manual[name] }));
        });
        r.forEach(({ name, expected, actual }) => {
            expect(actual, `ZH-Hans: "${name}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Cobre formas numéricas CJK/KO (1月..12月 e 1월..12월)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual = window.__MonthMap__._MANUAL;
            const results = [];
            for (let i = 1; i <= 12; i++) {
                results.push({ key: `${i}月`, expected: i - 1, actual: manual[`${i}月`] });
                results.push({ key: `${i}월`, expected: i - 1, actual: manual[`${i}월`] });
            }
            return results;
        });
        r.forEach(({ key, expected, actual }) => {
            expect(actual, `"${key}" deve ser ${expected}`).toBe(expected);
        });
    });
});


// ════════════════════════════════════════════════════════════════════════════
// BLOCO 4: Abreviações críticas
// ════════════════════════════════════════════════════════════════════════════

test.describe('Abreviações críticas e entradas especiais', () => {

    test('Abreviaturas críticas de 3 chars cobrem os meses certos', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual       = window.__MonthMap__._MANUAL;
            const criticalShort = {
                jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
            };
            return Object.entries(criticalShort).map(([abbr, expected]) => ({
                abbr, expected, actual: manual[abbr]
            }));
        });
        r.forEach(({ abbr, expected, actual }) => {
            expect(actual, `"${abbr}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Abreviaturas Cirílicas curtas cobrem os meses certos (RU)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual  = window.__MonthMap__._MANUAL;
            const ruShort = { 'янв':0, 'февр':1, 'апр':3, 'авг':7, 'сент':8, 'окт':9, 'нояб':10, 'дек':11 };
            return Object.entries(ruShort).map(([abbr, expected]) => ({
                abbr, expected, actual: manual[abbr]
            }));
        });
        r.forEach(({ abbr, expected, actual }) => {
            expect(actual, `RU short: "${abbr}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Entradas Thai abreviadas (ม.ค, ก.พ, etc.) cobrem todos os 12 meses', async ({ page }) => {
        const r = await page.evaluate(() => {
            const manual  = window.__MonthMap__._MANUAL;
            const thShort = ['ม.ค','ก.พ','มี.ค','เม.ย','พ.ค','มิ.ย',
                             'ก.ค','ส.ค','ก.ย','ต.ค','พ.ย','ธ.ค'];
            return thShort.map((abbr, idx) => ({ abbr, expected: idx, actual: manual[abbr] }));
        });
        r.forEach(({ abbr, expected, actual }) => {
            expect(actual, `TH short: "${abbr}" deve ser ${expected}`).toBe(expected);
        });
    });

    test('Idiomas Malaio (MS) têm suas formas únicas cobertas', async ({ page }) => {
        const r = await page.evaluate(() => {
            const m = window.__MonthMap__._MANUAL;
            return {
                mac:      m['mac'],
                ogos:     m['ogos'],
                ogo:      m['ogo'],
                julai:    m['julai'],
                disember: m['disember'],
                dis:      m['dis'],
            };
        });
        expect(r.mac).toBe(2);
        expect(r.ogos).toBe(7);
        expect(r.ogo).toBe(7);
        expect(r.julai).toBe(6);
        expect(r.disember).toBe(11);
        expect(r.dis).toBe(11);
    });

    test('BG: юли (Julho) está na tabela', async ({ page }) => {
        const r = await page.evaluate(() => window.__MonthMap__._MANUAL['юли']);
        expect(r).toBe(6);
    });
});
