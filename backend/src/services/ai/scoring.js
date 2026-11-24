const aiIndex = require('./index');
const { logAiUsage } = require('../../utils/ai-usage');

// Thrown when the AI evaluator fails on a rubric-based assignment. Callers
// must NOT convert this into a participation score — a grading outage should
// surface as "evaluation pending/failed", never as a silently wrong grade in
// the LMS gradebook. The evaluate-and-complete route queues the session for
// the evaluation-retry worker; regrade routes surface the error to the
// instructor. Participation fallback survives only for rubric-less
// assignments, where it is the documented scoring behavior.
class EvaluationError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'EvaluationError';
    this.cause = cause;
  }
}

/**
 * Robustly extract JSON from AI response text.
 * Handles: raw JSON, markdown code fences, JSON embedded in prose.
 */
function extractJSON(text) {
  const trimmed = text.trim();

  // Strategy 1: direct parse
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // Strategy 2: strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {}
  }

  // Strategy 3: find outermost { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  // All strategies failed
  const preview = trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
  throw new Error(`Could not extract JSON from AI response. Preview: ${preview}`);
}

function buildExemplarsBlock(rubric, scoringEnabled) {
  const hasAny = rubric.some((c) => Array.isArray(c.exemplars) && c.exemplars.length > 0);
  if (!hasAny) return '';

  let block = `FEW-SHOT EXEMPLARS:\nThe following are example responses with expert explanations of why they scored where they did. Use these as calibration anchors for the student transcript above — when a criterion has exemplars, treat them as the ground truth for what each score level looks like in practice.\n\n`;

  rubric.forEach((criterion, ci) => {
    block += `Criterion ${ci + 1} (${criterion.name}):\n`;
    const exemplars = Array.isArray(criterion.exemplars) ? criterion.exemplars : [];
    if (exemplars.length === 0) {
      block += `  (no exemplars provided — evaluate using level descriptions alone)\n\n`;
      return;
    }
    exemplars.forEach((ex, ei) => {
      const letter = String.fromCharCode(65 + ei);
      const scorePart = scoringEnabled && ex.score != null ? ` (${ex.score} pts)` : '';
      const labelPart = ex.label ? ` — ${ex.label}` : '';
      block += `  Example ${letter}${labelPart}${scorePart}:\n`;
      block += `  """\n${ex.excerpt || ''}\n  """\n`;
      if (ex.explanation) {
        block += `  Why: ${ex.explanation}\n`;
      }
      block += `\n`;
    });
  });

  return block;
}

// LLM Interaction tasks are usually attempted by one specific prompt in the
// transcript; without explicit rules the grader credits the best moment
// anywhere in the session (see docs/Known-Limitations.md). Student prompts
// are numbered in the transcript and the grader must commit to an explicit
// task -> prompt mapping (mapped_prompts) BEFORE scoring. The mapping is
// semantic, not positional: students may attempt tasks out of order or ask
// clarifying questions in between.
function buildPerTaskGuidance(isLLMInteraction) {
  if (!isLLMInteraction) return '';
  return `PER-TASK GRADING RULES:
Student prompts in the transcript are numbered ([Prompt 1], [Prompt 2], ...). For each task, BEFORE scoring:
1. Identify which numbered student prompt(s) constitute the student's attempt at THAT task, and report them in the "mapped_prompts" field with a one-sentence "mapping_note" explaining the match.
2. Tasks may be attempted in any order, and a clarifying question followed by the real attempt counts as part of that attempt — map by content, not by position.
3. Grade the task on the quality of its mapped prompt(s) only. Do NOT award credit because a prompt mapped to a different task happens to demonstrate the same technique or skill well.
4. If the student made multiple distinct attempts at the same task, map them all and grade the attempt that best represents their final, deliberate effort at it.
5. If no prompt plausibly attempts a task, set "mapped_prompts": [] and assign the lowest level.

`;
}

