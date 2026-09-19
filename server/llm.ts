export type LLMProviderId = 'gemini' | 'groq' | 'openrouter';
export type OpenAICompatibleProviderId = Exclude<LLMProviderId, 'gemini'>;

export interface LLMGenerateOptions {
  provider?: LLMProviderId;
  model?: string;
  system?: string;
  prompt: string;
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
  totalTokens?: number;
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
    freeTierNote: 'Groq Free tier has model-specific RPM/RPD/TPM/TPD limits.',
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
    freeTierNote: 'OpenRouter currently exposes free models with a platform-level free request limit.',
  },
};

const PROVIDER_DEFAULTS: Record<LLMProviderId, Omit<LLMProviderConfig, 'configured'>> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-3.8-flash'],
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
};

export interface LLMKeySettings {
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
}

function getUserApiKey(provider: LLMProviderId, settings: LLMKeySettings): string | undefined {
  if (provider === 'gemini') return settings.geminiApiKey;
  if (provider === 'groq') return settings.groqApiKey;
  return settings.openrouterApiKey;
}

function getPlatformApiKey(provider: LLMProviderId): string | undefined {
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
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
  const messages = [
    ...(options.system ? [{ role: 'system', content: options.system }] : []),
    { role: 'user', content: options.prompt },
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
    throw new Error(`${provider} API ${response.status}: ${raw.slice(0, 800)}`);
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

  if (provider !== 'gemini') {
    return generateOpenAICompatible(provider, options, settings);
  }

  // Gemini stays behind its native SDK so legacy multimodal/stage pipelines
  // are not changed by the Radar provider refactor.
  const { GoogleGenAI } = await import('@google/genai');
  const apiKey = getApiKey('gemini', settings);
  const ai = new GoogleGenAI({ apiKey });

  const model = options.model || 'gemini-2.5-flash';
  const response = await ai.models.generateContent({
    model,
    contents: options.prompt,
  });

  if (!response.text) throw new Error('Gemini returned an empty response');

  const usage = response.usageMetadata;
  return {
    provider: 'gemini',
    model,
    text: response.text,
    inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    totalTokens: usage?.totalTokenCount,
  };
}
