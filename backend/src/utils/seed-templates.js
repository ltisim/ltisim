const pool = require('../config/database');

// The sample assignment gallery instructors see when a course has no
// assignments yet. Installed automatically on first boot; idempotent (skips
// any template whose title already exists). Also runnable by hand:
//   npm run templates:seed

const L = (labels, scores, descs) => labels.map((label, i) => ({ label, score: scores[i], description: descs[i] }));

const TEMPLATES = [
  {
    title: 'Patient Intake Interview',
    discipline: 'Nursing / Health',
    description: 'Students conduct an intake interview with an elderly patient who has a complicated medication history, is anxious, and tends to minimize symptoms. Assesses information gathering, communication, empathy, and clinical reasoning.',
    payload: {
      assignment_type: 'simulation',
      title: 'Patient Intake Interview',
      description: 'You are a nurse conducting an intake interview with Eleanor Vance, a 72-year-old patient referred for recurrent dizziness. Gather a complete history — including her full medication list — while keeping her comfortable and building trust. When you have what you need, complete the simulation for feedback.',
      welcome_message: "Oh, hello dear. They told me to wait in here... I hope this won't take long? My daughter is picking me up at three.",
      persona_name: 'Eleanor Vance',
      persona_description: 'Eleanor Vance is a 72-year-old retired school librarian referred by her GP for recurrent dizziness over the past month, including one near-fall. She is polite, chatty, and tangential — she drifts into stories about her garden and her late husband. She takes seven medications ("the little white one, the one for my heart...") but cannot name most of them, and she minimizes her symptoms because she is afraid of losing her independence ("it\'s really nothing, everyone gets dizzy"). She volunteers information about her daughter and her cat readily, but only reveals the near-fall, her occasional skipped doses ("they\'re so expensive"), and her two glasses of evening sherry if the student asks specific, non-judgmental follow-up questions. She becomes guarded if rushed or interrogated, and warms noticeably when the student acknowledges her feelings.',
      scenario_context: 'You are in an outpatient clinic intake room. Your GP referred you after you mentioned dizzy spells at your last checkup. You are worried this could lead to being told you can\'t live alone anymore, so you intend to downplay everything. You just want to get this over with, but if the nurse is kind and patient with you, you will gradually open up about the near-fall last Tuesday, the skipped blood-pressure pills, and the sherry. You do not know the names of your medications; you describe them by color and shape unless the student asks you to bring in the bottles or asks about a pharmacy list.',
      system_prompt: 'Never break character. Speak as a 72-year-old would — warm, a little rambling, occasionally tangential. Keep replies to 2-4 conversational sentences. Do not volunteer the near-fall, skipped doses, or alcohol use unless the student asks a relevant, specific question with a respectful tone. If the student is abrupt or uses heavy medical jargon, become shorter and more guarded until they repair rapport.',
      learning_content: null,
      max_score: 100,
      scoring_enabled: true,
      max_sessions: 2,
      feedback_release_mode: 'immediate',
      completion_conditions: { min_messages: 8, max_messages: 25, auto_complete: false },
      ai_provider_config: {},
      rubric: [
        {
          id: 'c1', name: 'Information Gathering', max_points: 30, exemplars: [],
          description: 'Elicits a complete, relevant history: symptom onset/frequency/triggers, the near-fall, full medication review (including adherence), and alcohol use. Uses open-ended questions and specific follow-ups.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [30, 22, 12, 0], [
            'Uncovers all four hidden findings (near-fall, skipped doses, alcohol use, unnamed medications) through specific, logical follow-up questions; asks at least three open-ended questions.',
            'Uncovers most hidden findings; questioning is mostly systematic with occasional missed follow-ups on cues the patient offered.',
            'Gathers surface history only; relies on yes/no questions; misses two or more hidden findings despite cues.',
            'Little meaningful history obtained; no follow-up on obvious cues.',
          ]),
        },
        {
          id: 'c2', name: 'Communication & Clarity', max_points: 25, exemplars: [],
          description: 'Uses plain language suited to the patient, one question at a time, checks understanding, and manages the pace despite tangents — redirecting gently without cutting the patient off.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Consistently plain language; single clear questions; redirects tangents gently at least once without damaging rapport; summarizes back to confirm understanding.',
            'Mostly clear and well-paced; occasional double-barreled questions or jargon; redirection attempted with mixed success.',
            'Frequent jargon or stacked questions; loses control of the interview to tangents, or redirects so bluntly the patient becomes guarded.',
            'Confusing, jargon-heavy, or interrogative throughout.',
          ]),
        },
        {
          id: 'c3', name: 'Empathy & Rapport', max_points: 25, exemplars: [],
          description: 'Acknowledges the patient\'s feelings (worry about independence, embarrassment about costs), responds to emotional cues, and maintains a respectful, unhurried tone.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Names or reflects the patient\'s emotions at least twice (e.g. "it sounds like you\'re worried about staying independent"); responds to cues before returning to tasks; the patient visibly opens up.',
            'Acknowledges emotion at least once; generally warm; occasionally pushes past a cue to stay on task.',
            'Task-focused with token pleasantries; misses clear emotional cues; patient stays guarded.',
            'Dismissive of or oblivious to the patient\'s feelings.',
          ]),
        },
        {
          id: 'c4', name: 'Clinical Reasoning & Safety', max_points: 20, exemplars: [],
          description: 'Connects findings (medication non-adherence, alcohol, dizziness, fall risk) and addresses safety: fall risk at home and the need for an accurate medication list.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [20, 15, 8, 0], [
            'Explicitly links at least two findings to the dizziness or fall risk; asks about home safety; proposes a concrete next step (bring in bottles, pharmacy list, or med review).',
            'Makes one clear clinical connection and at least one safety-oriented question or suggestion.',
            'Collects facts without connecting them; safety not addressed beyond generic advice.',
            'No evidence of clinical reasoning or safety awareness.',
          ]),
        },
      ],
    },
  },
  {
    title: 'Delivering Difficult Feedback',
    discipline: 'Management / Leadership',
    description: 'Students play a manager giving performance feedback to a talented but defensive senior engineer. Assesses specificity, candor with respect, handling defensiveness, and agreeing on a path forward.',
    payload: {
      assignment_type: 'simulation',
      title: 'Delivering Difficult Feedback',
      description: 'You manage Jordan Reyes, a senior engineer whose technical work is strong but who has missed the last three sprint deadlines and left dismissive code-review comments that two teammates have complained about. Hold a feedback conversation: be specific and honest, keep it respectful, and end with a concrete plan. Complete the simulation when the conversation reaches a natural close.',
      welcome_message: "Hey — you wanted to see me? I've only got a few minutes before the architecture sync, so... what's up?",
      persona_name: 'Jordan Reyes',
      persona_description: 'Jordan Reyes is a senior software engineer, eight years at the company, technically excellent and proud of it. Jordan has missed the last three sprint deadlines (each time with a plausible technical justification) and has left code-review comments like "did you even test this?" that two teammates separately reported. Jordan does not think there is a problem: the deadlines were "unrealistic" and the review comments are "just being direct — I hold a high bar." Initially confident and slightly impatient. Becomes defensive when criticized vaguely ("that\'s just not true — give me one example"), deflects to others\' shortcomings, and only engages genuinely when the manager is specific, acknowledges Jordan\'s strengths honestly, and holds the line calmly. If the manager stays vague or backs down, Jordan steamrolls the conversation and concedes nothing.',
      scenario_context: 'You are meeting your manager in a small conference room. You suspect this is about the deadlines, which annoys you because you believe the estimates were imposed without consulting you. You genuinely do not realize how your review comments land on junior teammates — from your side you are maintaining standards. You respect competence and directness; you lose respect for managers who waffle. If the manager gives you specific examples and stays respectful, you gradually concede the impact and can be brought to agree on concrete changes — but you will not accept vague accusations, and you will push back hard at least once early in the conversation.',
      system_prompt: 'Never break character. Keep replies to 2-4 sentences, spoken dialogue only. Push back with a specific counter-argument at least once in the first half of the conversation. Concede ground only in response to specific, evidence-based, respectful feedback — never in response to vague or purely positional statements. If the manager becomes aggressive or personal, become colder and consider ending the meeting.',
      learning_content: null,
      max_score: 100,
      scoring_enabled: true,
      max_sessions: 3,
      feedback_release_mode: 'immediate',
      completion_conditions: { min_messages: 6, max_messages: 20, auto_complete: false },
      ai_provider_config: {},
      rubric: [
        {
          id: 'c1', name: 'Specificity of Feedback', max_points: 25, exemplars: [],
          description: 'Grounds the feedback in concrete, observable examples (the three missed deadlines, the specific review comments and their reported impact) rather than generalities or character judgments.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Cites both issue areas with specific examples and describes impact on the team/business; separates behavior from character throughout.',
            'Cites at least one specific example per issue; mostly behavioral language with minor lapses into generalities.',
            'Raises the issues but mostly in vague terms ("your attitude", "the deadlines thing"); little concrete evidence.',
            'No specific examples; vague criticism or character labels only.',
          ]),
        },
        {
          id: 'c2', name: 'Candor with Respect', max_points: 25, exemplars: [],
          description: 'Delivers the hard message directly — no burying it, no false softening — while remaining respectful and acknowledging genuine strengths honestly rather than as a manipulation.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'States the problem plainly within the first few exchanges; acknowledges real strengths without diluting the message; tone stays professional under pushback.',
            'Message is delivered clearly, though somewhat delayed or slightly over-cushioned; respectful throughout.',
            'Message so hedged or sandwiched that its seriousness is unclear, OR direct but needlessly harsh.',
            'Avoids the message entirely, or is disrespectful/personal.',
          ]),
        },
        {
          id: 'c3', name: 'Handling Defensiveness', max_points: 25, exemplars: [],
          description: 'Responds to pushback by listening, acknowledging any legitimate points (e.g. imposed estimates), and returning calmly to the core message instead of escalating or capitulating.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Acknowledges the legitimate part of Jordan\'s pushback explicitly, then restates the expectation without backing down; stays calm through at least one hard rebuttal.',
            'Holds the core message under pushback with adequate composure; acknowledgment of Jordan\'s points is partial.',
            'Either escalates into argument or concedes key points to avoid conflict; the core message erodes.',
            'Loses the thread entirely: capitulates, or the exchange becomes hostile.',
          ]),
        },
        {
          id: 'c4', name: 'Actionable Path Forward', max_points: 25, exemplars: [],
          description: 'Closes with concrete, agreed next steps: specific behavior changes, a way to address estimation concerns, and a follow-up checkpoint.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Ends with at least two specific commitments (one behavioral, one process) and a named follow-up date/checkpoint; invites Jordan\'s input on the plan.',
            'Ends with at least one concrete commitment and a general follow-up intention.',
            'Ends with vague intentions ("let\'s do better") and no follow-up mechanism.',
            'No path forward discussed.',
          ]),
        },
      ],
    },
  },
  {
    title: 'Prompt Engineering Fundamentals',
    discipline: 'AI Literacy',
    description: 'Students practice four core prompting techniques against a live LLM — specificity, role prompting, few-shot examples, and iterative refinement — with a lesson panel alongside. Each technique is graded on the prompt that attempts it.',
    payload: {
      assignment_type: 'llm_interaction',
      title: 'Prompt Engineering Fundamentals',
      description: 'Work through four prompting techniques with the AI assistant: (1) write a highly specific prompt, (2) use a role/persona prompt, (3) use few-shot examples, and (4) take a mediocre response and iteratively refine it. Attempt each task in its own prompt — the grader maps each task to the prompt that attempts it.',
      welcome_message: "Hi! I'm ready when you are. The panel on the left describes four prompting techniques — try each one on me in its own message, in any order. Ask me anything if a technique isn't clear.",
      persona_name: '',
      persona_description: '',
      scenario_context: '',
      system_prompt: 'You are a helpful AI assistant used in a prompt-engineering exercise. Respond naturally and honestly to each prompt on its own merits — a vague prompt gets a genuinely generic response, a specific prompt gets a precise one, so students can see the difference. Do not coach the student, do not list the tasks, and do not evaluate their prompts unless asked.',
      learning_content: {
        title: 'Lesson: Four Prompting Techniques',
        html: '<h2>Four techniques to practice</h2><p>Attempt each technique in its own message. The AI responds naturally — the quality difference you see <em>is</em> the lesson.</p><h3>1. Specificity</h3><p>Vague prompts get vague answers. A specific prompt states the <strong>task</strong>, the <strong>audience</strong>, the <strong>format</strong>, and the <strong>constraints</strong>.</p><ul><li>Weak: "Tell me about exercise."</li><li>Strong: "Write a 100-word paragraph convincing desk workers in their 40s to take walking breaks, in an encouraging tone, ending with one concrete action."</li></ul><h3>2. Role prompting</h3><p>Assigning the AI a role shapes vocabulary, priorities, and depth: "You are a pediatric nurse explaining fever management to a worried first-time parent…"</p><h3>3. Few-shot examples</h3><p>Show 2-3 input→output examples of what you want, then give a new input. The pattern teaches the AI the format and style you expect.</p><h3>4. Iterative refinement</h3><p>First drafts are rarely right. Ask for something, identify a specific weakness in the response, and ask for a targeted revision ("keep the structure, but make the tone less formal and cut it to half the length").</p>',
      },
      max_score: 100,
      scoring_enabled: true,
      max_sessions: 2,
      feedback_release_mode: 'immediate',
      completion_conditions: { min_messages: 4, max_messages: 15, auto_complete: false },
      ai_provider_config: {},
      rubric: [
        {
          id: 'c1', name: 'Specific Prompt', max_points: 25, exemplars: [],
          description: 'One prompt that demonstrates specificity: an explicit task plus at least three of — audience, format, length, tone, constraints.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Prompt states the task and four or more specific parameters (audience, format, length, tone, constraints); the request is unambiguous.',
            'Task plus two or three specific parameters.',
            'Task with one qualifier; still largely generic.',
            'No prompt plausibly attempts specificity, or the attempt is entirely vague.',
          ]),
        },
        {
          id: 'c2', name: 'Role Prompt', max_points: 25, exemplars: [],
          description: 'One prompt that assigns the AI a defined role or persona whose expertise/perspective meaningfully shapes the task.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Role includes who the AI is, who the audience is, and how the role should shape the answer; the role is well-matched to the task.',
            'Clear role assigned and relevant to the task; audience or style guidance thin.',
            'Token role ("act as an expert") with no meaningful effect on the task.',
            'No prompt plausibly attempts role prompting.',
          ]),
        },
        {
          id: 'c3', name: 'Few-Shot Prompt', max_points: 25, exemplars: [],
          description: 'One prompt that provides two or more input→output examples establishing a pattern, followed by a new input for the AI to complete.',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Two or more consistent, well-chosen examples plus a new input; the pattern (format, tone, structure) is clear from the examples alone.',
            'Two examples plus a new input, but the pattern is loose or the examples are inconsistent.',
            'Only one example, or examples with no new input to complete.',
            'No prompt plausibly attempts few-shot prompting.',
          ]),
        },
        {
          id: 'c4', name: 'Iterative Refinement', max_points: 25, exemplars: [],
          description: 'A sequence where the student gets a response, identifies a specific shortcoming, and requests a targeted revision (at least one refinement turn).',
          levels: L(['Excellent', 'Good', 'Developing', 'Not Met'], [25, 18, 10, 0], [
            'Names a specific weakness in the prior response and requests a precise change (what to keep, what to change); at least one refinement turn clearly improves the result.',
            'Requests a revision with a general direction ("shorter", "friendlier") tied to the previous response.',
            'Asks the AI to "try again" or "improve it" with no direction.',
            'No refinement turn attempted.',
          ]),
        },
      ],
    },
  },
];

async function seedTemplates({ log = () => {} } = {}) {
  let inserted = 0;
  for (const t of TEMPLATES) {
    const existing = await pool.query('SELECT id FROM assignment_templates WHERE title = $1', [t.title]);
    if (existing.rows.length > 0) continue;
    await pool.query(
      'INSERT INTO assignment_templates (title, discipline, description, payload) VALUES ($1, $2, $3, $4)',
      [t.title, t.discipline, t.description, JSON.stringify(t.payload)]
    );
    log(`+ added sample "${t.title}"`);
    inserted += 1;
  }
  return inserted;
}

// First boot only: an administrator who deletes the samples keeps them deleted.
async function seedTemplatesIfEmpty() {
  const { rows } = await pool.query('SELECT 1 FROM assignment_templates LIMIT 1');
  if (rows.length > 0) return 0;
  return seedTemplates();
}

module.exports = { seedTemplates, seedTemplatesIfEmpty };

if (require.main === module) {
  seedTemplates({ log: console.log })
    .then((n) => { console.log(`Done: ${n} sample(s) added.`); return pool.end(); })
    .catch((err) => { console.error('Seed failed:', err); process.exit(1); });
}