// Coerce the grader's mapped_prompts/mapping_note to safe shapes: deduped
// integers within [1, promptCount], note capped. Applied to llm_interaction
// evaluations only — simulation criteria carry no mapping fields.
function sanitizeMapping(ev, promptCount) {
  if (!ev || typeof ev !== 'object') return ev;
  const raw = Array.isArray(ev.mapped_prompts) ? ev.mapped_prompts : [];
  const mapped = [...new Set(
    raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= promptCount)
  )].sort((a, b) => a - b);
  const note = typeof ev.mapping_note === 'string' ? ev.mapping_note.slice(0, 500) : '';
  return { ...ev, mapped_prompts: mapped, mapping_note: note };
}

// Coerce evidence_messages (deduped integers within [1, studentMessageCount])
// and confidence ('high'|'medium'|'low', else null) to safe shapes. Applied to
// every criterion evaluation regardless of assignment type.
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
function sanitizeEvidenceAndConfidence(ev, studentMessageCount) {
  if (!ev || typeof ev !== 'object') return ev;
  const raw = Array.isArray(ev.evidence_messages) ? ev.evidence_messages : [];
  const evidence = [...new Set(
    raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= studentMessageCount)
  )].sort((a, b) => a - b);
  const conf = typeof ev.confidence === 'string' ? ev.confidence.toLowerCase().trim() : '';
  const confidence = CONFIDENCE_LEVELS.includes(conf) ? conf : null;
  const note = typeof ev.confidence_note === 'string' ? ev.confidence_note.slice(0, 300) : '';
  return { ...ev, evidence_messages: evidence, confidence, confidence_note: note };
}

// Where a completed evaluation lands, given the assignment's release mode:
//   'immediate'         — released to the student right away (null)
//   'instructor_review' — always held as a draft ('pending_review')
//   'confidence_gated'  — immediate unless the grader reported low confidence
//                         on any criterion, in which case held for review.
// Confidence is self-reported by the grader; until the grading-agreement data
// (see grading_agreement table) validates it, confidence_gated is opt-in per
// assignment and clearly labeled experimental in the editor.
function resolveReviewStatus(feedbackReleaseMode, criteriaEvaluations) {
  const mode = feedbackReleaseMode || 'immediate';
  if (mode === 'instructor_review') return 'pending_review';
  if (mode === 'confidence_gated') {
    const hasLow = (criteriaEvaluations || []).some((c) => c?.confidence === 'low');
    return hasLow ? 'pending_review' : null;
  }
  return null;
}

// The model's arithmetic is not trusted: per-criterion scores are clamped to
// their rubric bounds and the total is recomputed as their sum. Falls back to
// the model's (clamped) total only when the criteria array carries no usable
// scores.
function reconcileScores(parsed, rubric, maxScore) {
  const evaluations = Array.isArray(parsed.criteria_evaluations) ? parsed.criteria_evaluations : [];
  const boundsById = new Map(rubric.map((c) => [c.id, Number(c.max_points)]));

  let anyScore = false;
  const criteriaEvaluations = evaluations.map((ev) => {
    if (!ev || typeof ev !== 'object') return ev;
    const raw = Number(ev.score);
    if (!Number.isFinite(raw)) return { ...ev, score: null };
    anyScore = true;
    const max = boundsById.get(ev.id);
    const upper = Number.isFinite(max) && max >= 0 ? max : maxScore;
    return { ...ev, score: Math.min(Math.max(raw, 0), upper) };
  });

  if (!anyScore) {
    return {
      criteriaEvaluations,
      totalScore: Math.min(Math.max(parsed.total_score || 0, 0), maxScore),
    };
  }

  const sum = criteriaEvaluations.reduce((acc, ev) => acc + (Number.isFinite(ev?.score) ? ev.score : 0), 0);
  const totalScore = Math.min(Math.max(sum, 0), maxScore);
  const reported = Number(parsed.total_score);
  if (Number.isFinite(reported) && Math.abs(reported - totalScore) > 0.01) {
    console.warn(`[scoring] total_score mismatch: model reported ${reported}, recomputed ${totalScore} from per-criterion scores`);
  }
  return { criteriaEvaluations, totalScore };
}

