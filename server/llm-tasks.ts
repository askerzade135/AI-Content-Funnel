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
}

export const LLM_TASKS: Record<LLMTaskId, LLMTaskDefinition> = {
  radar_opportunity_analysis: { version: 'v1', temperature: 0.3, maxTokens: 2500 },
  radar_discovery_queries: { version: 'v1', temperature: 0.5, maxTokens: 1200 },
  radar_discovery_ranking: { version: 'v1', temperature: 0.2, maxTokens: 2200 },
  radar_reference_analysis: { version: 'v1', temperature: 0.2, maxTokens: 900 },
  radar_script_generation: { version: 'v1', temperature: 0.7, maxTokens: 2200 },
};

export async function runLLMTask(
  ownerId: string,
  taskId: LLMTaskId,
  prompt: string,
): Promise<LLMResponse> {
  const db = await getDb();
  const settings = getSettingsForOwner(db, ownerId);
  const task = LLM_TASKS[taskId];
  const provider = (settings.llmProvider || 'gemini') as LLMProviderId;

  return generateWithProvider({
    provider,
    model: settings.llmModel || undefined,
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
