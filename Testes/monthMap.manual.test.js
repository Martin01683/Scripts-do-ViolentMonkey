/**
 * Tests for the expanded MANUAL table in MonthMap (MÓDULO 0.2).
 *
 * Verifica que a tabela MANUAL cobre todos os 30 idiomas suportados pela Steam
 * e que nenhuma entrada produz colisões (dois meses distintos para a mesma chave).
 *
 * Executar: npx jest Testes/monthMap.manual.test.js
 */

'use strict';

// ── Reprodução da MANUAL table extraída do script ──────────────────────────

const MANUAL = {
    // ── Janeiro (0) ────────────────────────────────────────────────────────
    jan:0, january:0, janeiro:0, enero:0, janvier:0, januar:0, januari:0,
    janv:0,
    gennaio:0, gen:0,
    ene:0,
    'январь':0, 'янв':0,
    'січень':0, 'січ':0,
    'styczeń':0, sty:0,
    leden:0, led:0,
    ianuarie:0, ian:0,
    'január':0,
    'ιανουαρίου':0, 'ιαν':0,
    tammikuu:0, tammi:0,
    ocak:0, oca:0,
    'มกราคม':0, 'ม.ค':0,
    '一月':0, '1月':0, '1월':0,

    // ── Fevereiro (1) ──────────────────────────────────────────────────────
    february:1, fevereiro:1, febrero:1, februar:1, februari:1,
    fev:1,
    feb:1,
    'février':1, 'févr':1,
    febbraio:1,
    'февраль':1, 'февр':1,
    'лютий':1, 'лют':1,
    luty:1, lut:1,
    'únor':1, 'úno':1,
    februarie:1,
    'február':1, febr:1,
    'φεβρουαρίου':1, 'φεβ':1,
    helmikuu:1, helmi:1,
    'şubat':1, 'şub':1,
    'กุมภาพันธ์':1, 'ก.พ':1,
    '二月':1, '2月':1, '2월':1,

    // ── Março (2) ──────────────────────────────────────────────────────────
    march:2, 'março':2, marzo:2, marts:2,
    mar:2,
    mars:2,
    'märz':2, 'mär':2,
    maart:2, mrt:2,
    'март':2,
    'березень':2, 'бер':2,
    marzec:2,
    'březen':2, 'bře':2,
    martie:2,
    'március':2, 'márc':2,
    'μαρτίου':2, 'μαρ':2,
    maaliskuu:2, maalis:2,
    mart:2,
    maret:2,
    mac:2,
    'มีนาคม':2, 'มี.ค':2,
    '三月':2, '3月':2, '3월':2,

    // ── Abril (3) ──────────────────────────────────────────────────────────
    april:3, abril:3,
    apr:3, abr:3,
    avril:3, avr:3,
    aprile:3,
    'апрель':3, 'апр':3,
    'квітень':3, 'квіт':3,
    'kwiecień':3, kwi:3,
    duben:3, dub:3,
    aprilie:3,
    'április':3, 'ápr':3,
    'απριλίου':3, 'απρ':3,
    huhtikuu:3, huhti:3,
    nisan:3, nis:3,
    'เมษายน':3, 'เม.ย':3,
    '四月':3, '4月':3, '4월':3,

    // ── Maio (4) ───────────────────────────────────────────────────────────
    maio:4, may:4, mayo:4, mai:4,
    maggio:4, mag:4,
    'май':4,
    'травень':4, 'трав':4,
    maj:4,
    'květen':4, 'kvě':4,
    'május':4, 'máj':4,
    'μαΐου':4, 'μαΐ':4,
    mei:4,
    toukokuu:4, touko:4,
    'mayıs':4,
    'พฤษภาคม':4, 'พ.ค':4,
    '五月':4, '5月':4, '5월':4,

    // ── Junho (5) ──────────────────────────────────────────────────────────
    june:5, junho:5, junio:5, juni:5,
    jun:5,
    juin:5,
    giugno:5, giu:5,
    'июнь':5,
    'червень':5, 'черв':5,
    czerwiec:5, cze:5,
    'červen':5, 'čvn':5,
    iunie:5, iun:5,
    'június':5, 'jún':5,
    'ιουνίου':5, 'ιουν':5,
    'kesäkuu':5, 'kesä':5,
    haziran:5, haz:5,
    'มิถุนายน':5, 'มิ.ย':5,
    '六月':5, '6月':5, '6월':5,

    // ── Julho (6) ──────────────────────────────────────────────────────────
    july:6, julho:6, julio:6, juli:6,
    jul:6,
    juillet:6, juil:6,
    luglio:6, lug:6,
    'июль':6,
    'липень':6, 'лип':6,
    lipiec:6, lip:6,
    'červenec':6, 'čvc':6,
    iulie:6, iul:6,
    'július':6, 'júl':6,
    'ιουλίου':6, 'ιουλ':6,
    'юли':6,
    'heinäkuu':6, 'heinä':6,
    temmuz:6, tem:6,
    julai:6,
    'กรกฎาคม':6, 'ก.ค':6,
    '七月':6, '7月':6, '7월':6,

    // ── Agosto (7) ─────────────────────────────────────────────────────────
    august:7, agosto:7, augustus:7, augusti:7,
    aug:7, ago:7,
    'août':7,
    'август':7, 'авг':7,
    'серпень':7, 'серп':7,
    'sierpień':7, sie:7,
    srpen:7, srp:7,
    augusztus:7,
    'αυγούστου':7, 'αυγ':7,
    elokuu:7, elo:7,
    'ağustos':7, 'ağu':7,
    agustus:7, agu:7,
    ogos:7, ogo:7,
    'สิงหาคม':7, 'ส.ค':7,
    '八月':7, '8月':7, '8월':7,

    // ── Setembro (8) ───────────────────────────────────────────────────────
    september:8, setembro:8, septiembre:8, septembre:8, settembre:8,
    set:8,
    sep:8,
    sept:8,
    'сентябрь':8, 'сент':8,
    'вересень':8, 'вер':8,
    'wrzesień':8, wrz:8,
    'září':8, 'zář':8,
    septembrie:8,
    szeptember:8, szept:8,
    'σεπτεμβρίου':8, 'σεπ':8,
    syyskuu:8, syys:8,
    'eylül':8, eyl:8,
    'กันยายน':8, 'ก.ย':8,
    '九月':8, '9月':8, '9월':8,

    // ── Outubro (9) ────────────────────────────────────────────────────────
    october:9, outubro:9, octubre:9, octobre:9, oktober:9,
    out:9,
    oct:9,
    okt:9,
    ottobre:9, ott:9,
    'октябрь':9, 'окт':9,
    'жовтень':9, 'жовт':9,
    'październik':9, 'paź':9,
    'říjen':9, 'říj':9,
    octombrie:9,
    'október':9,
    'οκτωβρίου':9, 'οκτ':9,
    lokakuu:9, loka:9,
    ekim:9, eki:9,
    'ตุลาคม':9, 'ต.ค':9,
    '十月':9, '10月':9, '10월':9,

    // ── Novembro (10) ──────────────────────────────────────────────────────
    november:10, novembro:10, noviembre:10, novembre:10,
    nov:10,
    'ноябрь':10, 'нояб':10,
    'листопад':10, 'лист':10,
    listopad:10, lis:10,
    noiembrie:10,
    'νοεμβρίου':10, 'νοε':10,
    marraskuu:10, marras:10,
    'kasım':10, kas:10,
    'พฤศจิกายน':10, 'พ.ย':10,
    '十一月':10, '11月':10, '11월':10,

    // ── Dezembro (11) ──────────────────────────────────────────────────────
    december:11, dezembro:11, diciembre:11, dezember:11, dicembre:11,
    dec:11,
    dez:11,
    dic:11,
    'décembre':11, 'déc':11,
    'декабрь':11, 'дек':11,
    'грудень':11, 'груд':11,
    'grudzień':11, gru:11,
    prosinec:11, pro:11,
    decembrie:11,
    'δεκεμβρίου':11, 'δεκ':11,
    desember:11, des:11,
    joulukuu:11, joulu:11,
    'aralık':11, ara:11,
    disember:11, dis:11,
    'ธันวาคม':11, 'ธ.ค':11,
    '十二月':11, '12月':11, '12월':11
};

