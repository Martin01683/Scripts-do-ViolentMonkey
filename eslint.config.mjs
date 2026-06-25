import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    // Testes Vitest
    {
        files: ["Testes/*.test.js"],
        ignores: ["Testes/*.playwright.test.js"],
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
        files: ["Testes/*.playwright.test.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: { ...globals.node, ...globals.browser, test: "readonly", expect: "readonly" },
        },
        rules: { "no-unused-vars": "warn", "no-undef": "error", "no-console": "off" },
    },
    // Configs (playwright, vitest, eslint)
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
