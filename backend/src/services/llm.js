import Anthropic from "@anthropic-ai/sdk";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

let mockAnthropicClient = null;

export function setAnthropicClientMock(mock) {
  mockAnthropicClient = mock;
}

export function getAnthropicClientMock() {
  return mockAnthropicClient;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

export function normalizeUrgency(urgency) {
  if (typeof urgency !== "string") return "MEDIUM";
  const normalized = urgency.trim().toUpperCase();
  if (["LOW", "MEDIUM", "HIGH"].includes(normalized)) {
    return normalized;
  }
  return "MEDIUM";
}

/**
 * Calls Claude and requires strict JSON back. If the model, network, or key
 * fails for any reason, we NEVER throw up to the route handler — booking
 * flows must not break because the LLM is down. Instead we return a safe
 * fallback object and mark it so the UI/DB can flag "AI summary unavailable".
 */
export async function callClaudeJSON(systemPrompt, userPrompt, fallback) {
  const activeClient = mockAnthropicClient || client;
  if (!activeClient) {
    console.warn("[llm] ANTHROPIC_API_KEY not set — returning fallback summary");
    return { ...fallback, _aiFailed: true };
  }
  try {
    const response = await activeClient.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...fallback, _aiFailed: true };
    }
    return { ...parsed, _aiFailed: false };
  } catch (err) {
    console.error("[llm] Claude call failed:", err.message);
    return { ...fallback, _aiFailed: true };
  }
}

/**
 * Pre-visit summary: analyses patient-submitted symptoms and returns
 * urgency + chief complaint + suggested questions for the doctor.
 */
export async function generatePreVisitSummary(symptomText) {
  const systemPrompt = `You are a clinical intake assistant. You NEVER diagnose.
Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:
{"urgency": "LOW" | "MEDIUM" | "HIGH", "chiefComplaint": string, "suggestedQuestions": [string, string, string]}`;

  const userPrompt = `Analyse these symptoms and return: urgency level (LOW / MEDIUM / HIGH), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptomText}`;

  const fallback = {
    urgency: "MEDIUM",
    chiefComplaint: typeof symptomText === "string" ? symptomText.slice(0, 140) : "Symptoms provided",
    suggestedQuestions: [
      "Could you describe when the symptoms started?",
      "Have you noticed anything that makes it better or worse?",
      "Are you currently taking any medication?",
    ],
  };

  const result = await callClaudeJSON(systemPrompt, userPrompt, fallback);

  // Validate and normalize urgency
  result.urgency = normalizeUrgency(result.urgency);
  if (!result.chiefComplaint || typeof result.chiefComplaint !== "string") {
    result.chiefComplaint = fallback.chiefComplaint;
  }
  if (!Array.isArray(result.suggestedQuestions) || result.suggestedQuestions.length === 0) {
    result.suggestedQuestions = fallback.suggestedQuestions;
  }

  return result;
}

/**
 * Post-visit summary: turns the doctor's clinical notes + prescription into
 * a patient-friendly explanation with a medication schedule and next steps.
 */
export async function generatePostVisitSummary(clinicalNotes, prescription) {
  const systemPrompt = `You are a medical communication assistant that explains clinical notes in
plain, warm, patient-friendly language (avoid jargon). Respond with ONLY valid JSON, no prose, no
markdown fences, matching exactly this shape:
{"summary": string, "medicationSchedule": [{"drug": string, "instructions": string}], "followUpSteps": [string]}`;

  const userPrompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps.
Clinical notes: ${clinicalNotes}
Prescription: ${JSON.stringify(prescription)}`;

  const fallback = {
    summary:
      "Your doctor has recorded notes from your visit. Please refer to your prescription for medication details, and contact the clinic if you have questions.",
    medicationSchedule: (prescription || []).map((p) => ({
      drug: p.drug,
      instructions: `${p.dose}, ${p.frequency}, for ${p.days} day(s)`,
    })),
    followUpSteps: ["Contact the clinic if symptoms persist or worsen."],
  };

  return callClaudeJSON(systemPrompt, userPrompt, fallback);
}
