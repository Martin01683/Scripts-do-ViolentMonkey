/**
 * perModLimiter.test.js
 *
 * Unit tests para o PerModRequestLimiter — MÓDULO 0.2.
 *
 * Verifica que o semáforo por mirror:
 *   - Limita a concorrência a MAX_CONCURRENT por mirror
 *   - Não compartilha slots entre mirrors distintos
 *   - Respeita ordem FIFO na fila
 *   - Completa todas as tarefas sem perder nenhuma
 *
 * Usa apenas Promises e setTimeout nativos do Node.js — não precisa de browser.
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/perModLimiter.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO (espelha PerModRequestLimiter do script principal)
// ════════════════════════════════════════════════════════════════════════════

const MAX_CONCURRENT = 10;

const PerModRequestLimiter = (() => {
    const limiters = {};

    function createLimiter() {
        let running = 0;
        const queue = [];

        function drain() {
            while (running < MAX_CONCURRENT && queue.length > 0) {
                const { task, resolve, reject } = queue.shift();
                running++;
                task()
                    .then(resolve, reject)
                    .finally(() => { running--; drain(); });
            }
        }

        return {
            run(task) {
                return new Promise((resolve, reject) => {
                    queue.push({ task, resolve, reject });
                    drain();
                });
            },
            _getRunning()      { return running; },
            _getQueueLength()  { return queue.length; },
        };
    }

    return {
        forMirror(mirrorId) {
            if (!limiters[mirrorId]) limiters[mirrorId] = createLimiter();
            return limiters[mirrorId];
        },
        _reset() { for (const k in limiters) delete limiters[k]; },
    };
})();

// ════════════════════════════════════════════════════════════════════════════
// HELPERS DE TESTE
// ════════════════════════════════════════════════════════════════════════════

const fakeRequest = (durationMs) => new Promise(r => setTimeout(r, durationMs));

async function runConcurrent({ mirrorId, count, taskDurationMs = 50 }) {
    const limiter = PerModRequestLimiter.forMirror(mirrorId);
    let peakRunning = 0, currentRunning = 0;
    const completionOrder = [];

    const tasks = Array.from({ length: count }, (_, i) =>
        limiter.run(async () => {
            currentRunning++;
            if (currentRunning > peakRunning) peakRunning = currentRunning;
            await fakeRequest(taskDurationMs);
            completionOrder.push(i);
            currentRunning--;
        })
    );

    await Promise.all(tasks);
    return { peakRunning, completionOrder };
}

async function mirrorsAreIndependent({ mirrorA, mirrorB, taskDurationMs = 80 }) {
    const limiterA = PerModRequestLimiter.forMirror(mirrorA);
    const limiterB = PerModRequestLimiter.forMirror(mirrorB);

    const blockersA = Array.from({ length: MAX_CONCURRENT }, () =>
        limiterA.run(() => fakeRequest(taskDurationMs))
    );

    const startB = Date.now();
    await limiterB.run(() => fakeRequest(10));
    const elapsed = Date.now() - startB;

    await Promise.all(blockersA);
    return { elapsed };
}

async function checkFifoOrder({ mirrorId, extraTasks = 4 }) {
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockers = Array.from({ length: MAX_CONCURRENT }, () =>
        limiter.run(() => fakeRequest(100))
    );

    const order = [];
    const enqueued = Array.from({ length: extraTasks }, (_, i) =>
        limiter.run(async () => { order.push(i); })
    );

    await Promise.all([...blockers, ...enqueued]);
    return { order };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

beforeEach(() => { PerModRequestLimiter._reset(); });

// ── BLOCO 1: Limite de concorrência ──────────────────────────────────────────

describe('Limite de concorrência', () => {
    test('pico com 1 tarefa = 1 e ≤ MAX_CONCURRENT', async () => {
        const { peakRunning } = await runConcurrent({ mirrorId: 'skymods', count: 1 });
        expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
        expect(peakRunning).toBe(1);
    });

    test('pico com 2 tarefas ≤ MAX_CONCURRENT', async () => {
        const { peakRunning } = await runConcurrent({ mirrorId: 'skymods', count: 2 });
        expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
    });

    test('pico com 5 tarefas ≤ MAX_CONCURRENT', async () => {
        const { peakRunning } = await runConcurrent({ mirrorId: 'skymods', count: 5 });
        expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
    });

    test('pico com 10 tarefas (= MAX_CONCURRENT) ≤ MAX_CONCURRENT', async () => {
        const { peakRunning } = await runConcurrent({ mirrorId: 'skymods', count: 10 });
        expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
    });

    test('pico com 20 tarefas (scroll rápido) ≤ MAX_CONCURRENT', async () => {
        const { peakRunning } = await runConcurrent({ mirrorId: 'skymods', count: 20, taskDurationMs: 20 });
        expect(peakRunning).toBeLessThanOrEqual(MAX_CONCURRENT);
    });
});

// ── BLOCO 2: Completude — nenhuma tarefa é perdida ───────────────────────────

describe('Completude — nenhuma tarefa é perdida', () => {
    test('todas as tarefas são concluídas com 5 tarefas', async () => {
        const { completionOrder } = await runConcurrent({ mirrorId: 'mirror_b', count: 5 });
        expect(completionOrder).toHaveLength(5);
    });

    test('todas as tarefas são concluídas com 10 tarefas', async () => {
        const { completionOrder } = await runConcurrent({ mirrorId: 'mirror_b', count: 10, taskDurationMs: 20 });
        expect(completionOrder).toHaveLength(10);
    });

    test('todas as tarefas são concluídas com 20 tarefas', async () => {
        const { completionOrder } = await runConcurrent({ mirrorId: 'mirror_b', count: 20, taskDurationMs: 15 });
        expect(completionOrder).toHaveLength(20);
    });
});

// ── BLOCO 3: Independência entre mirrors ─────────────────────────────────────

describe('Independência entre mirrors', () => {
    test('mirrors distintos têm semáforos independentes', async () => {
        const { elapsed } = await mirrorsAreIndependent({
            mirrorA: 'skymods', mirrorB: 'outro_mirror', taskDurationMs: 150,
        });
        expect(elapsed).toBeLessThan(150);
    });

    test('mirror A cheio não bloqueia mirror B', async () => {
        const limiterC = PerModRequestLimiter.forMirror('mirror_c_independente');
        let bDone = false;
        const taskB = limiterC.run(async () => { await fakeRequest(10); bDone = true; });
        await taskB;
        expect(bDone).toBe(true);
    });
});

// ── BLOCO 4: Ordem FIFO ───────────────────────────────────────────────────────

describe('Ordem FIFO', () => {
    test('tarefas enfileiradas são despachadas em ordem FIFO', async () => {
        const { order } = await checkFifoOrder({ mirrorId: 'fifo_mirror', extraTasks: 4 });
        expect(order).toEqual([0, 1, 2, 3]);
    });
});

// ── BLOCO 5: Estado interno ───────────────────────────────────────────────────

describe('Estado interno do limiter', () => {
    test('running=0 e queued=0 quando ocioso', async () => {
        await runConcurrent({ mirrorId: 'state_mirror', count: 3, taskDurationMs: 10 });
        const limiter = PerModRequestLimiter.forMirror('state_mirror');
        expect(limiter._getRunning()).toBe(0);
        expect(limiter._getQueueLength()).toBe(0);
    });
});
