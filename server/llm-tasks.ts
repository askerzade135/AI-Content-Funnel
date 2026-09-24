import { getDb, getSettingsForOwner } from './storage.js';
import { AITaskClass, LLMProviderId, LLMResponse, routeAI } from './llm.js';

export type LLMTaskId =
  | 'radar_opportunity_analysis'
  | 'radar_discovery_queries'
  | 'radar_discovery_plan'
  | 'radar_discovery_ranking'
  | 'radar_reference_analysis'
  | 'radar_script_generation';

export interface LLMTaskDefinition {
  version: string;
  temperature: number;
  maxTokens: number;
  taskClass: AITaskClass;
  purpose: string;
  promptSource: string;
  outputContract: string;
  quotaMetric?: 'radarAnalyses' | 'scriptGenerations';
  owner: string;
}

export const LLM_TASKS: Record<LLMTaskId, LLMTaskDefinition> = {
  radar_opportunity_analysis: {
    version: 'v1',
    temperature: 0.3,
    maxTokens: 2500,
    taskClass: 'balanced',
    purpose: 'Turn an analyzed source into 0-3 grounded content Ideas.',
    promptSource: 'server/radar.ts#buildPrompt',
    outputContract: 'JSON opportunities[] with title, topic, hook, coreIdea, whyInteresting, angle, evidence, relevance, recommendedFormat, alternativeFormats.',
    quotaMetric: 'radarAnalyses',
    owner: 'Radar Analysis',
  },
  radar_discovery_queries: {
    version: 'v1',
    temperature: 0.5,
    maxTokens: 1200,
    taskClass: 'economy',
    purpose: 'Generate discovery search queries from the active Radar profile.',
    promptSource: 'server/radar.ts discovery query generation',
    outputContract: 'Structured discovery query list.',
    owner: 'Discovery',
  },
  radar_discovery_plan: {
    version: 'v1',
    temperature: 0.5,
    maxTokens: 1800,
    taskClass: 'economy',
    purpose: 'Create a source-aware discovery search plan.',
    promptSource: 'server/radar.ts discovery plan generation',
    outputContract: 'JSON plan with youtube/web/x query arrays.',
    owner: 'Discovery',
  },
  radar_discovery_ranking: {
    version: 'v1',
    temperature: 0.2,
    maxTokens: 2200,
    taskClass: 'balanced',
    purpose: 'Rank and explain unhandled Discovery candidates against the user taste profile.',
    promptSource: 'server/radar.ts#rankRadarDiscoveryCandidates',
    outputContract: 'JSON ranked candidates with score/reason/eligibility metadata.',
    owner: 'Discovery',
  },
  radar_reference_analysis: {
    version: 'v1',
    temperature: 0.2,
    maxTokens: 900,
    taskClass: 'economy',
    purpose: 'Extract topics/angles from user-provided reference content.',
    promptSource: 'server/radar.ts reference analysis',
    outputContract: 'Structured topics/angles summary.',
    owner: 'Personalization',
  },
  radar_script_generation: {
    version: 'v1',
    temperature: 0.7,
    maxTokens: 2200,
    taskClass: 'quality',
    purpose: 'Create or regenerate an output from a Radar Idea in the requested format.',
    promptSource: 'server/radar.ts#buildRadarScriptPrompt',
    outputContract: 'Format-specific text output linked to the originating Idea.',
    quotaMetric: 'scriptGenerations',
    owner: 'Outputs',
  },
};

export function getLLMTaskRegistry() {
  return (Object.entries(LLM_TASKS) as Array<[LLMTaskId, LLMTaskDefinition]>).map(([id, task]) => ({
    id,
    ...task,
    operation: `${id}:${task.version}`,
    fallbackPolicy: 'task-class routing: configured free pool first, then paid Gemini and OpenAI only when explicitly allowed; BYOK stays on the selected provider/model',
  }));
}

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
