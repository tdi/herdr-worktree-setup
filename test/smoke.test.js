import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';

test('smol-toml is importable and parses', () => {
  const doc = parse('a = 1\n');
  assert.equal(doc.a, 1);
});
