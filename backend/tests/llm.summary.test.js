import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrgency,
  generatePreVisitSummary,
  generatePostVisitSummary,
  setAnthropicClientMock,
} from '../src/services/llm.js';

describe('Phase 4: LLM & Urgency Tests', () => {
  after(() => {
    setAnthropicClientMock(null);
  });

  beforeEach(() => {
    setAnthropicClientMock(null);
  });

  it('correctly normalizes valid, lowercase, and whitespace urgency values', () => {
    assert.equal(normalizeUrgency('LOW'), 'LOW');
    assert.equal(normalizeUrgency('MEDIUM'), 'MEDIUM');
    assert.equal(normalizeUrgency('HIGH'), 'HIGH');

    // Lowercase
    assert.equal(normalizeUrgency('low'), 'LOW');
    assert.equal(normalizeUrgency('medium'), 'MEDIUM');
    assert.equal(normalizeUrgency('high'), 'HIGH');

    // Whitespace
    assert.equal(normalizeUrgency('  HIGH  '), 'HIGH');
    assert.equal(normalizeUrgency('\nmedium\t'), 'MEDIUM');

    // Invalid values default to MEDIUM
    assert.equal(normalizeUrgency('CRITICAL'), 'MEDIUM');
    assert.equal(normalizeUrgency('EMERGENCY'), 'MEDIUM');
    assert.equal(normalizeUrgency(''), 'MEDIUM');
    assert.equal(normalizeUrgency(null), 'MEDIUM');
    assert.equal(normalizeUrgency(undefined), 'MEDIUM');
  });

  it('handles valid structured JSON response from Claude mock', async () => {
    setAnthropicClientMock({
      messages: {
        create: async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                urgency: 'HIGH',
                chiefComplaint: 'Acute chest pain radiating to left arm',
                suggestedQuestions: [
                  'When did the pain start?',
                  'Are you experiencing shortness of breath?',
                  'Do you have a history of heart disease?',
                ],
              }),
            },
          ],
        }),
      },
    });

    const result = await generatePreVisitSummary('Chest pain for 30 minutes');
    assert.equal(result.urgency, 'HIGH');
    assert.equal(result.chiefComplaint, 'Acute chest pain radiating to left arm');
    assert.equal(result.suggestedQuestions.length, 3);
    assert.equal(result._aiFailed, false);
  });

  it('handles markdown code fences in Claude response', async () => {
    setAnthropicClientMock({
      messages: {
        create: async () => ({
          content: [
            {
              type: 'text',
              text: '```json\n{"urgency": "low", "chiefComplaint": "Mild headache", "suggestedQuestions": ["Q1", "Q2", "Q3"]}\n```',
            },
          ],
        }),
      },
    });

    const result = await generatePreVisitSummary('Mild headache after working');
    assert.equal(result.urgency, 'LOW');
    assert.equal(result.chiefComplaint, 'Mild headache');
    assert.equal(result._aiFailed, false);
  });

  it('gracefully falls back on malformed JSON, API failure, or timeout without throwing', async () => {
    // 1. Malformed JSON
    setAnthropicClientMock({
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: 'This is not valid JSON at all.' }],
        }),
      },
    });
    const malformedResult = await generatePreVisitSummary('Fever and cough');
    assert.equal(malformedResult.urgency, 'MEDIUM');
    assert.equal(malformedResult._aiFailed, true);
    assert.ok(malformedResult.chiefComplaint);
    assert.ok(malformedResult.suggestedQuestions.length >= 1);

    // 2. Anthropic API Error (e.g. 500, Rate Limit, Auth Failure)
    setAnthropicClientMock({
      messages: {
        create: async () => {
          throw new Error('Anthropic API 429 Rate Limit Exceeded');
        },
      },
    });
    const errorResult = await generatePreVisitSummary('Sore throat');
    assert.equal(errorResult.urgency, 'MEDIUM');
    assert.equal(errorResult._aiFailed, true);

    // 3. Post-visit summary fallback on error
    const postVisitResult = await generatePostVisitSummary('Patient has bronchitis', [{ drug: 'Amoxicillin', dose: '500mg', frequency: 'twice daily', days: 5 }]);
    assert.equal(postVisitResult._aiFailed, true);
    assert.ok(postVisitResult.summary);
    assert.ok(postVisitResult.medicationSchedule.length === 1);
  });
});
