import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateLLMFixture } from '../server/llm-evals.js';

test('Radar opportunity prompt contract accepts grounded multi-format fixture', () => {
  const fixture = JSON.stringify({
    opportunities: [{
      title: 'Why uncertainty creates conspiracy thinking',
      topic: 'Psychology',
      hook: 'A strong hook',
      coreIdea: 'A source-grounded thesis',
      whyInteresting: 'Matches the creator strategy',
      angle: 'Develop independently',
      evidence: ['Source note 1', 'Source note 2'],
      relevance: 88,
      recommendedFormat: 'article',
      alternativeFormats: ['short_video', 'post'],
    }],
  });
  const result = evaluateLLMFixture('radar_opportunity_analysis', fixture, {
    enabledFormats: ['article', 'short_video', 'post'],
  });
  assert.equal(result.pass, true, JSON.stringify(result.checks));
});

test('Radar opportunity eval catches duplicate Ideas and invalid formats', () => {
  const duplicate = {
    title: 'Same idea',
    coreIdea: 'Same core',
    relevance: 90,
    recommendedFormat: 'podcast_unknown',
  };
  const result = evaluateLLMFixture('radar_opportunity_analysis', JSON.stringify({
    opportunities: [duplicate, { ...duplicate }],
  }), { enabledFormats: ['article'] });
  assert.equal(result.pass, false);
  assert.equal(result.checks.find(check => check.name === 'no_duplicate_ideas')?.pass, false);
  assert.equal(result.checks.find(check => check.name === 'recommended_format_allowed')?.pass, false);
});

test('Discovery ranking eval enforces coverage and ineligible score cap', () => {
  const valid = evaluateLLMFixture('radar_discovery_ranking', JSON.stringify({
    rankings: [
      { id: 'a', eligible: true, score: 85, reason: 'Strong topic and quality match.' },
      { id: 'b', eligible: false, score: 20, reason: 'Outside active topic boundary.' },
    ],
  }), { candidateIds: ['a', 'b'] });
  assert.equal(valid.pass, true, JSON.stringify(valid.checks));

  const invalid = evaluateLLMFixture('radar_discovery_ranking', JSON.stringify({
    rankings: [{ id: 'a', eligible: false, score: 70, reason: 'Off topic.' }],
  }), { candidateIds: ['a', 'b'] });
  assert.equal(invalid.pass, false);
});

test('Script generation eval checks substance without brittle text snapshots', () => {
  assert.equal(evaluateLLMFixture('radar_script_generation', 'Short').pass, false);
  assert.equal(evaluateLLMFixture('radar_script_generation', 'A sufficiently substantive generated output that is long enough for the contract check.').pass, true);
});
