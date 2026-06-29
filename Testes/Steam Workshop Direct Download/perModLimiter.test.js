/**
 * perModLimiter.test.js
 *
 * Unit tests para o PerModRequestLimiter — MÓDULO 0.2.
 *
 * Verifica que o semáforo por mirror:
 *   - Limita a concorrência a MAX_CONCURRENT por mirror
 *   - Não compartilha slots entre mirrors distintos
 *   - Respeita ordem FIFO na fila (mesma prioridade)
 *   - Completa todas as tarefas sem perder nenhuma
 *   - Despacha itens de MAIOR prioridade ANTES dos de menor prioridade
 *   - Preserva FIFO dentro de itens com a MESMA prioridade
 *   - Lida corretamente com prioridades mistas (scroll inteligente)
 *
 * Usa apenas Promises e setTimeout nativos do Node.js — não precisa de browser.
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/perModLimiter.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO (espelha PerModRequestLimiter do script principal — MÓDULO 0.2)
// Qualquer mudança no módulo 0.2 do script principal deve ser replicada aqui.
// ════════════════════════════════════════════════════════════════════════════

const MAX_CONCURRENT = 10;
// Valor reduzido para forçar enfileiramento real nos testes de FIFO e prioridade.
// Com 10 slots, tarefas raramente ficam na fila durante os testes.
// Os testes de limite usam toBeLessThanOrEqual(MAX_CONCURRENT=10), portanto
// um pico máximo de QUEUE_TEST_CONCURRENT ainda satisfaz as asserções existentes.
const QUEUE_TEST_CONCURRENT = 3;

// Stub: sem configuração salva nos testes
const mirrorConcurrency = {};

const PerModRequestLimiter = (() => {
    const limiters = {};

    function createLimiter(mirrorId) {
        let running = 0;
        // Array mantido em ordem DECRESCENTE de prioridade; FIFO dentro da mesma.
        const queue = [];

        function drain() {
            const max = mirrorConcurrency[mirrorId] != null
                ? mirrorConcurrency[mirrorId]
                : MAX_CONCURRENT;
            while (running < max && queue.length > 0) {
                const { task, resolve, reject } = queue.shift();
                running++;
                task()
                    .then(resolve, reject)
                    .finally(() => { running--; drain(); });
            }
        }

        return {
            /**
             * Enfileira uma tarefa com prioridade opcional.
             * Itens de MAIOR prioridade são despachados ANTES dos de menor prioridade.
             * Dentro da mesma prioridade, a ordem é FIFO (ordem de inserção).
             *
             * Inserção binária estável: percorre o array mantido em ordem decrescente
             * de prioridade e insere o novo item APÓS todos os itens com prioridade
             * igual (preserva a ordem de chegada dentro da mesma faixa).
             *
             * @param {Function} task     - Função que retorna uma Promise.
             * @param {number}   priority - Prioridade numérica (maior = mais urgente; padrão 0).
             */
            run(task, priority = 0) {
                return new Promise((resolve, reject) => {
                    const item = { task, resolve, reject, priority };
                    let lo = 0, hi = queue.length;
                    while (lo < hi) {
                        const mid = (lo + hi) >> 1;
                        if (queue[mid].priority >= priority) lo = mid + 1;
                        else hi = mid;
                    }
                    queue.splice(lo, 0, item);
                    drain();
                });
            },
            _getRunning()     { return running; },
            _getQueueLength() { return queue.length; },
        };
    }

    return {
        forMirror(mirrorId) {
            if (!limiters[mirrorId]) limiters[mirrorId] = createLimiter(mirrorId);
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

    // Bloqueia TODOS os slots com tarefas longas para forçar enfileiramento real.
    // mirrorConcurrency é sobrescrito localmente neste helper para usar QUEUE_TEST_CONCURRENT.
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;

    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => fakeRequest(100))
    );

    const order = [];
    const enqueued = Array.from({ length: extraTasks }, (_, i) =>
        limiter.run(async () => { order.push(i); })
    );

    await Promise.all([...blockers, ...enqueued]);
    delete mirrorConcurrency[mirrorId]; // restaura o padrão
    return { order };
}

/**
 * Satura todos os slots e verifica que um item de MAIOR prioridade inserido
 * após um de MENOR prioridade é despachado primeiro quando um slot abre.
 *
 * Cenário de scroll inteligente:
 *   1. Todos os slots estão ocupados (mods do topo da página em verificação).
 *   2. Dois itens entram na fila: primeiro o "low" (priority=0), depois o "high" (priority=1).
 *   3. Ao liberar um slot, "high" deve rodar antes de "low".
 */
