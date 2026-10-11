import validateSettings from './generated/ai-settings.validator.js';
import validateConnection from './generated/ai-connection.validator.js';
import validateSuggestion from './generated/ai-suggestion.validator.js';
import validateApply from './generated/ai-apply.validator.js';
import type { AiSettings } from './generated/ai-settings';
import type { AiConnection } from './generated/ai-connection';
import type { AiSuggestion } from './generated/ai-suggestion';
import type { AiApplyResult } from './generated/ai-apply';

export type { AiSettings, AiProviderKind } from './generated/ai-settings';
export type { AiConnection } from './generated/ai-connection';
export type { AiSuggestion, AiScope, AiFailure, AiJobState } from './generated/ai-suggestion';
export type { AiApplyResult } from './generated/ai-apply';

export function parseAiSettings(value: unknown): AiSettings {
  if (!validateSettings(value)) throw new Error('INVALID_AI_SETTINGS');
  return value;
}

export function parseAiConnection(value: unknown): AiConnection {
  if (!validateConnection(value)) throw new Error('INVALID_AI_CONNECTION');
  return value;
}

export function parseAiSuggestion(value: unknown): AiSuggestion {
  if (!validateSuggestion(value)) throw new Error('INVALID_AI_SUGGESTION');
  return value;
}

export function parseAiApply(value: unknown): AiApplyResult {
  if (!validateApply(value)) throw new Error('INVALID_AI_APPLY');
  return value;
}
