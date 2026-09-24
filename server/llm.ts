import { addGeminiUsageLog, calculateTokenCost } from './storage.js';
import { DEFAULT_OPENAI_MODEL, generateOpenAIText } from './openai.js';

export type LLMProviderId = 'gemini' | 'groq' | 'openrouter' | 'openai';
export type OpenAICompatibleProviderId = Exclude<LLMProviderId, 'gemini' | 'openai'>;
export type AIBillingPhase = 'free' | 'paid' | 'byok';
export type AITaskClass = 'economy' | 'balanced' | 'quality' | 'multimodal';

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';

function normalizeGeminiModel(model?: string): string {
  if (!model || model === 'gemini-2.5-flash') return DEFAULT_GEMINI_MODEL;
  return model;
}

export interface LLMGenerateOptions {
  provider?: LLMProviderId;
  model?: string;
  system?: string;
  prompt?: string;
  contents?: any[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  operation?: string;
  ownerId?: string;
}

export interface LLMResponse {
  provider: LLMProviderId;
  model: string;
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
}

export interface AIRouteResponse extends LLMResponse {
  billingPhase: AIBillingPhase;
  latencyMs: number;
  fallbackReason?: string;
}

export interface LLMProviderConfig {
  id: LLMProviderId;
  name: string;
  configured: boolean;
  models: string[];
  supportsLongContext: boolean;
  freeTierNote: string;
}

interface OpenAICompatibleProviderConfig {
  id: OpenAICompatibleProviderId;
  name: string;
  endpoint: string;
  envKey: 'GROQ_API_KEY' | 'OPENROUTER_API_KEY';
  defaultModel: string;
  models: string[];
  headers?: Record<string, string>;
  supportsLongContext: boolean;
  freeTierNote: string;
}

const OPENAI_COMPATIBLE_PROVIDERS: Record<OpenAICompatibleProviderId, OpenAICompatibleProviderConfig> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-20b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    supportsLongContext: true,
    freeTierNote: 'Groq platform quota is treated as a free/included routing pool until provider billing metadata is wired in.',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'openrouter/free',
    models: ['openrouter/free'],
    headers: {
      'HTTP-Referer': 'https://ai-content-funnel.app',
      'X-Title': 'AI Content Funnel',
    },
    supportsLongContext: true,
    freeTierNote: 'OpenRouter free route is part of the free/included routing pool.',
  },
};

const PROVIDER_DEFAULTS: Record<LLMProviderId, Omit<LLMProviderConfig, 'configured'>> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    models: [DEFAULT_GEMINI_MODEL],
    supportsLongContext: true,
    freeTierNote: 'Google provides a free API tier for selected models; limits depend on model/project.',
  },
  groq: {
    id: 'groq',
    name: OPENAI_COMPATIBLE_PROVIDERS.groq.name,
    models: OPENAI_COMPATIBLE_PROVIDERS.groq.models,
    supportsLongContext: OPENAI_COMPATIBLE_PROVIDERS.groq.supportsLongContext,
    freeTierNote: OPENAI_COMPATIBLE_PROVIDERS.groq.freeTierNote,
  },
  openrouter: {
    id: 'openrouter',
    name: OPENAI_COMPATIBLE_PROVIDERS.openrouter.name,
    models: OPENAI_COMPATIBLE_PROVIDERS.openrouter.models,
    supportsLongContext: OPENAI_COMPATIBLE_PROVIDERS.openrouter.supportsLongContext,
    freeTierNote: OPENAI_COMPATIBLE_PROVIDERS.openrouter.freeTierNote,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: [DEFAULT_OPENAI_MODEL],
    supportsLongContext: true,
    freeTierNote: 'OpenAI is a paid fallback and is used only when paid fallback is explicitly enabled.',
  },
};

export interface LLMKeySettings {
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
}

function getUserApiKey(provider: LLMProviderId, settings: LLMKeySettings): string | undefined {
  if (provider === 'gemini') return settings.geminiApiKey;
  if (provider === 'groq') return settings.groqApiKey;
  if (provider === 'openrouter') return settings.openrouterApiKey;
  return undefined;
}

function getPlatformApiKey(provider: LLMProviderId): string | undefined {
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  return process.env[OPENAI_COMPATIBLE_PROVIDERS[provider].envKey];
}

export function isPlatformProviderConfigured(provider: LLMProviderId): boolean {
  return Boolean(getPlatformApiKey(provider));
}

export function getLLMProviderConfigs(settings: LLMKeySettings): LLMProviderConfig[] {
  return (Object.keys(PROVIDER_DEFAULTS) as LLMProviderId[]).map((id) => ({
    ...PROVIDER_DEFAULTS[id],
    configured: Boolean(getUserApiKey(id, settings) || getPlatformApiKey(id)),
  }));
}

function getApiKey(provider: LLMProviderId, settings: LLMKeySettings): string {
  const key = getUserApiKey(provider, settings) || getPlatformApiKey(provider);
  if (!key) {
    throw new Error(`LLM provider "${provider}" is not configured. Add its API key in Settings.`);
  }
  return key;
}