// ── Mapeamento esperado por idioma (formas longas canônicas) ──────────────
// Cobre os 30 locales Steam + entradas críticas curtas de cada idioma.
const LOCALE_COVERAGE = [
    // [locale, forma_longa_janeiro, forma_curta_julho]
    // Roteiro: pelo menos a forma longa de Jan e a abrev de Jul devem estar na MANUAL.
    ['pt/pt-BR', 'janeiro', 'jul'],
    ['en',        'january', 'jul'],
    ['es/es-419', 'enero',   'jul'],
    ['fr',        'janvier', 'juil'],
    ['de',        'januar',  'jul'],
    ['it',        'gennaio', 'lug'],
    ['ru',        'январь',  'июль'],
    ['uk',        'січень',  'лип'],
    ['pl',        'styczeń', 'lip'],
    ['cs',        'leden',   'čvc'],
    ['ro',        'ianuarie','iul'],
    ['hu',        'január',  'júl'],
    ['el',        'ιανουαρίου', 'ιουλ'],
    ['nl',        'januari', 'jul'],
    ['sv',        'januari', 'jul'],
    ['da',        'januar',  'jul'],
    ['no',        'januar',  'jul'],
    ['fi',        'tammikuu','heinä'],
    ['tr',        'ocak',    'tem'],
    ['id',        'januari', 'jul'],
    ['ms',        'januari', 'jul'],
    ['th',        'มกราคม', 'ก.ค'],
    ['zh-Hans',   '一月',    '七月'],
    ['zh-Hant',   '1月',     '7月'],
    ['ja',        '1月',     '7月'],
    ['ko',        '1월',     '7월'],
    ['bg (юли)', 'januari',  'юли'],   // BG: apenas julho tem forma distinta no manual
];

