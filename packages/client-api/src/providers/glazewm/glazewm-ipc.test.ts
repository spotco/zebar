import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_GLAZEWM_IPC_PORT,
  decideGlazeWmReconnectAction,
  isValidGlazeWmIpcPort,
  normalizeGlazeWmIpcPort,
  parseGlazeWmIpcPortContents,
} from './glazewm-ipc.ts';

describe('parseGlazeWmIpcPortContents', () => {
  it('parses 6123', () => {
    assert.equal(parseGlazeWmIpcPortContents('6123'), 6123);
  });

  it('trims whitespace', () => {
    assert.equal(parseGlazeWmIpcPortContents('  6123\n'), 6123);
  });

  it('parses 6125', () => {
    assert.equal(parseGlazeWmIpcPortContents('6125'), 6125);
  });

  it('rejects 0', () => {
    assert.equal(parseGlazeWmIpcPortContents('0'), null);
  });

  it('accepts 65535', () => {
    assert.equal(parseGlazeWmIpcPortContents('65535'), 65535);
  });

  it('rejects 65536', () => {
    assert.equal(parseGlazeWmIpcPortContents('65536'), null);
  });

  it('rejects nonnumeric', () => {
    assert.equal(parseGlazeWmIpcPortContents('abc'), null);
    assert.equal(parseGlazeWmIpcPortContents('61.23'), null);
  });

  it('rejects empty', () => {
    assert.equal(parseGlazeWmIpcPortContents(''), null);
    assert.equal(parseGlazeWmIpcPortContents('   '), null);
  });
});

describe('normalizeGlazeWmIpcPort / missing file', () => {
  it('falls back to 6123 for null/invalid (missing file path)', () => {
    assert.equal(normalizeGlazeWmIpcPort(null), DEFAULT_GLAZEWM_IPC_PORT);
    assert.equal(normalizeGlazeWmIpcPort(undefined), DEFAULT_GLAZEWM_IPC_PORT);
    assert.equal(
      normalizeGlazeWmIpcPort(parseGlazeWmIpcPortContents('') ?? undefined),
      DEFAULT_GLAZEWM_IPC_PORT,
    );
  });

  it('keeps valid ports', () => {
    assert.equal(normalizeGlazeWmIpcPort(6125), 6125);
    assert.ok(isValidGlazeWmIpcPort(1));
    assert.ok(!isValidGlazeWmIpcPort(0));
    assert.ok(!isValidGlazeWmIpcPort(65536));
    assert.ok(!isValidGlazeWmIpcPort(6123.5));
  });
});

describe('decideGlazeWmReconnectAction', () => {
  it('keeps when current=6123 and discovered=6123', () => {
    assert.equal(decideGlazeWmReconnectAction(6123, 6123), 'keep');
  });

  it('replaces when current=6123 and discovered=6125', () => {
    assert.equal(decideGlazeWmReconnectAction(6123, 6125), 'replace');
  });

  it('eventually replaces after stale rediscovery steps', () => {
    const steps = [6123, 6123, 6125];
    let current = 6123;
    let action: 'keep' | 'replace' = 'keep';
    for (const discovered of steps) {
      action = decideGlazeWmReconnectAction(current, discovered);
      if (action === 'replace') {
        current = discovered;
        break;
      }
    }
    assert.equal(action, 'replace');
    assert.equal(current, 6125);
  });
});

describe('generation cleanup guard', () => {
  it('ignores stale generation callbacks after replacement', () => {
    let generation = 1;
    let outputs: number[] = [];

    const emit = (gen: number, value: number) => {
      if (gen !== generation) {
        return;
      }
      outputs.push(value);
    };

    emit(1, 100);
    // Simulate replace: bump generation so old client callbacks die.
    generation = 2;
    emit(1, 999); // stale — must not land
    emit(2, 200);

    assert.deepEqual(outputs, [100, 200]);
  });
});

describe('recovery ownership across sequential port changes', () => {
  it('allows a second rediscovery after a successful replacement', async () => {
    // Mirrors create-glazewm-provider handleDisconnect ownership:
    // recoveringGen is owned by the gen that started recovery and must be
    // cleared in finally when recoveringGen === gen (NOT gen === generation),
    // otherwise the first replaceClient bump leaves recovering stuck and a
    // later 6125 -> 6127 migration never runs.
    let generation = 1;
    let recoveringGen: number | null = null;
    let currentPort = 6123;
    const replacedPorts: number[] = [];

    async function replaceClient(port: number): Promise<void> {
      generation += 1;
      currentPort = port;
      replacedPorts.push(port);
    }

    async function handleDisconnect(
      gen: number,
      discovered: number,
    ): Promise<void> {
      if (gen !== generation || recoveringGen !== null) {
        return;
      }

      recoveringGen = gen;
      try {
        const action = decideGlazeWmReconnectAction(currentPort, discovered);
        if (action === 'replace') {
          await replaceClient(discovered);
          return;
        }
      } finally {
        if (recoveringGen === gen) {
          recoveringGen = null;
        }
      }
    }

    // First migration: 6123 -> 6125
    await handleDisconnect(1, 6125);
    assert.equal(currentPort, 6125);
    assert.equal(generation, 2);
    assert.equal(recoveringGen, null);

    // Second migration on the replacement client: 6125 -> 6127
    await handleDisconnect(2, 6127);
    assert.equal(currentPort, 6127);
    assert.equal(generation, 3);
    assert.equal(recoveringGen, null);
    assert.deepEqual(replacedPorts, [6125, 6127]);

    // And again back toward default/fallback: 6127 -> 6123
    await handleDisconnect(3, 6123);
    assert.equal(currentPort, 6123);
    assert.deepEqual(replacedPorts, [6125, 6127, 6123]);
  });

});