async function generateOpenAICompatible(
  provider: OpenAICompatibleProviderId,
  options: LLMGenerateOptions,
  settings: LLMKeySettings,
): Promise<LLMResponse> {
  const config = OPENAI_COMPATIBLE_PROVIDERS[provider];
  const apiKey = getApiKey(provider, settings);
  const model = options.model || config.defaultModel;
  const prompt = options.prompt || '';
  const messages = [
    ...(options.system ? [{ role: 'system', content: options.system }] : []),
    { role: 'user', content: prompt },
  ];

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(config.headers || {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 3000,
    }),
    signal: options.signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    const error: any = new Error(`${provider} API ${response.status}: ${raw.slice(0, 800)}`);
    error.status = response.status;
    throw error;
  }

  const data = JSON.parse(raw);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${provider} returned an empty response`);

  const usage = data?.usage;
  return {
    provider,
    model,
    text,
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  };
}

export async function generateWithProvider(
  options: LLMGenerateOptions,
  settings: LLMKeySettings,
): Promise<LLMResponse> {
  const provider = options.provider || 'gemini';

  if (provider === 'openai') {
    if (options.contents) throw new Error('openai does not support the multimodal payload used by this task');
    const result = await generateOpenAIText({
      model: options.model || DEFAULT_OPENAI_MODEL,
      input: options.prompt || '',
      instructions: options.system,
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      signal: options.signal,
    });
    return {
      provider: 'openai',
      model: result.model,
      text: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
    };
  }

  if (provider !== 'gemini') {
    if (options.contents) throw new Error(`${provider} does not support the multimodal payload used by this task`);
    return generateOpenAICompatible(provider, options, settings);
  }

  const { GoogleGenAI } = await import('@google/genai');
  const apiKey = getApiKey('gemini', settings);
  const ai = new GoogleGenAI({ apiKey });
  const model = normalizeGeminiModel(options.model);

  const response = await ai.models.generateContent({
    model,
    contents: options.contents || options.prompt || '',
  });

  if (!response.text) throw new Error('Gemini returned an empty response');

  const usage = response.usageMetadata;
  return {
    provider: 'gemini',
    model,
    text: response.text,
    inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    thoughtsTokens: (usage as any)?.thoughtsTokenCount,
    totalTokens: usage?.totalTokenCount,
  };
}

interface AIRouteCandidate {
  provider: LLMProviderId;
  model: string;
  phase: Exclude<AIBillingPhase, 'byok'>;
}

const GEMINI_FREE_ECONOMY = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

const GEMINI_FREE_QUALITY = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

const GEMINI_PAID_ECONOMY = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
];

const GEMINI_PAID_QUALITY = [
  'gemini-3.1-pro-preview',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

function platformCandidates(taskClass: AITaskClass, allowPaidFallback: boolean): AIRouteCandidate[] {
  const free: AIRouteCandidate[] = [];

  if (taskClass === 'multimodal') {
    for (const model of GEMINI_FREE_QUALITY) free.push({ provider: 'gemini', model, phase: 'free' });
  } else if (taskClass === 'quality') {
    free.push({ provider: 'groq', model: 'openai/gpt-oss-120b', phase: 'free' });
    for (const model of GEMINI_FREE_QUALITY) free.push({ provider: 'gemini', model, phase: 'free' });
    free.push({ provider: 'openrouter', model: 'openrouter/free', phase: 'free' });
    free.push({ provider: 'groq', model: 'openai/gpt-oss-20b', phase: 'free' });
  } else if (taskClass === 'balanced') {
    free.push({ provider: 'groq', model: 'openai/gpt-oss-20b', phase: 'free' });
    for (const model of GEMINI_FREE_QUALITY) free.push({ provider: 'gemini', model, phase: 'free' });
    free.push({ provider: 'openrouter', model: 'openrouter/free', phase: 'free' });
  } else {
    free.push({ provider: 'openrouter', model: 'openrouter/free', phase: 'free' });
    free.push({ provider: 'groq', model: 'openai/gpt-oss-20b', phase: 'free' });
    for (const model of GEMINI_FREE_ECONOMY) free.push({ provider: 'gemini', model, phase: 'free' });
  }

  const configuredFree = free.filter(candidate => isPlatformProviderConfigured(candidate.provider));
  if (!allowPaidFallback) return configuredFree;

  const paid: AIRouteCandidate[] = [];
  if (isPlatformProviderConfigured('gemini')) {
    const paidModels = taskClass === 'quality' || taskClass === 'multimodal'
      ? GEMINI_PAID_QUALITY
      : GEMINI_PAID_ECONOMY;
    paid.push(...paidModels.map(model => ({ provider: 'gemini' as const, model, phase: 'paid' as const })));
  }
  if (taskClass !== 'multimodal' && isPlatformProviderConfigured('openai')) {
    paid.push({ provider: 'openai', model: DEFAULT_OPENAI_MODEL, phase: 'paid' });
  }
  return [...configuredFree, ...paid];
}

function conciseFallbackReason(error: any): string {
  const status = error?.status ? String(error.status) : '';
  const message = String(error?.message || error || 'unknown error');
  if (status === '429' || message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) return 'quota_exhausted';
  if (status === '404' || message.includes('404') || message.includes('NOT_FOUND')) return 'model_unavailable';
  if (status === '503' || message.includes('503') || message.includes('UNAVAILABLE')) return 'provider_unavailable';
  return message.slice(0, 160);
}

export interface AIRouteOptions {
  taskClass: AITaskClass;
  operation: string;
  ownerId?: string;
  prompt?: string;
  contents?: any[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  allowPaidFallback?: boolean;
  byok?: {
    provider: LLMProviderId;
    model?: string;
    keys: LLMKeySettings;
  };
  videoId?: string;
  videoTitle?: string;
}

export async function routeAI(options: AIRouteOptions): Promise<AIRouteResponse> {
  if (options.signal?.aborted) throw new Error('Операция отменена пользователем');

  if (options.byok) {
    const startedAt = Date.now();
    const response = await generateWithProvider({
      provider: options.byok.provider,
      model: options.byok.model,
      prompt: options.prompt,
      contents: options.contents,
      system: options.system,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
      operation: options.operation,
      ownerId: options.ownerId,
    }, options.byok.keys);

    const latencyMs = Date.now() - startedAt;
    await addGeminiUsageLog({
      timestamp: new Date().toISOString(),
      provider: response.provider,
      model: response.model,
      isPaid: false,
      billingPhase: 'byok',
      operation: options.operation,
      latencyMs,
      success: true,
      videoId: options.videoId,
      videoTitle: options.videoTitle,
      promptTokens: response.inputTokens || 0,
      candidatesTokens: response.outputTokens || 0,
      thoughtsTokens: response.thoughtsTokens || 0,
      totalTokens: response.totalTokens || 0,
      estimatedCostUsd: 0,
    }, options.ownerId);

    return { ...response, billingPhase: 'byok', latencyMs };
  }

  const candidates = platformCandidates(options.taskClass, Boolean(options.allowPaidFallback));
  if (!candidates.length) {
    throw new Error('No AI provider is configured for this task.');
  }

  let lastError: any = null;
  let previousFailure: string | undefined;

  for (const candidate of candidates) {
    if (options.signal?.aborted) throw new Error('Операция отменена пользователем');

    const startedAt = Date.now();
    try {
      const response = await generateWithProvider({
        provider: candidate.provider,
        model: candidate.model,
        prompt: options.prompt,
        contents: options.contents,
        system: options.system,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        signal: options.signal,
        operation: options.operation,
        ownerId: options.ownerId,
      }, {});

      const latencyMs = Date.now() - startedAt;
      const isPaid = candidate.phase === 'paid';
      const cost = response.provider === 'gemini'
        ? calculateTokenCost(
            response.model,
            isPaid,
            response.inputTokens || 0,
            response.outputTokens || 0,
            response.thoughtsTokens || 0,
          )
        : 0;

      await addGeminiUsageLog({
        timestamp: new Date().toISOString(),
        provider: response.provider,
        model: response.model,
        isPaid,
        billingPhase: candidate.phase,
        operation: options.operation,
        latencyMs,
        fallbackReason: previousFailure,
        success: true,
        videoId: options.videoId,
        videoTitle: options.videoTitle,
        promptTokens: response.inputTokens || 0,
        candidatesTokens: response.outputTokens || 0,
        thoughtsTokens: response.thoughtsTokens || 0,
        totalTokens: response.totalTokens || 0,
        estimatedCostUsd: cost,
      }, options.ownerId);

      return {
        ...response,
        billingPhase: candidate.phase,
        latencyMs,
        fallbackReason: previousFailure,
      };
    } catch (error: any) {
      if (options.signal?.aborted || error?.name === 'AbortError' || error?.message === 'Операция отменена пользователем') {
        throw new Error('Операция отменена пользователем');
      }

      lastError = error;
      const failureCode = conciseFallbackReason(error);
      previousFailure = `${candidate.provider}/${candidate.model}:${failureCode}`;
      await addGeminiUsageLog({
        timestamp: new Date().toISOString(),
        provider: candidate.provider,
        model: candidate.model,
        isPaid: candidate.phase === 'paid',
        billingPhase: candidate.phase,
        operation: options.operation,
        latencyMs: Date.now() - startedAt,
        fallbackReason: previousFailure,
        success: false,
        errorCode: failureCode,
        videoId: options.videoId,
        videoTitle: options.videoTitle,
        promptTokens: 0,
        candidatesTokens: 0,
        thoughtsTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      }, options.ownerId);
      console.warn(
        `[AI Router] ${options.operation} failed on ${candidate.phase} ${candidate.provider}/${candidate.model}; trying next candidate. ${error?.message || error}`
      );
    }
  }

  const error: any = lastError instanceof Error
    ? lastError
    : new Error(`All AI candidates failed for ${options.operation}`);
  error.isQuotaExceeded = previousFailure?.includes('quota_exhausted') || false;
  throw error;
}
