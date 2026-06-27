import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    // Testes Vitest
    {
        files: ["Testes/**/*.test.js"],
        ignores: ["Testes/**/*.playwright.test.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                // Vitest globals (activos via globals:true no vitest.config.js)
                describe:   "readonly",
                test:       "readonly",
                it:         "readonly",
                expect:     "readonly",
                beforeEach: "readonly",
                afterEach:  "readonly",
                beforeAll:  "readonly",
                afterAll:   "readonly",
                vi:         "readonly",
            },
        },
        rules: { "no-unused-vars": "warn", "no-undef": "error", "no-console": "off" },
    },
    // Testes Playwright
    {
        files: ["Testes/**/*.playwright.test.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: { ...globals.node, ...globals.browser, test: "readonly", expect: "readonly" },
        },
        rules: { "no-unused-vars": "warn", "no-undef": "error", "no-console": "off" },
    },
    // Script principal (*.user.js) — browser + APIs do Tampermonkey/ViolentMonkey
    {
        files: ["**/*.user.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "script",
            globals: {
                ...globals.browser,
                GM_getValue:           "readonly",
                GM_setValue:           "readonly",
                GM_addStyle:           "readonly",
                GM_xmlhttpRequest:     "readonly",
                GM_openInTab:          "readonly",
                GM_registerMenuCommand:"readonly",
            },
        },
        rules: { "no-unused-vars": "warn", "no-undef": "error", "no-console": "off", "no-empty": ["error", { "allowEmptyCatch": true }] },
    },
    {
        files: ["playwright.config.js", "vitest.config.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            globals: { ...globals.node },
        },
        rules: { "no-undef": "error" },
    },
];
