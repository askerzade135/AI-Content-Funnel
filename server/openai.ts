export const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';

export interface OpenAIResponseRequest {
  model?: string;
  input: string;
  instructions?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: string | Record<string, unknown>;
  include?: string[];
  signal?: AbortSignal;
  apiKey?: string;
}

export interface OpenAITextResult {
  model: string;
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw: any;
}

function openAIKey(override?: string): string {
  const key = override?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    const error: any = new Error('OpenAI provider is not configured');
    error.status = 503;
    throw error;
  }
  return key;
}

function safeOpenAIError(status: number): Error {
  const error: any = new Error(`OpenAI API request failed with HTTP ${status}`);
  error.status = status;
  return error;
}

export function extractOpenAIOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== 'message') continue;
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part?.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

export async function callOpenAIResponses(request: OpenAIResponseRequest): Promise<any> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAIKey(request.apiKey)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model || DEFAULT_OPENAI_MODEL,
      input: request.input,
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
      ...(typeof request.maxOutputTokens === 'number' ? { max_output_tokens: request.maxOutputTokens } : {}),
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.include?.length ? { include: request.include } : {}),
    }),
    signal: request.signal,
  });

  if (!response.ok) throw safeOpenAIError(response.status);
  const payload = await response.json();
  if (payload?.status === 'incomplete') {
    const error: any = new Error('OpenAI response was incomplete');
    error.status = 502;
    throw error;
  }
  return payload;
}

export async function generateOpenAIText(request: Omit<OpenAIResponseRequest, 'tools' | 'toolChoice' | 'include'>): Promise<OpenAITextResult> {
  const model = request.model || DEFAULT_OPENAI_MODEL;
  const raw = await callOpenAIResponses({ ...request, model });
  const text = extractOpenAIOutputText(raw);
  if (!text) {
    const error: any = new Error('OpenAI returned an empty response');
    error.status = 502;
    throw error;
  }
  const usage = raw?.usage || {};
  return {
    model,
    text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    raw,
  };
}
