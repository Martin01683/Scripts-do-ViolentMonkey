import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,  // describe, test, expect, vi disponíveis sem import
        environment: 'node',
        include: ['Testes/**/*.test.js'],
        exclude: ['Testes/**/*.playwright.test.js'],
    },
});
