import validateSemanticSettings from './generated/semantic-settings.validator.js';
import type { SemanticSettings } from './generated/semantic-settings';
export type { SemanticSettings } from './generated/semantic-settings';
export function parseSemanticSettings(value: unknown): SemanticSettings {
  if (!validateSemanticSettings(value)) throw new Error('INVALID_SEMANTIC_SETTINGS');
  if (!settingsValid(value)) throw new Error('INVALID_SEMANTIC_SETTINGS');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_SETTINGS');
  return value;
}

import validateSemanticConfig from './generated/semantic-config.validator.js';
import type { SemanticConfig } from './generated/semantic-config';
export type { SemanticConfig } from './generated/semantic-config';
export function parseSemanticConfig(value: unknown): SemanticConfig {
  if (!validateSemanticConfig(value)) throw new Error('INVALID_SEMANTIC_CONFIG');
  if (value.enabled && (!value.endpoint || !value.model)) throw new Error('INVALID_SEMANTIC_CONFIG');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_CONFIG');
  return value;
}

import validateSemanticScope from './generated/semantic-scope.validator.js';
import type { SemanticScope } from './generated/semantic-scope';
export type { SemanticScope } from './generated/semantic-scope';
export function parseSemanticScope(value: unknown): SemanticScope {
  if (!validateSemanticScope(value)) throw new Error('INVALID_SEMANTIC_SCOPE');
  if ((value.folderId !== null) === (value.selectedChromeIds.length > 0)
      || new Set(value.selectedChromeIds).size !== value.selectedChromeIds.length) throw new Error('INVALID_SEMANTIC_SCOPE');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_SCOPE');
  return value;
}

import validateSemanticScopeReview from './generated/semantic-review.validator.js';
import type { SemanticScopeReview } from './generated/semantic-review';
export type { SemanticScopeReview } from './generated/semantic-review';
export function parseSemanticScopeReview(value: unknown): SemanticScopeReview {
  if (!validateSemanticScopeReview(value)) throw new Error('INVALID_SEMANTIC_REVIEW');
  if (value.clippedCount > value.count || value.upperBytes !== value.count * 4096 * 4
      || !recipeValid(value)) throw new Error('INVALID_SEMANTIC_REVIEW');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_REVIEW');
  return value;
}

import validateSemanticStatus from './generated/semantic-status.validator.js';
import type { SemanticStatus } from './generated/semantic-status';
export type { SemanticStatus } from './generated/semantic-status';
export function parseSemanticStatus(value: unknown): SemanticStatus {
  if (!validateSemanticStatus(value)) throw new Error('INVALID_SEMANTIC_STATUS');
  if (!settingsValid(value.settings)) throw new Error('INVALID_SEMANTIC_STATUS');
  const index = value.index;
  if (index && (index.generation < 1 || index.ready + index.pending !== index.total
      || (index.ready > 0 && (!index.dimension || !index.digest))
      || index.storedBytes !== index.ready * (index.dimension ?? 0) * 4
      || (index.failure === null) !== (index.failureMessage === null))) throw new Error('INVALID_SEMANTIC_STATUS');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_STATUS');
  return value;
}

import validateSemanticQuery from './generated/semantic-query.validator.js';
import type { SemanticQuery } from './generated/semantic-query';
export type { SemanticQuery } from './generated/semantic-query';
export function parseSemanticQuery(value: unknown): SemanticQuery {
  if (!validateSemanticQuery(value)) throw new Error('INVALID_SEMANTIC_QUERY');
  if (!value.text.trim() || new TextEncoder().encode(value.text).length > 16384
      || value.generation < 1) throw new Error('INVALID_SEMANTIC_QUERY');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_QUERY');
  return value;
}

import validateSemanticQueryResult from './generated/semantic-result.validator.js';
import type { SemanticQueryResult } from './generated/semantic-result';
export type { SemanticQueryResult } from './generated/semantic-result';
export function parseSemanticQueryResult(value: unknown): SemanticQueryResult {
  if (!validateSemanticQueryResult(value)) throw new Error('INVALID_SEMANTIC_RESULT');
  if (value.generation < 1 || (value.failure === null) !== (value.failureMessage === null)
      || (value.failure !== null && value.hits.length > 0)
      || new Set(value.hits.map(hit => hit.bookmarkId)).size !== value.hits.length) throw new Error('INVALID_SEMANTIC_RESULT');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_RESULT');
  return value;
}

import validateSemanticModelCheck from './generated/semantic-model-check.validator.js';
import type { SemanticModelCheck } from './generated/semantic-model-check';
export type { SemanticModelCheck } from './generated/semantic-model-check';
export function parseSemanticModelCheck(value: unknown): SemanticModelCheck {
  if (!validateSemanticModelCheck(value)) throw new Error('INVALID_SEMANTIC_MODEL_CHECK');
  if (value.available ? (!value.model || !value.digest || value.failure !== null || value.failureMessage !== null)
    : (value.failure === null || value.failureMessage === null || value.model !== null || value.digest !== null || value.dimension !== null)) throw new Error('INVALID_SEMANTIC_MODEL_CHECK');
  if (!unicodeValid(value)) throw new Error('INVALID_SEMANTIC_MODEL_CHECK');
  return value;
}

export type { SemanticIndex, SemanticPhase, SemanticFailure } from './generated/semantic-status';
export type { SemanticHit } from './generated/semantic-result';

function recipeValid(value: { inputRecipeVersion: number; maxInputChars: number; maxInputBytes: number }): boolean {
  return value.inputRecipeVersion === 1 && value.maxInputChars === 8192 && value.maxInputBytes === 32768;
}
function settingsValid(value: SemanticSettings): boolean {
  return recipeValid(value) && (!value.enabled || Boolean(value.endpointLabel && value.model));
}

function unicodeValid(value: unknown): boolean {
  if (typeof value === 'string') return !/[\uD800-\uDFFF]/u.test(value);
  if (Array.isArray(value)) return value.every(unicodeValid);
  if (value && typeof value === 'object') return Object.values(value).every(unicodeValid);
  return true;
}
