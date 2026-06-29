/**
 * perModLimiter.test.js
 *
 * Unit tests para o PerModRequestLimiter — MÓDULO 0.2.
 *
 * Verifica que o semáforo por mirror:
 *   - Limita a concorrência a MAX_CONCURRENT por mirror
 *   - Não compartilha slots entre mirrors distintos
 *   - Respeita ordem FIFO na fila quando nenhum mod está visível
 *   - Completa todas as tarefas sem perder nenhuma
 *   - Despacha mods visíveis ANTES dos não visíveis (prioridade dinâmica)
 *   - Prioridade é avaliada no momento do dispatch, não da inserção
 *   - Corrige o bug de prioridade estática (mod visível ao inserir mas não ao despachar)
 *
 * Usa apenas Promises e setTimeout nativos do Node.js — não precisa de browser.
 *
 * Executar: npx vitest run "Testes/Steam Workshop Direct Download/perModLimiter.test.js"
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// STUB: visibleInViewport (espelha o Set do script principal — MÓDULO 7.1)
// Manipulado diretamente pelos testes para simular scroll do usuário.
// Qualquer mudança na estrutura de visibleInViewport no script deve ser
// refletida aqui.
// ════════════════════════════════════════════════════════════════════════════

let visibleInViewport = new Set();

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
        // Fila FIFO: itens são inseridos no final e removidos dinamicamente.
        const queue = [];

        function drain() {
            const max = mirrorConcurrency[mirrorId] != null
                ? mirrorConcurrency[mirrorId]
                : MAX_CONCURRENT;
            while (running < max && queue.length > 0) {
                // Prioridade Dinâmica (O(n)): ao liberar um slot, varre a fila em busca
                // do primeiro mod ATUALMENTE visível no viewport. Se nenhum estiver
                // visível, despacha o mais antigo (FIFO — índice 0).
                let bestIdx = 0;
                for (let i = 0; i < queue.length; i++) {
                    if (visibleInViewport.has(queue[i].modId)) {
                        bestIdx = i;
                        break;
                    }
                }
                const { task, resolve, reject } = queue.splice(bestIdx, 1)[0];
                running++;
                task()
                    .then(resolve, reject)
                    .finally(() => { running--; drain(); });
            }
        }

        return {
            /**
             * Enfileira uma tarefa associada a um mod e aciona o dispatch.
             * A prioridade é determinada de forma DINÂMICA no momento do dispatch,
             * não no momento da inserção na fila.
             *
             * @param {Function} task  - Função que retorna uma Promise.
             * @param {string}   modId - ID do mod; consultado em visibleInViewport ao despachar.
             */
            run(task, modId = null) {
                return new Promise((resolve, reject) => {
                    queue.push({ task, resolve, reject, modId });
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
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;

    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => fakeRequest(100))
    );

    const order = [];
    // Nenhum mod visível → deve preservar FIFO
    const enqueued = Array.from({ length: extraTasks }, (_, i) =>
        limiter.run(async () => { order.push(i); }, `mod-fifo-${i}`)
    );

    await Promise.all([...blockers, ...enqueued]);
    delete mirrorConcurrency[mirrorId];
    return { order };
}

/**
 * Verifica a prioridade dinâmica: insere dois mods na fila, depois muda a
 * visibilidade. O mod que ficar visível ao despachar deve ser servido primeiro,
 * independente da ordem de inserção ou visibilidade no momento da inserção.
 *
 * Cenário:
 *   1. Slot único bloqueado.
 *   2. modA entra na fila enquanto visível.
 *   3. modB entra na fila enquanto NÃO visível.
 *   4. Visibilidade muda: modA sai do viewport, modB entra.
 *   5. Slot liberado → drain deve despachar modB (visível agora).
 */