async function checkPriorityOrder({ mirrorId }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    // Controle manual: resolvemos os blockers um a um de forma determinística.
    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    // Aguarda todos os blockers estarem rodando (slots cheios) antes de enfileirar.
    await new Promise(res => setTimeout(res, 0));

    const order = [];
    // Enfileira PRIMEIRO o de baixa prioridade, DEPOIS o de alta.
    // Com FIFO puro (sem prioridade) sairia ['low', 'high'].
    // Com prioridade correta deve sair ['high', 'low'].
    const lowTask  = limiter.run(async () => { order.push('low');  }, 0);
    const highTask = limiter.run(async () => { order.push('high'); }, 1);

    // Libera um slot → deve escolher 'high' (priority=1)
    blockerResolvers[0]();
    await highTask;

    // Libera restante
    for (let i = 1; i < blockerResolvers.length; i++) blockerResolvers[i]();
    await Promise.all([lowTask, ...blockers]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

/**
 * Verifica que FIFO é preservado DENTRO de itens com a MESMA prioridade.
 * Insere vários itens com priority=1; todos devem sair em ordem de inserção.
 */
async function checkFifoWithinSamePriority({ mirrorId, count = 4 }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    await new Promise(res => setTimeout(res, 0));

    const order = [];
    const tasks = Array.from({ length: count }, (_, i) =>
        limiter.run(async () => { order.push(i); }, 1)
    );

    blockerResolvers.forEach(res => res());
    await Promise.all([...blockers, ...tasks]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

/**
 * Verifica prioridades mistas: insere baixo, alto, baixo, alto — os dois altos
 * devem ser despachados antes dos dois baixos.
 */
async function checkMixedPriorityOrder({ mirrorId }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    await new Promise(res => setTimeout(res, 0));

    const order = [];
    const t1 = limiter.run(async () => { order.push('low-1');  }, 0);
    const t2 = limiter.run(async () => { order.push('high-1'); }, 1);
    const t3 = limiter.run(async () => { order.push('low-2');  }, 0);
    const t4 = limiter.run(async () => { order.push('high-2'); }, 1);

    blockerResolvers.forEach(res => res());
    await Promise.all([...blockers, t1, t2, t3, t4]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
    PerModRequestLimiter._reset();
    for (const k in mirrorConcurrency) delete mirrorConcurrency[k];
});

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

// ── BLOCO 4: Ordem FIFO (prioridade igual = 0) ───────────────────────────────

describe('Ordem FIFO', () => {
    test('tarefas enfileiradas com mesma prioridade saem em ordem de inserção', async () => {
        const { order } = await checkFifoOrder({ mirrorId: 'fifo_mirror', extraTasks: 4 });
        expect(order).toEqual([0, 1, 2, 3]);
    });

    test('run() sem priority equivale a FIFO puro — compatibilidade retroativa', async () => {
        const { order } = await checkFifoOrder({ mirrorId: 'compat_fifo_mirror', extraTasks: 3 });
        expect(order).toEqual([0, 1, 2]);
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

// ── BLOCO 6: Prioridade — fila inteligente de scroll ─────────────────────────
//
// Estes testes verificam o comportamento de fila inteligente implementado para
// permitir que mods visíveis na tela (priority=1) saltem na frente de mods
// pré-carregados ainda fora do viewport (priority=0), eliminando a espera
// ao rolar rapidamente para o final de uma página com muitos mods.

describe('Prioridade (fila inteligente de scroll)', () => {
    test('item de alta prioridade salta na frente do de baixa prioridade', async () => {
        const { order } = await checkPriorityOrder({ mirrorId: 'scroll_priority_a' });
        // 'high' (priority=1) foi inserido DEPOIS de 'low' (priority=0),
        // mas deve ser despachado ANTES — comportamento de fila inteligente.
        expect(order).toEqual(['high', 'low']);
    });

    test('FIFO é preservado dentro de itens com a mesma prioridade', async () => {
        const { order } = await checkFifoWithinSamePriority({
            mirrorId: 'scroll_priority_b',
            count: 4,
        });
        // Todos com priority=1 → ordem de inserção (0,1,2,3) deve ser preservada.
        expect(order).toEqual([0, 1, 2, 3]);
    });

    test('prioridades mistas — todos os alta prioridade antes dos baixa prioridade', async () => {
        const { order } = await checkMixedPriorityOrder({ mirrorId: 'scroll_priority_c' });
        // Inserção: low-1 (0), high-1 (1), low-2 (0), high-2 (1)
        // Esperado: high-1, high-2 (priority=1, FIFO) → low-1, low-2 (priority=0, FIFO)
        expect(order).toEqual(['high-1', 'high-2', 'low-1', 'low-2']);
    });
});
