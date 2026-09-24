import assert from 'node:assert/strict';
import test from 'node:test';
import type { PatchContext } from '../server/analysis/types.js';
import {
  VersionedPatchContextError,
  VersionedPatchContextResolver,
} from '../server/patch-context/VersionedPatchContextResolver.js';

test('the versioned resolver returns the supported 26.19 context', async () => {
  const resolution = await new VersionedPatchContextResolver().resolve('26.19');

  assert.equal(resolution.status, 'ready');
  if (resolution.status !== 'ready') return;
  assert.equal(resolution.context.patch, '26.19');
  assert.equal(resolution.context.contextVersion, '26.19-v1');
  assert.ok(resolution.context.facts.length >= 1);
  assert.ok(resolution.context.facts.every(
    (fact) => fact.subject.trim().length > 0 && fact.text.trim().length > 0,
  ));
});

test('patch lookup trims spaces but does not map Data Dragon versions', async () => {
  const resolver = new VersionedPatchContextResolver();

  assert.deepEqual(
    await resolver.resolve(' 26.19 '),
    await resolver.resolve('26.19'),
  );
  assert.deepEqual(await resolver.resolve('26.19.1'), { status: 'not-found' });
  assert.deepEqual(await resolver.resolve('99.99'), { status: 'not-found' });
});

test('invalid versioned contexts fail deterministically during initialization', () => {
  const invalidContexts: readonly (readonly PatchContext[])[] = [
    [{ patch: '', contextVersion: '26.19-v1', facts: [{ subject: 'x', text: 'y' }] }],
    [{ patch: '26.19', contextVersion: '', facts: [{ subject: 'x', text: 'y' }] }],
    [{ patch: '26.19', contextVersion: '26.19-v1', facts: [] }],
    [{ patch: '26.19', contextVersion: '26.19-v1', facts: [{ subject: ' ', text: 'y' }] }],
    [{ patch: '26.19', contextVersion: '26.19-v1', facts: [{ subject: 'x', text: ' ' }] }],
  ];

  for (const contexts of invalidContexts) {
    assert.throws(() => new VersionedPatchContextResolver(contexts), VersionedPatchContextError);
  }
});

test('duplicate normalized patch identifiers are rejected', () => {
  const context: PatchContext = {
    patch: '26.19',
    contextVersion: '26.19-v1',
    facts: [{ subject: 'Lucian', text: 'Fait vérifié.' }],
  };

  assert.throws(
    () => new VersionedPatchContextResolver([context, { ...context, patch: ' 26.19 ' }]),
    VersionedPatchContextError,
  );
});

test('mutating a resolved context cannot corrupt future resolutions', async () => {
  const resolver = new VersionedPatchContextResolver();
  const first = await resolver.resolve('26.19');
  assert.equal(first.status, 'ready');
  if (first.status !== 'ready') return;

  (first.context as { patch: string }).patch = 'corrupted';
  (first.context.facts[0] as { text: string }).text = 'corrupted';

  const second = await resolver.resolve('26.19');
  assert.equal(second.status, 'ready');
  if (second.status !== 'ready') return;
  assert.equal(second.context.patch, '26.19');
  assert.notEqual(second.context.facts[0]?.text, 'corrupted');
});