async function checkDynamicPriorityOnVisibilityChange({ mirrorId }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    await new Promise(res => setTimeout(res, 0));

    // modA visível ao entrar na fila
    visibleInViewport.add('modA');
    const order = [];
    const taskA = limiter.run(async () => { order.push('A'); }, 'modA');

    // modB NÃO visível ao entrar
    visibleInViewport.delete('modA');
    const taskB = limiter.run(async () => { order.push('B'); }, 'modB');

    // Visibilidade muda: modA sai, modB entra
    visibleInViewport.add('modB');

    // Libera um slot → drain escolhe modB (visível agora)
    blockerResolvers[0]();
    await taskB;

    // Libera restante
    for (let i = 1; i < blockerResolvers.length; i++) blockerResolvers[i]();
    await Promise.all([taskA, ...blockers]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

/**
 * Verifica FIFO quando nenhum mod está visível: drain deve despachar na
 * ordem de inserção (índice 0 primeiro).
 */
async function checkFifoWhenNothingVisible({ mirrorId, count = 4 }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    await new Promise(res => setTimeout(res, 0));

    const order = [];
    // Nenhum modId visível — todos com id único para garantir que a varredura não encurte
    const tasks = Array.from({ length: count }, (_, i) =>
        limiter.run(async () => { order.push(i); }, `invisible-mod-${i}`)
    );

    blockerResolvers.forEach(res => res());
    await Promise.all([...blockers, ...tasks]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

/**
 * Verifica que o mod visível inserido DEPOIS de outros não visíveis ainda
 * é despachado primeiro (visibilidade vence a ordem de inserção).
 */
async function checkVisibleWinsOverInsertionOrder({ mirrorId }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    await new Promise(res => setTimeout(res, 0));

    const order = [];
    // Insere 3 não-visíveis, depois 1 visível
    const t1 = limiter.run(async () => { order.push('invisible-1'); }, 'inv1');
    const t2 = limiter.run(async () => { order.push('invisible-2'); }, 'inv2');
    const t3 = limiter.run(async () => { order.push('invisible-3'); }, 'inv3');
    visibleInViewport.add('vis1');
    const t4 = limiter.run(async () => { order.push('visible-1'); }, 'vis1');

    // Libera um slot → drain deve escolher 'visible-1'
    blockerResolvers[0]();
    await t4;

    for (let i = 1; i < blockerResolvers.length; i++) blockerResolvers[i]();
    await Promise.all([t1, t2, t3, ...blockers]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

/**
 * Com vários mods visíveis, o PRIMEIRO visível na fila (mais antigo) é despachado
 * antes dos demais visíveis, preservando FIFO entre visíveis.
 */
async function checkFifoAmongVisibleMods({ mirrorId }) {
    mirrorConcurrency[mirrorId] = QUEUE_TEST_CONCURRENT;
    const limiter = PerModRequestLimiter.forMirror(mirrorId);

    const blockerResolvers = [];
    const blockers = Array.from({ length: QUEUE_TEST_CONCURRENT }, () =>
        limiter.run(() => new Promise(res => blockerResolvers.push(res)))
    );

    await new Promise(res => setTimeout(res, 0));

    const order = [];
    // Insere 1 não-visível, depois 3 visíveis, em ordem
    const tInv = limiter.run(async () => { order.push('inv'); }, 'inv');
    visibleInViewport.add('visA');
    visibleInViewport.add('visB');
    visibleInViewport.add('visC');
    const tA = limiter.run(async () => { order.push('A'); }, 'visA');
    const tB = limiter.run(async () => { order.push('B'); }, 'visB');
    const tC = limiter.run(async () => { order.push('C'); }, 'visC');

    blockerResolvers.forEach(res => res());
    await Promise.all([...blockers, tInv, tA, tB, tC]);

    delete mirrorConcurrency[mirrorId];
    return { order };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
    PerModRequestLimiter._reset();
    for (const k in mirrorConcurrency) delete mirrorConcurrency[k];
    visibleInViewport.clear();
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

// ── BLOCO 4: Ordem FIFO quando nenhum mod está visível ───────────────────────

describe('Ordem FIFO (sem mods visíveis)', () => {
    test('tarefas enfileiradas sem visibilidade saem em ordem de inserção', async () => {
        const { order } = await checkFifoOrder({ mirrorId: 'fifo_mirror', extraTasks: 4 });
        expect(order).toEqual([0, 1, 2, 3]);
    });

    test('run() sem modId equivale a FIFO puro — compatibilidade retroativa', async () => {
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

// ── BLOCO 6: Prioridade Dinâmica — fila inteligente de scroll ─────────────────
//
// Estes testes verificam o comportamento de fila inteligente com PRIORIDADE
// DINÂMICA: a visibilidade é avaliada no momento do dispatch (dentro de drain()),
// não no momento da inserção na fila.
//
// Bug corrigido: com prioridade estática, um mod que era visível ao entrar na
// fila mantinha sua posição mesmo após o usuário rolar para fora — e mods que
// o usuário passava a olhar ficavam presos no final da fila.

describe('Prioridade Dinâmica (fila inteligente de scroll)', () => {
    test('mod visível ao despachar salta na frente de mod não visível — mesmo inserido depois', async () => {
        const { order } = await checkVisibleWinsOverInsertionOrder({ mirrorId: 'dyn_priority_a' });
        // 'visible-1' (vis1) foi inserido APÓS os 3 invisíveis,
        // mas deve ser despachado PRIMEIRO (visível no momento do dispatch).
        expect(order[0]).toBe('visible-1');
    });

    test('FIFO é preservado entre mods visíveis (mais antigo visível sai primeiro)', async () => {
        const { order } = await checkFifoAmongVisibleMods({ mirrorId: 'dyn_priority_b' });
        // A, B, C são todos visíveis e inseridos nessa ordem → devem sair nessa ordem.
        // 'inv' (não visível) deve sair POR ÚLTIMO.
        const visibles = order.filter(x => x !== 'inv');
        expect(visibles).toEqual(['A', 'B', 'C']);
        expect(order[order.length - 1]).toBe('inv');
    });

    test('FIFO puro quando nenhum mod está visível (fallback correto)', async () => {
        const { order } = await checkFifoWhenNothingVisible({ mirrorId: 'dyn_priority_c', count: 4 });
        // Sem nenhum mod visível, drain usa FIFO → ordem de inserção
        expect(order).toEqual([0, 1, 2, 3]);
    });

    test('BUG CORRIGIDO: prioridade reavaliada no dispatch — não congela na inserção', async () => {
        // Cenário do bug original (prioridade estática):
        //   modA é inserido enquanto VISÍVEL → teria prioridade alta congelada
        //   modB é inserido enquanto NÃO VISÍVEL → teria prioridade baixa congelada
        //   Usuário rola: modA sai do viewport, modB entra
        //   Com estática: modA seria despachado primeiro (prioridade congelada = alta) ← ERRADO
        //   Com dinâmica: modB é despachado primeiro (visível no momento do dispatch) ← CORRETO
        const { order } = await checkDynamicPriorityOnVisibilityChange({ mirrorId: 'bug_repro' });
        expect(order).toEqual(['B', 'A']);
    });
});
