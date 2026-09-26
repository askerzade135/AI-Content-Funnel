import { LLMTaskId } from './llm-tasks.js';

export interface LLMEvalResult {
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}

function parseJson(text: string): any {
  const cleaned = String(text || '').trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

export function evaluateLLMFixture(
  taskId: LLMTaskId,
  responseText: string,
  context?: { enabledFormats?: string[]; candidateIds?: string[] }
): LLMEvalResult {
  const checks: LLMEvalResult['checks'] = [];
  const add = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, detail });

  try {
    if (taskId === 'radar_script_generation') {
      add('non_empty_output', responseText.trim().length >= 40, 'Generated output should contain substantive text.');
      return { pass: checks.every(check => check.pass), checks };
    }

    const parsed = parseJson(responseText);
    add('valid_json', true);

    if (taskId === 'radar_opportunity_analysis') {
      const items = Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];
      add('opportunities_array', Array.isArray(parsed?.opportunities));
      add('max_three_opportunities', items.length <= 3);
      const required = items.every((item: any) =>
        String(item?.title || '').trim() &&
        String(item?.coreIdea || '').trim() &&
        Number.isFinite(Number(item?.relevance)) &&
        Number(item.relevance) >= 60 &&
        Number(item.relevance) <= 100
      );
      add('required_fields_and_relevance', required);
      const allowed = new Set(context?.enabledFormats || []);
      if (allowed.size) {
        add('recommended_format_allowed', items.every((item: any) => allowed.has(String(item?.recommendedFormat || ''))));
        add('alternative_formats_allowed', items.every((item: any) =>
          (Array.isArray(item?.alternativeFormats) ? item.alternativeFormats : []).every((format: unknown) => allowed.has(String(format)))
        ));
      }
      const keys = items.map((item: any) => `${String(item?.title || '').toLowerCase().trim()}|${String(item?.coreIdea || '').toLowerCase().trim()}`);
      add('no_duplicate_ideas', new Set(keys).size === keys.length);
      add('evidence_shape', items.every((item: any) => !item?.evidence || (Array.isArray(item.evidence) && item.evidence.length <= 3)));
    }

    if (taskId === 'radar_discovery_plan' || taskId === 'radar_discovery_queries') {
      const arrays = ['youtube', 'web', 'x'].filter(key => Array.isArray(parsed?.[key]));
      add('query_arrays_present', arrays.length > 0);
      add('non_empty_queries', arrays.every(key => parsed[key].every((query: unknown) => String(query).trim().length > 0)));
    }

    if (taskId === 'radar_discovery_ranking') {
      const rankings = Array.isArray(parsed?.rankings) ? parsed.rankings : [];
      add('rankings_array', Array.isArray(parsed?.rankings));
      const expectedIds = new Set(context?.candidateIds || []);
      if (expectedIds.size) {
        const returned = new Set(rankings.map((item: any) => String(item?.id || '')));
        add('one_ranking_per_candidate', expectedIds.size === returned.size && [...expectedIds].every(id => returned.has(id)));
      }
      add('ranking_contract', rankings.every((item: any) =>
        String(item?.id || '').trim() &&
        typeof item?.eligible === 'boolean' &&
        Number.isFinite(Number(item?.score)) &&
        Number(item.score) >= 0 &&
        Number(item.score) <= 100 &&
        String(item?.reason || '').trim()
      ));
      add('ineligible_score_cap', rankings.every((item: any) => item?.eligible !== false || Number(item?.score) < 40));
    }

    if (taskId === 'radar_reference_analysis') {
      const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
      const angles = Array.isArray(parsed?.angles) ? parsed.angles : [];
      add('reference_topics_or_angles', topics.length > 0 || angles.length > 0);
    }
  } catch (error: any) {
    add('valid_json', false, error?.message || 'Invalid JSON');
  }

  return { pass: checks.length > 0 && checks.every(check => check.pass), checks };
}
