const BedrockProvider = require('./providers/bedrock');
const AnthropicProvider = require('./providers/anthropic');
const OpenAICompatibleProvider = require('./providers/openai-compatible');
const models = require('./models');

const ABSOLUTE_MAX_MESSAGES = 50;
// Practice sessions are cost-bounded: 10 student messages regardless of the
// assignment's own limits (still further capped by any lower max_messages).
const PRACTICE_MAX_MESSAGES = 10;

const providers = {
  bedrock: BedrockProvider,
  anthropic: AnthropicProvider,
  'openai-compatible': OpenAICompatibleProvider,
};

// The provider is an instance-level setting; a provider or region saved on
// an assignment (older data, imported content) is ignored.
function getProvider(config = {}) {
  const providerName = models.currentProvider();
  const ProviderClass = providers[providerName];

  if (!ProviderClass) {
    throw new Error(`Unknown AI provider "${providerName}". Set AI_PROVIDER to one of: ${Object.keys(providers).join(', ')}.`);
  }
  if (!config.model) {
    const err = new Error('No AI model is configured. An administrator must choose a default model in the instance settings.');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  return new ProviderClass(config);
}

function getProviderForAssignment(assignment) {
  const aiConfig = assignment.ai_provider_config || {};
  return getProvider({
    model: aiConfig.model || models.defaultModel(),
    region: process.env.AWS_BEDROCK_REGION,
  });
}

// Evaluation runs on a strong model independent of the assignment's chat
// model: an instructor picking Haiku to keep conversation costs down should
// not silently get Haiku as the grader. Evaluation is ~8-10% of session cost.
// Resolution: assignment grading_model > AI_GRADING_MODEL env > chat model.
function getGradingProviderForAssignment(assignment) {
  const aiConfig = assignment.ai_provider_config || {};
  return getProvider({
    model: aiConfig.grading_model || models.defaultGradingModel() || aiConfig.model,
    region: process.env.AWS_BEDROCK_REGION,
  });
}

function buildSystemPrompt(assignment) {
  if (!assignment) {
    return 'You are a helpful AI simulation assistant. Engage in conversation with the student.';
  }

  const isLLMInteraction = assignment.assignment_type === 'llm_interaction';
  const isExaminer = assignment.assignment_type === 'ai_examiner'
    && assignment.examiner_config?.question_areas?.length > 0;
  const parts = [];

  if (isExaminer) {
    // The AI leads: works through instructor-defined question areas in order,
    // probing follow-ups per area. Coverage markers are stripped server-side
    // before the student sees the reply.
    const cfg = assignment.examiner_config;
    const covered = new Set(Array.isArray(assignment._covered_areas) ? assignment._covered_areas : []);
    const isDebrief = cfg.style === 'debrief';

    parts.push(isDebrief
      ? 'You are a supportive reflection coach leading a structured debrief conversation. Your goal is to help the student think deeply about their own experience and reasoning — you draw insight out of them rather than lecture.'
      : 'You are a rigorous but fair oral examiner. You assess the student\'s understanding by questioning — you never teach, never reveal correct answers, and never confirm or deny whether an answer is right during the exam.');

    if (assignment.persona_name) parts.push(`Your name is ${assignment.persona_name}.`);
    if (assignment.system_prompt) parts.push(assignment.system_prompt);

    const areaList = cfg.question_areas.map((a, i) =>
      `${i + 1}. [id: ${a.id}] ${a.topic}${covered.has(a.id) ? ' (ALREADY COVERED — do not return to it)' : ''}${a.guidance ? `\n   Guidance: ${a.guidance}` : ''}\n   Follow-up depth: probe unclear or shallow answers up to ${a.followup_depth} time${a.followup_depth === 1 ? '' : 's'} before moving on.`
    ).join('\n');

    parts.push(`QUESTION AREAS (work through them in order, skipping any marked already covered):
${areaList}

CONDUCT RULES:
1. Ask exactly ONE question per message. Keep messages short (1-3 sentences).
2. Start each area with an opening question; based on the student's answer, probe with follow-ups up to that area's depth, then move on.
3. ${isDebrief
    ? 'Draw the student out: "what would you do differently?", "walk me through your thinking". Affirm reflection effort, but push past superficial answers.'
    : 'Never reveal, confirm, or hint at correct answers — not even partially, and not when the student asks directly ("that\'s not something I can tell you during the exam"). Stay neutral about answer quality.'}
4. If the student stalls, is off-topic, or asks you to skip ahead, redirect politely to the current question.
5. THE MARKER: when you finish an area (its follow-ups exhausted or answered well) and are transitioning to the next, append the marker [[area_done:<id>]] at the very END of that message, using the area's id from the list above. The marker is invisible to the student. Emit at most one marker per message, and only when genuinely moving on.
6. After the final area's marker, tell the student they've covered everything and can now complete the session.`);
  } else if (isLLMInteraction) {
    // No persona — vanilla LLM interaction (e.g. prompt engineering, discipline tasks).
    if (assignment.system_prompt) {
      parts.push(assignment.system_prompt);
    } else {
      parts.push('You are a helpful AI assistant. The student is working through a learning activity that involves interacting with you. Respond naturally and helpfully to their messages.');
    }

    if (assignment.rubric && assignment.rubric.length > 0) {
      const taskList = assignment.rubric
        .map((c, i) => `${i + 1}. ${c.name}: ${c.description}`)
        .join('\n');
      parts.push(`\nThe student is being evaluated on whether they accomplish these tasks during this conversation:\n${taskList}`);
      parts.push('Respond to their messages on their own merits — do not coach them or list these tasks unless asked.');
    }
  } else {
    // Simulation (persona role-play). staged_simulation layers the current
    // stage's scene (and optional persona override) on top of the base setup;
    // currentStageIndex comes from session.data.current_stage via the caller.
    const isStaged = assignment.assignment_type === 'staged_simulation' && Array.isArray(assignment.stages) && assignment.stages.length > 0;
    const stageIndex = isStaged
      ? Math.min(Number(assignment._current_stage) || 0, assignment.stages.length - 1)
      : 0;
    const stage = isStaged ? assignment.stages[stageIndex] : null;
    const personaName = (stage?.persona_name) || assignment.persona_name;

    if (personaName || assignment.persona_description) {
      parts.push(`You are ${personaName || 'an AI character'}.`);
      if (assignment.persona_description) {
        parts.push(assignment.persona_description);
      }
    }

    if (assignment.system_prompt) {
      parts.push(assignment.system_prompt);
    }

    if (assignment.scenario_context) {
      parts.push(`\nScenario Context:\n${assignment.scenario_context}`);
    }

    if (stage) {
      parts.push(`\nThis simulation unfolds in ${assignment.stages.length} stages: ${assignment.stages.map((s, i) => `${i + 1}. ${s.title}`).join('; ')}.
The conversation is CURRENTLY in Stage ${stageIndex + 1}: ${stage.title}.
${stage.scene_context}
${stageIndex > 0 ? 'Earlier stages have already happened in this same conversation — treat everything above the most recent "[The scene shifts…]" line as the past. Stay grounded in the current stage\'s scene; refer back to earlier events naturally when relevant.' : ''}
${stage.persona_name && stage.persona_name !== assignment.persona_name ? `In this stage the student is speaking with ${stage.persona_name}. Play this character now, consistent with the scenario.` : ''}`);
    }

    if (assignment.rubric && assignment.rubric.length > 0) {
      const criteriaList = assignment.rubric
        .map((c, i) => `${i + 1}. ${c.name}: ${c.description}`)
        .join('\n');
      parts.push(`\nThe student should work toward these objectives:\n${criteriaList}`);
      parts.push('Guide the conversation naturally to help the student address these without explicitly listing them.');
    }
  }

  if (parts.length === 0) {
    return 'You are a helpful AI simulation assistant. Engage in conversation with the student.';
  }

  return parts.join('\n\n');
}

function getChatOptions(assignment) {
  const aiConfig = assignment?.ai_provider_config || {};
  return {
    // A live turn with a student: providers may trade depth for speed.
    purpose: 'conversation',
    temperature: aiConfig.temperature ?? 0.7,
    max_tokens: aiConfig.max_tokens ?? 2048,
    ...(aiConfig.top_p !== undefined && { top_p: aiConfig.top_p }),
  };
}

function checkCompletionConditions(assignment, interactionCount) {
  const conditions = assignment?.completion_conditions || {};
  const result = { shouldComplete: false, reason: null, canComplete: true, maxReached: false };

  const userMessageCount = Math.ceil(interactionCount / 2);
  // `assignment` is usually a session+assignment join row, so is_practice
  // (a session column) is visible here when present.
  const hardCap = assignment?.is_practice === true
    ? Math.min(PRACTICE_MAX_MESSAGES, ABSOLUTE_MAX_MESSAGES)
    : ABSOLUTE_MAX_MESSAGES;
  const effectiveMax = conditions.max_messages
    ? Math.min(conditions.max_messages, hardCap)
    : hardCap;

  if (conditions.min_messages && userMessageCount < conditions.min_messages) {
    result.canComplete = false;
    result.minMessages = conditions.min_messages;
  }

  if (userMessageCount >= effectiveMax) {
    result.shouldComplete = true;
    result.maxReached = true;
    result.reason = conditions.auto_complete ? 'auto_complete' : 'max_messages_reached';
  } else if (conditions.max_messages && userMessageCount >= conditions.max_messages) {
    result.shouldComplete = true;
    result.maxReached = true;
    result.reason = conditions.auto_complete ? 'auto_complete' : 'max_messages_reached';
  }

  result.effectiveMax = effectiveMax;
  result.userMessageCount = userMessageCount;

  return result;
}

const providerNames = () => Object.keys(providers);

module.exports = {
  providerNames,
  getProvider,
  getProviderForAssignment,
  getGradingProviderForAssignment,
  buildSystemPrompt,
  getChatOptions,
  checkCompletionConditions,
  ABSOLUTE_MAX_MESSAGES,
  PRACTICE_MAX_MESSAGES,
};
