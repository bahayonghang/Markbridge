import type { SemanticFailure } from '@markbridge/protocol';

const failures: Record<SemanticFailure, string> = {
  DISABLED: '语义检索未启用。普通搜索仍可使用。',
  ENDPOINT_DENIED: '请使用本机 Ollama 地址，例如 http://localhost:11434。',
  MISSING_MODEL: '本地模型不可用。请选择本机已有、支持向量生成的模型。',
  REMOTE_MODEL: '该模型使用远程服务。请选择完全在本机运行的模型。',
  DIMENSION_MISMATCH: '模型维度已变化。请重新审查范围并建立索引。',
  INVALID_VECTOR: '模型返回了无效向量。请检查本地模型后重试。',
  MODEL_CHANGED: '模型版本已变化。请重新审查范围并建立索引。',
  STALE_INDEX: '资料或索引已变化。请刷新状态后重新提交。',
  CANCELLED: '语义请求已取消。',
  TIMED_OUT: '本地模型响应超时。请检查服务后重试。',
  UNREACHABLE: '无法连接本机 Ollama。请检查服务和语义设置。',
  INVALID_RESPONSE: '本地模型响应格式无效。请检查模型后重试。',
  LIMIT_EXCEEDED: '范围或输入超过上限。请缩小范围或缩短输入。',
  STORAGE_ERROR: '无法读写本地索引。请稍后重试。',
};

export function semanticFailureText(failure: SemanticFailure | null): string {
  return failure ? failures[failure] : '语义操作未完成。请刷新状态后重试。';
}

export function indexBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}
