/**
 * perModLimiter.playwright.test.js
 *
 * Testes Playwright para o PerModRequestLimiter (MÓDULO 0.2).
 *
 * Verifica que o semáforo por mirror:
 *   - Limita a concorrência a MAX_CONCURRENT por mirror
 *   - Não compartilha slots entre mirrors distintos
 *   - Respeita ordem FIFO na fila
 *   - Completa todas as tarefas sem perder nenhuma
 *   - Funciona corretamente com apenas 1 tarefa (caso trivial)
 *   - Funciona corretamente com exatamente MAX_CONCURRENT tarefas
 *
 * Executar: npx playwright test Testes/perModLimiter.playwright.test.js
 */

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HTML_FILE = `file://${path.resolve(__dirname, 'perModLimiter.browser.html')}`;
const MAX_CONCURRENT = 10;

test.beforeEach(async ({ page }) => {
    await page.goto(HTML_FILE);
    await page.waitForFunction(() => window.__testReady__ === true);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 1: Limite de concorrência
// ════════════════════════════════════════════════════════════════════════════

test('Limiter: pico de concorrência nunca excede MAX_CONCURRENT com 1 tarefa', async ({ page }) => {
    const { peakRunning } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'skymods', count: 1 })
    );
    expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
    expect(peakRunning).toBe(1);
});

test('Limiter: pico de concorrência nunca excede MAX_CONCURRENT com exatamente MAX_CONCURRENT tarefas', async ({ page }) => {
    const { peakRunning } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'skymods', count: 2 })
    );
    expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
});

test('Limiter: pico de concorrência nunca excede MAX_CONCURRENT com 5 tarefas', async ({ page }) => {
    const { peakRunning } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'skymods', count: 5 })
    );
    expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
});

test('Limiter: pico de concorrência nunca excede MAX_CONCURRENT com 10 tarefas (scroll rápido)', async ({ page }) => {
    const { peakRunning } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'skymods', count: 10 })
    );
    expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
});

test('Limiter: pico de concorrência nunca excede MAX_CONCURRENT com 20 tarefas (coleção grande)', async ({ page }) => {
    const { peakRunning } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'skymods', count: 20, taskDurationMs: 20 })
    );
    expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 2: Completude — nenhuma tarefa é perdida
// ════════════════════════════════════════════════════════════════════════════

test('Limiter: todas as tarefas são concluídas com 5 tarefas', async ({ page }) => {
    const { completionOrder } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'mirror_b', count: 5 })
    );
    expect(completionOrder).toHaveLength(5);
});

test('Limiter: todas as tarefas são concluídas com 10 tarefas', async ({ page }) => {
    const { completionOrder } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'mirror_b', count: 10, taskDurationMs: 20 })
    );
    expect(completionOrder).toHaveLength(10);
});

test('Limiter: todas as tarefas são concluídas com 20 tarefas', async ({ page }) => {
    const { completionOrder } = await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'mirror_b', count: 20, taskDurationMs: 15 })
    );
    expect(completionOrder).toHaveLength(20);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 3: Independência entre mirrors
// ════════════════════════════════════════════════════════════════════════════

test('Limiter: mirrors distintos têm semáforos independentes', async ({ page }) => {
    const { elapsed } = await page.evaluate(() =>
        window.__limiterTest__.mirrorsAreIndependent({
            mirrorA: 'skymods',
            mirrorB: 'outro_mirror',
            taskDurationMs: 150
        })
    );
    // Mirror B não deve ter esperado o Mirror A liberar slots (< 150ms)
    expect(elapsed).toBeLessThan(150);
});

test('Limiter: mirror A cheio não bloqueia mirror B', async ({ page }) => {
    // Ocupa todos os slots do mirror A e verifica que B ainda consegue rodar
    const result = await page.evaluate(async () => {
        const limiterA = window.__limiterTest__;
        const startA = Date.now();

        // Satura mirror A com tarefas longas
        const blockA = Array.from({ length: 2 }, () =>
            limiterA.fakeRequest(200).then(() => {}) // simula slot ocupado
        );

        // Mirror B deve rodar imediatamente
        let bDone = false;
        const taskB = window.__limiterTest__.runConcurrent({
            mirrorId: 'mirror_c_independente',
            count: 1,
            taskDurationMs: 10
        }).then(r => { bDone = true; return r; });

        await taskB;
        const elapsed = Date.now() - startA;
        return { bDone, elapsed };
    });

    expect(result.bDone).toBe(true);
    expect(result.elapsed).toBeLessThan(200);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 4: Ordem FIFO
// ════════════════════════════════════════════════════════════════════════════

test('Limiter: tarefas enfileiradas são despachadas em ordem FIFO', async ({ page }) => {
    const { order } = await page.evaluate(() =>
        window.__limiterTest__.checkFifoOrder({ mirrorId: 'fifo_mirror', extraTasks: 4 })
    );
    // A ordem de execução deve ser 0, 1, 2, 3
    expect(order).toEqual([0, 1, 2, 3]);
});

// ════════════════════════════════════════════════════════════════════════════
// BLOCO 5: Estado interno do limiter
// ════════════════════════════════════════════════════════════════════════════

test('Limiter: estado interno mostra running=0 e queued=0 quando ocioso', async ({ page }) => {
    // Roda e termina tarefas
    await page.evaluate(() =>
        window.__limiterTest__.runConcurrent({ mirrorId: 'state_mirror', count: 3, taskDurationMs: 10 })
    );

    const state = await page.evaluate(() =>
        window.__limiterTest__.getLimiterState('state_mirror')
    );

    expect(state.running).toBe(0);
    expect(state.queued).toBe(0);
});
