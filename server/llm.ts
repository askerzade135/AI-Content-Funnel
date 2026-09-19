export type LLMProviderId = 'gemini' | 'groq' | 'openrouter';

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
    name: 'Groq',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    supportsLongContext: true,
    freeTierNote: 'Groq Free tier has model-specific RPM/RPD/TPM/TPD limits.',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: ['openrouter/free'],
    supportsLongContext: true,
    freeTierNote: 'OpenRouter currently exposes free models with a platform-level free request limit.',
  },
};

export function getLLMProviderConfigs(settings: {
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
}): LLMProviderConfig[] {
  return (Object.keys(PROVIDER_DEFAULTS) as LLMProviderId[]).map((id) => ({
    ...PROVIDER_DEFAULTS[id],
    configured:
      id === 'gemini'
        ? Boolean(settings.geminiApiKey || process.env.GEMINI_API_KEY)
        : id === 'groq'
        ? Boolean(settings.groqApiKey || process.env.GROQ_API_KEY)
        : Boolean(settings.openrouterApiKey || process.env.OPENROUTER_API_KEY),
  }));
}

function getApiKey(provider: LLMProviderId, settings: {
  geminiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
}): string {
  const key =
    provider === 'gemini'
      ? settings.geminiApiKey || process.env.GEMINI_API_KEY
      : provider === 'groq'
      ? settings.groqApiKey || process.env.GROQ_API_KEY
      : settings.openrouterApiKey || process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error(`LLM provider "${provider}" is not configured. Add its API key in Settings.`);
  }
  return key;
}

async function generateOpenAICompatible(
  provider: 'groq' | 'openrouter',
  options: LLMGenerateOptions,
  settings: { groqApiKey?: string; openrouterApiKey?: string },
): Promise<LLMResponse> {
  const apiKey = getApiKey(provider, settings);
  const baseUrl =
    provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';

  const model =
    options.model ||
    (provider === 'groq' ? 'openai/gpt-oss-20b' : 'openrouter/free');

  const messages = [
    ...(options.system ? [{ role: 'system', content: options.system }] : []),
    { role: 'user', content: options.prompt },
  ];

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(provider === 'openrouter' ? {
        'HTTP-Referer': 'https://ai-content-funnel.app',
        'X-Title': 'AI Content Funnel',
      } : {}),
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
  settings: {
    geminiApiKey?: string;
    groqApiKey?: string;
    openrouterApiKey?: string;
  },
): Promise<LLMResponse> {
  const provider = options.provider || 'gemini';

  if (provider === 'groq' || provider === 'openrouter') {
    return generateOpenAICompatible(provider, options, settings);
  }

  // Gemini stays behind the existing implementation so legacy multimodal/stage pipelines
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
