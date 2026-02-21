export const TOKEN_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0000025, output: 0.00001 },
  'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },
  'gpt-4-turbo': { input: 0.00001, output: 0.00003 },
  'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },
  'claude-opus-4-5': { input: 0.000015, output: 0.000075 },
  'claude-sonnet-4-5': { input: 0.000003, output: 0.000015 },
  'claude-3-5-sonnet-20241022': { input: 0.000003, output: 0.000015 },
  'claude-3-haiku-20240307': { input: 0.00000025, output: 0.00000125 }
};

const DEFAULT_MODEL = 'gpt-4o';

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const normalizedModel = model.toLowerCase();
  const matchedEntry = Object.entries(TOKEN_COSTS).find(([knownModel]) => normalizedModel.includes(knownModel.toLowerCase()));
  const pricing = matchedEntry?.[1] ?? TOKEN_COSTS[DEFAULT_MODEL];

  const total = promptTokens * pricing.input + completionTokens * pricing.output;
  return Number(total.toFixed(8));
}