async function evaluateSession(assignment, messages, opts = {}) {
  const rubric = assignment.rubric || [];
  const maxScore = assignment.max_score || 100;
  const scoringEnabled = assignment.scoring_enabled !== false;
  const isLLMInteraction = assignment.assignment_type === 'llm_interaction';
  const isStaged = assignment.assignment_type === 'staged_simulation' && Array.isArray(assignment.stages) && assignment.stages.length > 0;
  const isExaminer = assignment.assignment_type === 'ai_examiner' && assignment.examiner_config?.question_areas?.length > 0;
  const artifactText = typeof opts.artifactText === 'string' && opts.artifactText.trim() ? opts.artifactText.trim() : null;
  const itemNoun = isLLMInteraction ? 'task' : 'criterion';
  const itemNounPlural = isLLMInteraction ? 'tasks' : 'criteria';
  const hasExemplars = rubric.some((c) => Array.isArray(c.exemplars) && c.exemplars.length > 0);

  // If no rubric, fall back to message-count scoring (scored) or null (scoreless)
  if (rubric.length === 0) {
    if (scoringEnabled) {
      return fallbackScoring(messages, maxScore);
    }
    return {
      score: null,
      criteria_evaluations: [],
      overall_feedback: 'Simulation completed.',
      fallback: true,
      scoring_enabled: false,
    };
  }

  const provider = aiIndex.getGradingProviderForAssignment(assignment);

  // Student messages are numbered in every transcript so the grader can cite
  // evidence by number ([Prompt N] for llm_interaction task mapping, which
  // doubles as evidence; [Message N] for simulations). AI turns stay unnumbered.
  let promptCount = 0;
  const userLabel = isLLMInteraction ? 'Prompt' : 'Message';
  const transcript = messages
    .map((m) => {
      if (m.role === 'user') {
        return `[${userLabel} ${++promptCount}] Student: ${m.content}`;
      }
      return `AI: ${m.content}`;
    })
    .join('\n\n');

  // Build evaluation prompt with full context
  let evalPrompt = '';

  evalPrompt += isLLMInteraction ? `ACTIVITY CONTEXT:\n` : `SIMULATION CONTEXT:\n`;
  if (assignment.title) {
    evalPrompt += `Assignment: ${assignment.title}\n`;
  }
  if (assignment.description) {
    evalPrompt += `Description: ${assignment.description}\n`;
  }
  if (!isLLMInteraction && assignment.persona_name) {
    evalPrompt += `AI Persona: ${assignment.persona_name}`;
    if (assignment.persona_description) {
      evalPrompt += ` — ${assignment.persona_description}`;
    }
    evalPrompt += '\n';
  }
  if (!isLLMInteraction && assignment.scenario_context) {
    evalPrompt += `Scenario: ${assignment.scenario_context}\n`;
  }
  if (isLLMInteraction) {
    evalPrompt += `Activity type: Open LLM interaction. The student was working through tasks by chatting with a general AI assistant (no persona role-play).\n`;
  }
  evalPrompt += '\n';

  evalPrompt += `TRANSCRIPT:\n${transcript}\n\n`;

  if (artifactText) {
    const artifactTitle = assignment.artifact_config?.title || 'Written artifact';
    evalPrompt += `STUDENT ARTIFACT (${artifactTitle}) — written by the student AFTER the conversation above:\n"""\n${artifactText}\n"""\n\n`;
  }

  if (isExaminer) {
    const areas = assignment.examiner_config.question_areas;
    evalPrompt += `EXAMINER STRUCTURE:
This was an AI-led ${assignment.examiner_config.style === 'debrief' ? 'debrief' : 'oral exam'}: the AI asked questions through ${areas.length} question areas: ${areas.map((a, i) => `Area ${i + 1} (${a.id}): ${a.topic}`).join('; ')}.
The AI's messages may end with [[area_done:<id>]] markers indicating it finished that area. When a criterion below names a specific area, grade it ONLY on the student's answers between that area's first question and its [[area_done]] marker (or the transcript end). Judge how the student handled follow-up probing — recovering well under probing is a strength.\n\n`;
  }

  if (isStaged) {
    evalPrompt += `STAGE STRUCTURE:\nThis simulation had ${assignment.stages.length} stages: ${assignment.stages.map((s, i) => `Stage ${i + 1}: ${s.title}`).join('; ')}.
Stage boundaries appear in the transcript as "[The scene shifts — Stage N: …]" lines. When a criterion below names a specific stage, grade it ONLY on the student's messages within that stage (between its marker — or the transcript start for Stage 1 — and the next marker).\n\n`;
  }

  // Per-criterion scope annotations (staged stage_id / artifact applies_to)
  const criterionScope = (criterion) => {
    const bits = [];
    if (isExaminer && criterion.question_area_id) {
      const area = assignment.examiner_config.question_areas.find((a) => a.id === criterion.question_area_id);
      if (area) bits.push(`applies ONLY to question area "${area.topic}" (${area.id})`);
    }
    if (isStaged && criterion.stage_id) {
      const idx = assignment.stages.findIndex((s) => s.id === criterion.stage_id);
      if (idx >= 0) bits.push(`applies ONLY to Stage ${idx + 1}: ${assignment.stages[idx].title}`);
    }
    if (artifactText && criterion.applies_to === 'artifact') {
      bits.push('graded ONLY on the student artifact');
    } else if (artifactText && criterion.applies_to === 'conversation') {
      bits.push('graded ONLY on the conversation, not the artifact');
    }
    return bits.length ? ` [${bits.join('; ')}]` : '';
  };

  const consistencyGuidance = artifactText
    ? `ARTIFACT CONSISTENCY CHECK:\nCompare the artifact's claims against the conversation. In "consistency_notes", report artifact claims that are NOT supported by (or that contradict) the transcript — e.g. the write-up says an allergy history was taken but no such exchange occurred. Report an empty array when everything is supported.\n\n`
    : '';
  const consistencyField = artifactText
    ? `\n  "consistency_notes": ["<one sentence per artifact claim not supported by the conversation; [] if none>"],`
    : '';

  // Extra per-criterion JSON fields for llm_interaction task mapping.
  const mappingFields = isLLMInteraction
    ? `, "mapped_prompts": [<numbers of the student prompts that attempt this task, e.g. 2>], "mapping_note": "<one sentence: which prompt(s) attempt this task and why>"`
    : '';

  // Evidence + confidence fields, required for every criterion on every type.
  const evidenceFields = `, "evidence_messages": [<numbers of the student ${isLLMInteraction ? 'prompts' : 'messages'} that most directly support this assessment, e.g. 3>], "confidence": "<high | medium | low>", "confidence_note": "<one short sentence explaining the uncertainty; empty string when confidence is high>"`;

  const evidenceGuidance = `EVIDENCE AND CONFIDENCE:
For each ${itemNoun}:
1. Report in "evidence_messages" the 1-3 numbered student ${isLLMInteraction ? 'prompts' : 'messages'} that most directly support your assessment. Use [] only if the student never addressed the ${itemNoun}.
2. Report "confidence": how likely another expert grader applying this same rubric would choose the same level. "high" = clear-cut; "medium" = defensible either way on wording; "low" = genuinely ambiguous, borderline between levels, or too little transcript evidence to judge. Be honest — "low" routes the session to the instructor, which is the correct outcome for ambiguous work.
3. When confidence is not "high", add one short sentence in "confidence_note" saying why.

`;

  if (scoringEnabled) {
    // Scored mode: include point values
    evalPrompt += isLLMInteraction ? `TASKS TO EVALUATE:\n` : `EVALUATION CRITERIA:\n`;
    rubric.forEach((criterion, i) => {
      evalPrompt += `${i + 1}. ${criterion.name} (ID: "${criterion.id}", max ${criterion.max_points} points): ${criterion.description}${criterionScope(criterion)}\n`;
      if (criterion.levels && criterion.levels.length > 0) {
        criterion.levels.forEach((level) => {
          evalPrompt += `   - ${level.label} (${level.score} pts): ${level.description}\n`;
        });
      }
    });
    evalPrompt += '\n';

    evalPrompt += buildExemplarsBlock(rubric, true);
    evalPrompt += buildPerTaskGuidance(isLLMInteraction);
    evalPrompt += evidenceGuidance;
    evalPrompt += consistencyGuidance;

    evalPrompt += `Evaluate the student's performance. For each ${itemNoun}, first reason briefly about which level the student's work maps to (referencing exemplars if provided), then assign a score and write 2-3 sentences of student-facing feedback with specific examples from the transcript.

Respond with ONLY a valid JSON object. Do NOT wrap it in markdown code fences. No backticks, no \`\`\`json blocks.

Required format:
{
  "criteria_evaluations": [${rubric.map((c) => `{"id": "${c.id}", "name": "${c.name}"${mappingFields}, "reasoning": "<1-2 sentences of grader rationale: which level and why, comparing to exemplars when available>"${evidenceFields}, "score": <number 0-${c.max_points}>, "level_achieved": "<level label>", "feedback": "<2-3 sentences of student-facing feedback with specific examples>"}`).join(', ')}],${consistencyField}
  "overall_feedback": "<2-3 sentence overall assessment of the student's performance>",
  "total_score": <number 0-${maxScore}>
}`;
  } else {
    // Scoreless mode: descriptions only, no point values
    evalPrompt += isLLMInteraction ? `TASKS TO EVALUATE:\n` : `EVALUATION CRITERIA:\n`;
    rubric.forEach((criterion, i) => {
      evalPrompt += `${i + 1}. ${criterion.name} (ID: "${criterion.id}"): ${criterion.description}${criterionScope(criterion)}\n`;
      if (criterion.levels && criterion.levels.length > 0) {
        criterion.levels.forEach((level) => {
          evalPrompt += `   - ${level.label}: ${level.description}\n`;
        });
      }
    });
    evalPrompt += '\n';

    evalPrompt += buildExemplarsBlock(rubric, false);
    evalPrompt += buildPerTaskGuidance(isLLMInteraction);
    evalPrompt += evidenceGuidance;
    evalPrompt += consistencyGuidance;

    evalPrompt += `Evaluate the student's performance. For each ${itemNoun}, first reason briefly about which level the student's work maps to (referencing exemplars if provided), then identify the level achieved and write 2-3 sentences of student-facing feedback with specific examples from the transcript.

Respond with ONLY a valid JSON object. Do NOT wrap it in markdown code fences. No backticks, no \`\`\`json blocks.

Required format:
{
  "criteria_evaluations": [${rubric.map((c) => `{"id": "${c.id}", "name": "${c.name}"${mappingFields}, "reasoning": "<1-2 sentences of grader rationale: which level and why, comparing to exemplars when available>"${evidenceFields}, "level_achieved": "<level label>", "feedback": "<2-3 sentences of student-facing feedback with specific examples>"}`).join(', ')}],${consistencyField}
  "overall_feedback": "<2-3 sentence overall assessment of the student's performance>"
}`;
  }

  const systemPrompt = hasExemplars
    ? 'You are a rigorous educational assessment expert. Evaluate student simulation transcripts against the provided rubric criteria. When exemplars are provided for a criterion, treat them as the ground truth for what each score level looks like in practice, and explicitly compare the student\'s work to them in your reasoning. You must respond with raw JSON only — no markdown formatting, no code fences, no explanation outside the JSON object. Be specific and reference the transcript in your feedback.'
    : 'You are a rigorous educational assessment expert. Evaluate student simulation transcripts against the provided rubric criteria. You must respond with raw JSON only — no markdown formatting, no code fences, no explanation outside the JSON object. Be specific and reference the transcript in your feedback.';

  if (hasExemplars) {
    const exemplarCount = rubric.reduce((n, c) => n + (Array.isArray(c.exemplars) ? c.exemplars.length : 0), 0);
    console.log(`[scoring] few-shot mode: ${exemplarCount} exemplars, prompt ${evalPrompt.length} chars`);
  }

  try {
    const result = await provider.evaluate({
      systemPrompt,
      messages: [{ role: 'user', content: evalPrompt }],
      options: { temperature: 0.1, max_tokens: hasExemplars ? 4608 : ((isLLMInteraction || artifactText) ? 3584 : 2560) },
    });

    logAiUsage({
      platform_id: assignment.platform_id,
      assignment_id: assignment.assignment_id || assignment.id,
      session_id: assignment._session_id || null,
      model_id: result.metadata?.model,
      call_type: 'evaluation',
      usage: result.usage,
    });

    const parsed = extractJSON(result.content);

    if (isLLMInteraction && Array.isArray(parsed.criteria_evaluations)) {
      parsed.criteria_evaluations = parsed.criteria_evaluations.map((ev) => sanitizeMapping(ev, promptCount));
    }

    if (Array.isArray(parsed.criteria_evaluations)) {
      parsed.criteria_evaluations = parsed.criteria_evaluations.map((ev) => {
        const clean = sanitizeEvidenceAndConfidence(ev, promptCount);
        // For llm_interaction the task->prompt mapping IS the evidence; fall
        // back to it when the grader left evidence_messages empty.
        if (isLLMInteraction && clean && clean.evidence_messages.length === 0 && Array.isArray(clean.mapped_prompts)) {
          return { ...clean, evidence_messages: clean.mapped_prompts };
        }
        return clean;
      });
    }

    const consistencyNotes = artifactText
      ? (Array.isArray(parsed.consistency_notes)
        ? parsed.consistency_notes.slice(0, 10).map((n) => String(n).slice(0, 400))
        : [])
      : undefined;

    if (scoringEnabled) {
      const { criteriaEvaluations, totalScore } = reconcileScores(parsed, rubric, maxScore);
      return {
        score: totalScore,
        criteria_evaluations: criteriaEvaluations,
        overall_feedback: parsed.overall_feedback || '',
        scoring_enabled: true,
        raw_ai_response: result.content,
        ...(consistencyNotes !== undefined && { consistency_notes: consistencyNotes }),
      };
    } else {
      return {
        score: null,
        criteria_evaluations: parsed.criteria_evaluations || [],
        overall_feedback: parsed.overall_feedback || '',
        scoring_enabled: false,
        raw_ai_response: result.content,
        ...(consistencyNotes !== undefined && { consistency_notes: consistencyNotes }),
      };
    }
  } catch (error) {
    console.error('AI evaluation failed:', error.message);
    if (error.message?.includes('Could not extract JSON')) {
      console.error('Raw AI response that failed parsing:', error.message);
    }
    // Rubric present (we only reach the AI call when it is): never fall back
    // to participation scoring — propagate so the caller can queue a retry.
    throw new EvaluationError(`AI evaluation failed: ${error.message}`, error);
  }
}

function fallbackScoring(messages, maxScore = 100) {
  const userMessages = messages.filter((m) => m.role === 'user');
  const score = Math.min(userMessages.length * 10, maxScore);
  return {
    score,
    criteria_evaluations: [],
    overall_feedback: `Score based on participation: ${userMessages.length} messages sent.`,
    fallback: true,
    scoring_enabled: true,
  };
}

module.exports = { evaluateSession, EvaluationError, resolveReviewStatus, extractJSON };
