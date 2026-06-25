// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './Testes',
    testMatch: ['**/*.playwright.test.js'],
    timeout: 30000,
    use: {
        headless: true,
        launchOptions: {
            executablePath: '/opt/google/chrome/chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
    },
    reporter: [['list']],
});
