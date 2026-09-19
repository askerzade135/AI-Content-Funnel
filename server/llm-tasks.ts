import { getDb, getSettingsForOwner } from './storage.js';
import { generateWithProvider, LLMProviderId, LLMResponse } from './llm.js';

export type LLMTaskId =
  | 'radar_opportunity_analysis'
  | 'radar_discovery_queries'
  | 'radar_discovery_ranking'
  | 'radar_reference_analysis'
  | 'radar_script_generation';

interface LLMTaskDefinition {
  version: string;
  temperature: number;
  maxTokens: number;
  includedPreference: LLMProviderId[];
}

export const LLM_TASKS: Record<LLMTaskId, LLMTaskDefinition> = {
  radar_opportunity_analysis: { version: 'v1', temperature: 0.3, maxTokens: 2500, includedPreference: ['groq', 'gemini', 'openrouter'] },
  radar_discovery_queries: { version: 'v1', temperature: 0.5, maxTokens: 1200, includedPreference: ['groq', 'gemini', 'openrouter'] },
  radar_discovery_ranking: { version: 'v1', temperature: 0.2, maxTokens: 2200, includedPreference: ['groq', 'gemini', 'openrouter'] },
  radar_reference_analysis: { version: 'v1', temperature: 0.2, maxTokens: 900, includedPreference: ['groq', 'gemini', 'openrouter'] },
  radar_script_generation: { version: 'v1', temperature: 0.7, maxTokens: 2200, includedPreference: ['gemini', 'groq', 'openrouter'] },
};

export async function runLLMTask(
  ownerId: string,
  taskId: LLMTaskId,
  prompt: string,
): Promise<LLMResponse> {
  const db = await getDb();
  const settings = getSettingsForOwner(db, ownerId);
  const task = LLM_TASKS[taskId];
  const isByok = settings.llmMode === 'byok';

  const configuredPlatformProviders = new Set<LLMProviderId>();
  if (process.env.GEMINI_API_KEY) configuredPlatformProviders.add('gemini');
  if (process.env.GROQ_API_KEY) configuredPlatformProviders.add('groq');
  if (process.env.OPENROUTER_API_KEY) configuredPlatformProviders.add('openrouter');

  const provider = isByok
    ? (settings.llmProvider || 'gemini') as LLMProviderId
    : task.includedPreference.find((id) => configuredPlatformProviders.has(id)) || 'gemini';

  return generateWithProvider({
    provider,
    model: isByok ? settings.llmModel || undefined : undefined,
    prompt,
    temperature: task.temperature,
    maxTokens: task.maxTokens,
    operation: `${taskId}:${task.version}`,
    ownerId,
  }, {
    geminiApiKey: settings.geminiApiKey,
    groqApiKey: settings.groqApiKey,
    openrouterApiKey: settings.openrouterApiKey,
  });
}
