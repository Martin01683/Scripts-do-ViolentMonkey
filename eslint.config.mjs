import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    // Testes Jest
    {
        files: ["Testes/*.test.js"],
        ignores: ["Testes/*.playwright.test.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                describe: "readonly", test: "readonly", it: "readonly",
                expect: "readonly", beforeEach: "readonly", afterEach: "readonly",
                beforeAll: "readonly", afterAll: "readonly", jest: "readonly",
            },
        },
        rules: { "no-unused-vars": "warn", "no-undef": "error", "no-console": "off" },
    },
    // Testes Playwright (Node host + `window` usada dentro de page.evaluate)
    {
        files: ["Testes/*.playwright.test.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.browser,  // window, document, etc. usados em page.evaluate
                test: "readonly", expect: "readonly",
            },
        },
        rules: { "no-unused-vars": "warn", "no-undef": "error", "no-console": "off" },
    },
    // playwright.config.js
    {
        files: ["playwright.config.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
        rules: { "no-undef": "error" },
    },
];