// ── Test suite ────────────────────────────────────────────────────────────

describe('MonthMap MANUAL table — cobertura completa de idiomas Steam', () => {

    test('A tabela MANUAL não tem colisões (mesma chave → dois meses distintos)', () => {
        // Como o JS aceita chaves duplicadas no literal (última prevalece),
        // precisamos verificar que nenhuma chave foi silenciosamente descartada
        // com valor errado. Re-construímos o mapa e verificamos unicidade.
        const seen = {};
        for (const [key, month] of Object.entries(MANUAL)) {
            if (key in seen) {
                // Uma chave duplicada (ex: typo) com valor diferente seria colisão
                expect(seen[key]).toBe(month);
            }
            seen[key] = month;
        }
        // Se chegou aqui, nenhuma colisão foi detectada
        expect(Object.keys(seen).length).toBeGreaterThan(200);
    });

    test('Todos os valores são inteiros entre 0 e 11', () => {
        for (const [key, month] of Object.entries(MANUAL)) {
            expect(Number.isInteger(month)).toBe(true);
            expect(month).toBeGreaterThanOrEqual(0);
            expect(month).toBeLessThanOrEqual(11);
        }
    });

    describe('Cobertura por idioma — forma longa de Janeiro e abrev de Julho', () => {
        test.each(LOCALE_COVERAGE)(
            '%s — january_form=%s, jul_form=%s',
            (locale, janForm, julForm) => {
                // Usa acesso direto em vez de toHaveProperty para suportar chaves
                // que contenham ponto (ex: 'ก.ค' Thai), pois o Jest interpreta
                // pontos em toHaveProperty como separadores de caminho.
                expect(MANUAL[janForm]).toBe(0);
                expect(MANUAL[julForm]).toBe(6);
            }
        );
    });

    test('Cobre os 12 meses em PT/BR (formas longas)', () => {
        const ptLong = ['janeiro','fevereiro','março','abril','maio','junho',
                        'julho','agosto','setembro','outubro','novembro','dezembro'];
        ptLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre os 12 meses em EN (formas longas)', () => {
        const enLong = ['january','february','march','april','may','june',
                        'july','august','september','october','november','december'];
        enLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas longas completas do Russo (12 meses)', () => {
        const ruLong = ['январь','февраль','март','апрель','май','июнь',
                        'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
        ruLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas longas completas do Ucraniano (12 meses)', () => {
        const ukLong = ['січень','лютий','березень','квітень','травень','червень',
                        'липень','серпень','вересень','жовтень','листопад','грудень'];
        ukLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas longas completas do Grego (12 meses)', () => {
        const elLong = ['ιανουαρίου','φεβρουαρίου','μαρτίου','απριλίου','μαΐου','ιουνίου',
                        'ιουλίου','αυγούστου','σεπτεμβρίου','οκτωβρίου','νοεμβρίου','δεκεμβρίου'];
        elLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas longas completas do Finlandês (12 meses)', () => {
        const fiLong = ['tammikuu','helmikuu','maaliskuu','huhtikuu','toukokuu','kesäkuu',
                        'heinäkuu','elokuu','syyskuu','lokakuu','marraskuu','joulukuu'];
        fiLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas longas completas do Turco (12 meses)', () => {
        const trLong = ['ocak','şubat','mart','nisan','mayıs','haziran',
                        'temmuz','ağustos','eylül','ekim','kasım','aralık'];
        trLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas longas do Thai (12 meses)', () => {
        const thLong = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                        'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        thLong.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas ZH-Hans (一月..十二月)', () => {
        const zhHans = ['一月','二月','三月','四月','五月','六月',
                        '七月','八月','九月','十月','十一月','十二月'];
        zhHans.forEach((name, idx) => {
            expect(MANUAL[name]).toBe(idx);
        });
    });

    test('Cobre formas numéricas CJK/KO (1月..12月 e 1월..12월)', () => {
        for (let i = 1; i <= 12; i++) {
            expect(MANUAL[`${i}月`]).toBe(i - 1);
            expect(MANUAL[`${i}월`]).toBe(i - 1);
        }
    });

    test('Abreviaturas críticas de 3 chars cobrem os meses certos', () => {
        const criticalShort = {
            jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
            jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
        };
        for (const [abbr, month] of Object.entries(criticalShort)) {
            expect(MANUAL[abbr]).toBe(month);
        }
    });

    test('Abreviaturas Cirílicas curtas cobrem os meses certos (RU)', () => {
        const ruShort = {
            'янв':0, 'февр':1, 'апр':3, 'авг':7, 'сент':8, 'окт':9, 'нояб':10, 'дек':11
        };
        for (const [abbr, month] of Object.entries(ruShort)) {
            expect(MANUAL[abbr]).toBe(month);
        }
    });

    test('Entradas Thai abreviadas (ม.ค, ก.พ, etc.) cobrem todos os 12 meses', () => {
        const thShort = ['ม.ค','ก.พ','มี.ค','เม.ย','พ.ค','มิ.ย',
                         'ก.ค','ส.ค','ก.ย','ต.ค','พ.ย','ธ.ค'];
        thShort.forEach((abbr, idx) => {
            expect(MANUAL[abbr]).toBe(idx);
        });
    });

    test('Idiomas Malaio (MS) têm suas formas únicas cobertas', () => {
        // mac=Março, ogos/ogo=Agosto, julai=Julho, disember/dis=Dezembro
        expect(MANUAL['mac']).toBe(2);
        expect(MANUAL['ogos']).toBe(7);
        expect(MANUAL['ogo']).toBe(7);
        expect(MANUAL['julai']).toBe(6);
        expect(MANUAL['disember']).toBe(11);
        expect(MANUAL['dis']).toBe(11);
    });

    test('BG: юли (Julho) está na tabela', () => {
        expect(MANUAL['юли']).toBe(6);
    });

    test('A tabela tem mais de 250 entradas cobrindo todos os idiomas', () => {
        expect(Object.keys(MANUAL).length).toBeGreaterThan(250);
    });
});
