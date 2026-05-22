/**
 * Cost estimation based on model pricing.
 * Prices are per 1M tokens (input / output) in USD.
 */

export interface ModelPricing {
  input: number;   // $ per 1M input tokens
  output: number;  // $ per 1M output tokens
  cacheRead?: number;
  cacheWrite?: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-20250514':    { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022':  { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet':           { input: 3.0, output: 15.0 },
  'claude-3-opus-20240229':      { input: 15.0, output: 75.0 },
  'claude-3-opus':               { input: 15.0, output: 75.0 },
  'claude-3-haiku-20240307':     { input: 0.25, output: 1.25 },
  'claude-3-haiku':              { input: 0.25, output: 1.25 },
  'claude-sonnet-4':             { input: 3.0, output: 15.0 },
  'claude-opus-4':               { input: 15.0, output: 75.0 },
  // OpenAI
  'gpt-4o':                      { input: 2.5, output: 10.0 },
  'gpt-4o-2024-11-20':           { input: 2.5, output: 10.0 },
  'gpt-4o-mini':                 { input: 0.15, output: 0.6 },
  'gpt-4-turbo':                 { input: 10.0, output: 30.0 },
  'gpt-4':                       { input: 30.0, output: 60.0 },
  'o1':                          { input: 15.0, output: 60.0 },
  'o1-mini':                     { input: 3.0, output: 12.0 },
  'o3-mini':                     { input: 1.1, output: 4.4 },
  // Google
  'gemini-2.0-flash':            { input: 0.1, output: 0.4 },
  'gemini-1.5-pro':              { input: 1.25, output: 5.0 },
  'gemini-1.5-flash':            { input: 0.075, output: 0.3 },
  // DeepSeek
  'deepseek-chat':               { input: 0.27, output: 1.10 },
  'deepseek-coder':              { input: 0.27, output: 1.10 },
  'deepseek-r1':                 { input: 0.55, output: 2.19 },
  // Qwen
  'qwen-max':                    { input: 1.6, output: 4.8 },
  'qwen-plus':                   { input: 0.4, output: 1.2 },
  'qwen-turbo':                  { input: 0.08, output: 0.24 },
};

/** Default pricing when model is not in the table */
const DEFAULT_PRICING: ModelPricing = { input: 3.0, output: 15.0 };

/**
 * Look up pricing for a model name (supports partial match).
 */
export function getModelPricing(model: string): ModelPricing {
  const lower = model.toLowerCase();
  // Exact match first
  if (PRICING[lower]) return PRICING[lower];
  // Partial match (e.g. "claude-3-5-sonnet-20241022" matches "claude-3-5-sonnet")
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (lower.includes(key) || key.includes(lower)) return pricing;
  }
  return DEFAULT_PRICING;
}

/**
 * Estimate cost in USD from token counts.
 */
export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = getModelPricing(model);
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/**
 * Format cost as a human-readable string.
 */
export function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Build a full cost report string.
 */
export function buildCostReport(inputTokens: number, outputTokens: number, model: string): string {
  const cost = estimateCost(inputTokens, outputTokens, model);
  const pricing = getModelPricing(model);
  const lines = [
    `当前模型: ${model}`,
    `输入 Token: ${inputTokens.toLocaleString()} ($${pricing.input}/1M)`,
    `输出 Token: ${outputTokens.toLocaleString()} ($${pricing.output}/1M)`,
    `总 Token: ${(inputTokens + outputTokens).toLocaleString()}`,
    `预估费用: ${formatCost(cost)}`,
  ];
  return lines.join('\n');
}
