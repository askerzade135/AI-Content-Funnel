import { getDb, getSettingsForOwner } from './storage.js';
import { AITaskClass, LLMProviderId, LLMResponse, routeAI } from './llm.js';

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
  taskClass: AITaskClass;
}

export const LLM_TASKS: Record<LLMTaskId, LLMTaskDefinition> = {
  radar_opportunity_analysis: { version: 'v1', temperature: 0.3, maxTokens: 2500, taskClass: 'balanced' },
  radar_discovery_queries: { version: 'v1', temperature: 0.5, maxTokens: 1200, taskClass: 'economy' },
  radar_discovery_plan: { version: 'v1', temperature: 0.5, maxTokens: 1800, taskClass: 'economy' },
  radar_discovery_ranking: { version: 'v1', temperature: 0.2, maxTokens: 2200, taskClass: 'balanced' },
  radar_reference_analysis: { version: 'v1', temperature: 0.2, maxTokens: 900, taskClass: 'economy' },
  radar_script_generation: { version: 'v1', temperature: 0.7, maxTokens: 2200, taskClass: 'quality' },
};

export async function runLLMTask(
  ownerId: string,
  taskId: LLMTaskId,
  prompt: string,
): Promise<LLMResponse> {
  const db = await getDb();
  const settings = getSettingsForOwner(db, ownerId);
  const task = LLM_TASKS[taskId];
  const operation = `${taskId}:${task.version}`;

  const keySettings = {
    geminiApiKey: settings.geminiApiKey,
    groqApiKey: settings.groqApiKey,
    openrouterApiKey: settings.openrouterApiKey,
  };

  if (settings.llmMode === 'byok') {
    const provider = (settings.llmProvider || 'gemini') as LLMProviderId;
    return routeAI({
      taskClass: task.taskClass,
      operation,
      ownerId,
      prompt,
      temperature: task.temperature,
      maxTokens: task.maxTokens,
      byok: {
        provider,
        model: settings.llmModel || undefined,
        keys: keySettings,
      },
    });
  }

  const allowPaidFallback =
    settings.allowPaidAiFallback === true ||
    process.env.ALLOW_PAID_AI_FALLBACK === 'true';

  return routeAI({
    taskClass: task.taskClass,
    operation,
    ownerId,
    prompt,
    temperature: task.temperature,
    maxTokens: task.maxTokens,
    allowPaidFallback,
  });
}
