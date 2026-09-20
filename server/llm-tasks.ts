import { getDb, getSettingsForOwner } from './storage.js';
import { generateWithProvider, isPlatformProviderConfigured, LLMProviderId, LLMResponse } from './llm.js';

export type LLMTaskId =
  | 'radar_opportunity_analysis'
  | 'radar_discovery_queries'
  | 'radar_discovery_plan'
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
  radar_discovery_plan: { version: 'v1', temperature: 0.5, maxTokens: 1800, includedPreference: ['groq', 'gemini', 'openrouter'] },
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

  const keySettings = {
    geminiApiKey: settings.geminiApiKey,
    groqApiKey: settings.groqApiKey,
    openrouterApiKey: settings.openrouterApiKey,
  };

  if (isByok) {
    const provider = (settings.llmProvider || 'gemini') as LLMProviderId;
    return generateWithProvider({
      provider,
      model: settings.llmModel || undefined,
      prompt,
      temperature: task.temperature,
      maxTokens: task.maxTokens,
      operation: `${taskId}:${task.version}`,
      ownerId,
    }, keySettings);
  }

  const candidates = task.includedPreference.filter(isPlatformProviderConfigured);
  if (!candidates.length) {
    throw new Error('Included AI is not configured on the platform.');
  }

  let lastError: unknown;
  for (const provider of candidates) {
    try {
      return await generateWithProvider({
        provider,
        prompt,
        temperature: task.temperature,
        maxTokens: task.maxTokens,
        operation: `${taskId}:${task.version}`,
        ownerId,
      }, {});
    } catch (err) {
      lastError = err;
      console.warn(`[LLM Router] ${taskId} failed on ${provider}; trying next included provider.`, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`All included AI providers failed for task ${taskId}.`);
}
