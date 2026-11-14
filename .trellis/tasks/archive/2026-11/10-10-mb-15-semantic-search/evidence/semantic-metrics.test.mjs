import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateLabels, semanticFixture } from './semantic-fixture.mjs';
import { evaluationMetrics, percentile95, recallAt5, validateLabels } from './semantic-metrics.mjs';

test('developer candidates never satisfy the human annotation gate', () => {
  const labels = candidateLabels();
  assert.throws(() => validateLabels(labels, labels.fixtureSha256), /CANDIDATE_LABELS/);
  assert.equal(validateLabels(labels, labels.fixtureSha256, false), labels);
  assert.throws(() => validateLabels(labels, 'different', false), /FIXTURE_CHANGED/);
  const bad = structuredClone(labels); bad.queries[1].id = bad.queries[0].id;
  assert.throws(() => validateLabels(bad, labels.fixtureSha256, false), /QUERY_ID_INVALID/);
});

test('B10K candidate corpus is reproducible and keeps fixed scale and topology', () => {
  const first = semanticFixture(true), next = semanticFixture(true);
  assert.equal(first.sha256, next.sha256);
  assert.deepEqual(first.shape, { seed: 20261010, bookmarks: 10000, folders: 1000, maxDepth: 20 });
  assert.equal(first.fixture.profiles[0].nodes.length, 11004);
  assert.equal(Object.keys(first.fixture.profiles[0].summaries).length, 10000);
  const small = semanticFixture();
  assert.equal(small.fixture.profiles.length, 2);
  assert.deepEqual(small.fixture.profiles[0].nodes.map(node => node.chromeId), small.fixture.profiles[1].nodes.map(node => node.chromeId));
});

test('recall and nearest rank p95 retain failing measurements and reject duplicate evidence', () => {
  assert.equal(recallAt5(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd']), 0.8);
  assert.throws(() => recallAt5(['a'], ['a', 'a']), /TOP5/);
  const samples = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.equal(percentile95(samples), 29);
  assert.throws(() => percentile95(samples.slice(1)), /30_VALID/);
  assert.throws(() => percentile95([...samples.slice(1), Number.NaN]), /30_VALID/);
  const labels = candidateLabels();
  const misses = labels.queries.map(query => ({ queryId: query.id, chromeIds: [] }));
  const measured = evaluationMetrics(labels, misses, samples.map(value => value * 100));
  assert.equal(measured.meanRecallAt5, 0);
  assert.equal(measured.p95Ms, 2900);
  assert.equal(measured.meetsThresholds, false);
  assert.deepEqual(measured.warmMs, samples.map(value => value * 100));
  misses[0] = misses[1];
  assert.throws(() => evaluationMetrics(labels, misses, samples), /MISSING_OR_DUPLICATE/);
});
