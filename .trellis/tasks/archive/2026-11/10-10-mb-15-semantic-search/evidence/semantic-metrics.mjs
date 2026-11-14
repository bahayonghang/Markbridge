import assert from 'node:assert/strict';

export function validateLabels(labels, expectedFixtureSha256, requireHumanReview = true) {
  assert.equal(labels?.formatVersion, 1, 'RELEVANCE_LABEL_VERSION_INVALID');
  assert.equal(labels.fixtureSha256, expectedFixtureSha256, 'RELEVANCE_FIXTURE_CHANGED');
  assert.equal(labels.topK, 5, 'V18_REQUIRES_TOP5');
  assert.ok(Array.isArray(labels.queries) && labels.queries.length === 20, 'V18_REQUIRES_20_QUERIES');
  const identifiers = new Set();
  for (const query of labels.queries) {
    assert.ok(typeof query.id === 'string' && query.id.length > 0 && !identifiers.has(query.id), 'QUERY_ID_INVALID');
    identifiers.add(query.id);
    assert.ok(typeof query.text === 'string' && query.text.trim().length > 0 && [...query.text].length <= 4096 && Buffer.byteLength(query.text) <= 16384, 'QUERY_TEXT_INVALID');
    assert.ok(Array.isArray(query.relevantChromeIds) && query.relevantChromeIds.length > 0 && query.relevantChromeIds.every(id => /^b(?:[1-9][0-9]{0,3}|10000)$/.test(id)) && new Set(query.relevantChromeIds).size === query.relevantChromeIds.length, 'RELEVANT_IDENTITIES_INVALID');
  }
  if (requireHumanReview) {
    assert.equal(labels.annotationStatus, 'HUMAN_REVIEWED', 'CANDIDATE_LABELS_ARE_NOT_HUMAN_EVIDENCE');
    assert.equal(labels.humanReview?.reviewed, true, 'HUMAN_REVIEW_REQUIRED');
    assert.ok(typeof labels.humanReview.reviewer === 'string' && labels.humanReview.reviewer.trim().length > 0, 'HUMAN_REVIEWER_REQUIRED');
    assert.ok(typeof labels.humanReview.reviewedAt === 'string' && Number.isFinite(Date.parse(labels.humanReview.reviewedAt)), 'HUMAN_REVIEW_TIME_REQUIRED');
  }
  return labels;
}

export function recallAt5(relevant, returned) {
  assert.ok(relevant.length > 0 && new Set(relevant).size === relevant.length, 'RELEVANT_IDENTITIES_INVALID');
  assert.ok(Array.isArray(returned) && returned.length <= 5 && new Set(returned).size === returned.length, 'TOP5_IDENTITIES_INVALID');
  const expected = new Set(relevant);
  return returned.filter(id => expected.has(id)).length / expected.size;
}

export function percentile95(samples) {
  assert.ok(samples.length >= 30 && samples.every(value => Number.isFinite(value) && value >= 0), 'AT_LEAST_30_VALID_WARM_SAMPLES_REQUIRED');
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function evaluationMetrics(labels, results, warmMs) {
  assert.equal(results.length, 20, 'V18_REQUIRES_20_RESULTS');
  const recalls = labels.queries.map(query => {
    const matches = results.filter(result => result.queryId === query.id);
    assert.equal(matches.length, 1, 'QUERY_RESULT_MISSING_OR_DUPLICATE');
    return { queryId: query.id, recallAt5: recallAt5(query.relevantChromeIds, matches[0].chromeIds) };
  });
  const meanRecallAt5 = recalls.reduce((sum, item) => sum + item.recallAt5, 0) / 20;
  const p95Ms = percentile95(warmMs);
  return { recalls, meanRecallAt5, warmCount: warmMs.length, warmMs: [...warmMs], p95Ms, maxMs: Math.max(...warmMs), meetsThresholds: meanRecallAt5 >= 0.8 && p95Ms <= 1000 };
}
