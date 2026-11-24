> **Note for this edition.** This guide was written for the hosted product. The editor is unchanged except for the AI Config tab, where the models offered are the ones your administrator has made available, and any mention of an operator or institution portal does not apply.

# Assignment Editor Guide

This guide walks through each tab of the Assignment Editor, explaining what every field does and offering tips for getting the best results from your AI simulations.

The editor adapts to the **assignment type** you choose when creating the assignment — each type gets its own set of tabs. All types share Basics, Rubric, Completion, AI Config, and Preview; the middle tabs vary.

---

## Assignment Types

| Type | What students do | Type-specific tab |
|------|------------------|-------------------|
| **Simulation** | Role-play with an AI persona — patient, client, customer, manager. Best for clinical, counseling, sales, and customer-service practice. | AI Persona |
| **LLM Interaction** | Open chat with a general AI assistant alongside instructor-authored learning content. Best for prompt engineering and discipline-specific AI tasks. | Learning Content, AI Instructions |
| **Staged Simulation** | A role-play that moves through ordered scenes (intake → exam → plan; discovery → objection → close). Rubric criteria can be graded per stage. | Stages |
| **Simulation + Write-up** | Role-play followed by a written artifact (SOAP note, follow-up email, incident report) graded together with the conversation — including a consistency check. | Artifact |
| **AI Examiner** | The AI leads: an oral exam or structured debrief that works through your question areas with probing follow-ups, without revealing answers. | Questions |

The type is chosen at creation and shown as a badge in the editor header. It can't be changed after creation — duplicate into a new assignment if you need a different type.

---

## Creating a New Assignment

Clicking **New Assignment** on the dashboard opens a chooser with three paths beyond picking a type and starting blank:

- **Describe it** — Type a sentence or two (who the students are, what they practice, what you want to assess) and the AI generates a complete editable draft: title, description, welcome message, persona, scenario, behavioral instructions, and a full 3–5 criterion rubric with observable proficiency levels summing to 100 points. Available for Simulation and LLM Interaction types. The draft opens in the editor with a banner reminding you to review every tab — **nothing is saved until you click Save**.
- **Start from template** — A curated gallery of ready-to-adapt example assignments (tagged by discipline and type). Using one creates an unpublished draft copy in your course that you can edit freely.
- **Import file** — Import a `.ltisim.json` file previously exported from any LTISim assignment (see "Sharing and Reuse" below). Imports land as drafts and are fully validated.

**First run:** if your course has no assignments yet, the dashboard shows a getting-started card with one-click **install a working sample** buttons. Installing a sample creates an unpublished draft and opens it in the editor so you can look it over (and test-grade it) before publishing.

---

## AI-Assisted Authoring

Beyond draft generation, the editor has AI assistance built into individual tabs:

- **AI refine** (wand icon next to most text fields) — Rewrites that one field using the rest of the assignment as context. You can give an optional instruction ("make her more reluctant to share details") or leave it blank to simply improve the text. The result replaces the field content for your review — undo by editing or refining again.
- **AI rubric review** (Rubric tab) — Audits your rubric for vague level descriptions, indistinguishable adjacent levels, overlapping criteria, and coverage gaps. Returns up to 6 concrete findings.
- **Test Grading** (Preview tab) — Paste a sample transcript and grade it with the real evaluator against your saved rubric before any student sees the assignment.

These calls count toward your institution's AI usage, like student chats do.

---

## Basics

Core settings that students see when browsing assignments.

| Field | Description |
|-------|-------------|
| **Title** | The assignment name shown to students and in Canvas. Required. |
| **Description** | A short summary visible on the student dashboard. Use it to set expectations (e.g. "Practice a patient intake interview"). |
| **Welcome Message** | The AI's opening line when a student starts the simulation. If left blank, the student speaks first. Good for establishing the scenario in-character (e.g. "Hi, I'm here for my appointment today."). For AI Examiner assignments this is the opening question. |
| **Max Score** | The total points the rubric is scored out of (default 100). Only shown when Scored Mode is enabled on the Rubric tab. |
| **Max Attempts** | How many times a student can start this assignment (default 1). Leave blank for unlimited. Each attempt is a separate session with its own score. Practice sessions never consume attempts. |

**Publish toggle:** the **Published / Draft** pill in the editor header controls visibility. New assignments (including AI drafts, template copies, and imports) always start as drafts — students can't see them until you publish.

**Tip:** Keep titles short and descriptive. Students see them in a list alongside other assignments.

---

## AI Persona

*(Simulation, Staged Simulation, Simulation + Write-up, AI Examiner)*

Define who the AI is pretending to be, the scene the student enters, and any extra behavioral rules. All four fields live on this one tab.

| Field | Description |
|-------|-------------|
| **Persona Name** | The character's name, shown in the chat header instead of "AI" (e.g. "Dr. Sarah Chen", "Frustrated Customer"). |
| **Persona Background** | Background, personality, and behavioral notes. This is included in the AI's instructions and shapes how it responds. Be specific: age, occupation, emotional state, communication style, and any relevant history. |
| **Scenario / Setting** | The situation the student is entering — what's happening, where, and why. Write it from the AI persona's perspective (its backstory and motivations), not the student's. Student-facing instructions belong in the Description on the Basics tab. |
| **Additional AI Instructions** | Optional: extra rules or constraints for how the AI should behave (e.g. "Never break character", "Respond in 2-3 sentences"). Combined with the persona, scenario, and rubric when sent to the model. |

**Tip:** The more detail you give in the persona background, the more consistent the AI's behavior will be. Include things like "speaks formally", "avoids medical jargon", or "becomes defensive when challenged".

---

## Learning Content and AI Instructions

*(LLM Interaction only — these replace the AI Persona tab)*

**Learning Content** is a side panel students can open while chatting — the reference material they need for the tasks.

| Field | Description |
|-------|-------------|
| **Panel Title** | Heading shown at the top of the side panel (e.g. "Lesson: Writing Effective Prompts"). |
| **Lesson Content** | Rich text: headings, lists, links, images, YouTube/Vimeo videos, and embeds (CodePen, H5P, etc.). |

**AI Instructions** is an optional system prompt sent to the LLM for every message (e.g. "You are a finance tutor. Guide with questions; do not give the final answer."). Leave blank for a default helpful-assistant prompt.

---

## Stages

*(Staged Simulation only)*

The conversation moves through ordered scenes. Students advance with a "Continue to next stage" button once they've sent the stage's minimum messages; the scene shift appears as a visible divider in the chat and the AI plays the new scene. Up to 8 stages.

| Field | Description |
|-------|-------------|
| **Stage title** | Shown to students at the scene shift (e.g. "The family meeting"). |
| **Min msgs** | Student messages required in this stage before the advance button activates (1–25). |
| **Scene context** | What just happened, where the scene is now, the persona's state of mind — written from the persona's perspective. Students don't see this. |
| **Persona name override** | Optional — use when a different character enters the scene (e.g. a family member takes over the conversation). |

Rubric criteria can be scoped to a single stage on the Rubric tab (see "Scoping criteria" below).

---

## Artifact

*(Simulation + Write-up only)*

After the conversation, students write this artifact. It's graded together with the transcript, and the evaluator also flags artifact claims that aren't supported by the conversation (shown to you as consistency notes) — so a student can't document findings they never actually established in the interview.

| Field | Description |
|-------|-------------|
| **Artifact Title** | E.g. "Post-Encounter SOAP Note" or "Follow-up Email to the Client". |
| **Instructions** | Shown beside the writing area. Say what to include and how it will be judged. |
| **Template** | Optional — pre-fills the writing area (e.g. a SOAP skeleton with section headings). |
| **Min / Max words** | Minimum enforced before submission; maximum is a guideline. |

Scope individual rubric criteria to the conversation, the artifact, or both on the Rubric tab.

---

## Questions

*(AI Examiner only)*

Here the AI leads the conversation instead of the student. It asks one question at a time and works through your question areas in order, probing follow-ups based on answer quality. Students see the topic list and their progress — never your guidance. Completion is gated on covering all required areas.

**Conversation style:**

- **Oral exam** — Neutral examiner: probes understanding, never reveals or confirms answers.
- **Structured debrief** — Reflective coach: draws out the student's own thinking and lessons learned.

**Question areas** (up to 10):

| Field | Description |
|-------|-------------|
| **Topic** | Students see this (e.g. "Interpreting the blood gas results"). |
| **Guidance** | Examiner-side only: what to ask about, what a strong answer includes, common misconceptions to probe. |
| **Required before completion** | Whether this area must be covered before the student can finish. |
| **Follow-up depth** | 0 (move on after the answer), 1, or 2 follow-up questions per area. |

Set the opening question as the Welcome Message on the Basics tab. Rubric criteria can be scoped to a single question area.

---

## Rubric

Define how the student's performance is evaluated after they complete the simulation.

### Scoring Mode Toggle

At the top of the tab, choose between:

- **Scored Mode** - The AI assigns numeric point values per criterion. Students receive a calculated percentage grade that is passed back to Canvas.
- **Scoreless Mode (Completion Credit)** - The AI provides qualitative feedback per criterion (level achieved + written feedback) but no numeric scores. Students receive 100% completion credit in Canvas.

### Criteria

Each criterion represents one dimension of student performance. Click **Add Rubric Criterion** to add one.

| Field | Description |
|-------|-------------|
| **Criterion Name** | Short label (e.g. "Empathy", "Information Gathering", "Professional Tone"). Students see these as "Objectives" in the sidebar during the simulation. |
| **Max Points** | Maximum score for this criterion (Scored Mode only). The sum of all criteria max points should equal the Max Score set on the Basics tab — a badge at the top of the tab shows the running total and warns on a mismatch. |
| **Description** | What this criterion measures. This is included in the AI's evaluation prompt, so be specific about what "good" looks like. |

### Scoping criteria (type-specific)

For the newer assignment types, each criterion also gets a **Graded on** selector:

- **Staged Simulation** — grade a criterion on the whole conversation or on one specific stage only.
- **Simulation + Write-up** — grade on the conversation, the written artifact, or both.
- **AI Examiner** — grade on the whole conversation or on one question area only.

Use scoping when a skill only appears in one part of the assignment (e.g. "Closing technique" scoped to the final stage; "Documentation accuracy" scoped to the artifact).

### AI rubric review

Once you have at least one criterion, the **AI rubric review** button audits the rubric: are level descriptions observable behaviors rather than vague praise, are adjacent levels distinguishable, do criteria overlap, is anything in the assignment description uncovered? Findings appear inline with a concrete suggestion each. The points-sum check is deterministic and always on; the AI review is judgment-based — treat it as a second pair of eyes, not a gate.

### Proficiency Levels

Each criterion has levels that describe varying quality of performance. Default levels are Excellent, Good, Developing, and Not Met. You can rename, add, or remove levels.

| Field | Description |
|-------|-------------|
| **Points** | The numeric score for this level (Scored Mode only). |
| **Label** | Level name (e.g. "Excellent", "Proficient", "Needs Improvement"). |
| **Description** | What performance at this level looks like. The AI uses these descriptions when deciding which level the student achieved. |

**Tip:** Write level descriptions as observable behaviors. Instead of "Student did well", write "Student asked at least 3 open-ended questions and acknowledged the patient's emotions". The more concrete the descriptions, the more reliable the AI's evaluation.

**LLM Interaction assignments — tasks instead of criteria.** The editor labels criteria as "Tasks" for this assignment type, and grading is per-task: the AI identifies which of the student's prompts attempt each task and grades the task only on those prompts (students can do tasks in any order or ask clarifying questions in between). A task no prompt attempts scores at the lowest level — strong work on one task never earns credit for another. The review view shows which prompt each task was graded on ("Graded on prompt #2"), so write each task's name and description to clearly identify what an attempt at it looks like.

**Tip:** If you don't need a rubric, leave this tab empty. Without criteria, scored assignments fall back to a simple participation-based score (10 points per message sent), and scoreless assignments just grant completion credit. (This no-rubric participation score is by design; when a rubric *is* present, a failed AI evaluation is never silently replaced by a participation score — the session is queued and automatically retried instead.)

### Exemplars (Few-Shot Calibration)

Each criterion has a collapsible **Exemplars** section below its proficiency levels. Exemplars are optional per-criterion examples — concrete sample responses that show the AI what "good" (or "developing", or any other level) actually looks like in practice. When present, they're included in the grading prompt as calibration anchors, which typically improves grading accuracy more than any other change short of switching to a more capable model.

| Field | Description |
|-------|-------------|
| **Label** | Which level this example represents (e.g. "Exemplary", "Proficient"). Defaults to your top level's label when you add a new exemplar. |
| **Score** | The numeric score this example represents (Scored Mode only). Defaults to the matching level's score. |
| **Excerpt** | The actual example response — a transcript excerpt for Simulation assignments, or a student's final artifact for LLM Interaction assignments. Up to 5000 characters. |
| **Explanation** | Why this example scored where it did — what specific behaviors, phrases, or reasoning patterns make it exemplary. This is sent to the AI grader so it knows what to look for. |

You can have up to 5 exemplars per criterion. Leave the section empty to grade that criterion using level descriptions alone (zero-shot mode).

**When to use exemplars:**
- The rubric language is abstract and you're seeing inconsistent grades.
- You want to align the AI's standards to your own, especially on nuanced criteria.
- You're running a high-stakes graded assignment where consistency matters.
- You have completed sessions that perfectly illustrate what a level looks like — promote them directly from the instructor dashboard's session review page using the **Save as Exemplar** button. Promoted exemplars show a "From session #N" pill and link back to their source.

**Tip — bootstrap from real work.** The best exemplars come from actual student sessions, not hand-written examples. Run the assignment zero-shot with a pilot cohort, then promote the sessions that best illustrate each level into exemplars for the next cohort. This turns your first cohort's sessions into calibration data for all future attempts.

**Tip — you don't need exemplars on every criterion.** If only one criterion is giving the AI trouble, add exemplars there and leave the rest alone. Exemplars are per-criterion.

**Note on rubric changes:** if you change the rubric while sessions are sitting in your review queue, the editor offers to regrade those pending AI drafts with the new rubric. Released grades are never touched, and nothing is sent to Canvas until you release.

---

## Completion

Control when and how students can finish the simulation, whether they can practice first, and when they see their results.

### Completion Conditions

| Field | Description |
|-------|-------------|
| **Minimum Messages** | The student must send at least this many messages before the "Complete Simulation" button becomes active. Use this to ensure students engage meaningfully rather than rushing to complete. Set to 0 or leave blank for no minimum. |
| **Maximum Messages** | The session ends after the student sends this many messages. A toast notification informs the student when the limit is reached. Leave blank for no maximum. |
| **Auto-complete when max messages reached** | When checked, the simulation automatically evaluates and submits when the maximum message count is hit. When unchecked, the student must still click "Complete Simulation" after reaching the max. |

**Tip:** A minimum of 5-8 messages works well for most simulations. This gives students enough turns to demonstrate competency without dragging out the conversation.

### Practice Mode

**Allow practice sessions** gives students a "Practice first" option: a short ungraded run (capped at 10 messages) with immediate AI feedback. Practice never uses an attempt, never reaches the gradebook, and is excluded from your statistics. Practice chats still count toward your institution's AI usage.

Practice pairs well with low Max Attempts: students can warm up without burning their one graded try.

### Feedback Release

Controls when students see their evaluation results after completing the simulation:

- **Release immediately** — Students see their score and feedback as soon as they complete. Grades pass back to the gradebook right away.
- **Immediate, but hold low-confidence for review** *(experimental)* — The AI grader reports its confidence per criterion. Confident evaluations release immediately; sessions with any low-confidence criterion are held for your review. Confidence is self-reported by the AI — treat as experimental until your own grading data validates it.
- **Hold for instructor review** — The AI evaluation is generated but held until you review and release results (individually or in bulk from the review queue). Grades are sent to the gradebook upon release, and you can adjust scores and feedback before releasing.

---

## AI Config

Technical settings for the AI model. These have sensible defaults — most instructors can skip this tab entirely.

| Field | Description |
|-------|-------------|
| **Provider** | The AI service provider. Currently only AWS Bedrock is supported. |
| **Model** | Which AI model to use. Options range from budget (Claude 3.5 Haiku) to most capable (Claude Opus 4.6). Default is set by the server administrator. Higher-tier models produce better roleplay and evaluation but cost more per message. |
| **Temperature** | Controls randomness in AI responses (0 = very consistent, 1 = very creative). Default is 0.7. Lower values (0.3-0.5) work well for clinical or factual scenarios. Higher values (0.7-0.9) suit creative or emotional roleplay. |
| **Max Tokens** | Maximum length of each AI response in tokens (~1 token = 4 characters). Default is 2048. Reduce this if you want shorter, more conversational responses. |

**Tip:** Start with the defaults. If the AI's responses feel too long, try lowering Max Tokens to 1024. If responses feel too repetitive, try raising Temperature to 0.8.

### Voice Conversation

*(All persona-based types — not LLM Interaction)*

The **Voice conversation** checkbox lets students speak their messages and, where your installation supports it, hear the persona's replies read aloud in a voice you pick (8 voices). What students say is turned into text in the message box, which they can edit before sending. Typing always remains available — voice is never required, and students who decline microphone access lose nothing.

What voice does depends on how your installation is set up. The text under the checkbox tells you what students will get on yours:

- **Amazon services:** speech is transcribed by Amazon Transcribe, tuned to your persona names and rubric terms, and works in every browser with a microphone. Replies are read aloud by Amazon Polly.
- **The student's browser:** speech is transcribed by the student's own browser, which works in some browsers and not others, and usually sends the audio to the browser's maker. Replies are not read aloud; students see text only.

The administrator's reference is [Voice](Voice.md).

---

## Preview

Test your assignment configuration by chatting with the AI persona before publishing.

The Preview tab lets you send messages and see how the AI responds given your current persona, scenario, system prompt, and AI config settings. This is an instructor-only sandbox — no session is created and nothing is recorded.

**Important:** You must save the assignment at least once before Preview becomes available. After making changes to any other tab, save again and then test in Preview to see the updated behavior.

**Tip:** Try playing the role of a student and see if the AI stays in character, responds naturally to off-topic questions, and guides the conversation toward your rubric objectives. If not, refine the persona description or system prompt.

### Test Grading

Below the preview chat is a grading dry-run: paste a sample transcript (lines prefixed `Student:` and `AI:`) and grade it with the **real evaluator** against your saved rubric. You get the same output students' sessions get — overall score, per-criterion level, points, feedback, and confidence flags. Nothing is recorded and no session is created.

**Tip:** Test-grade two transcripts before publishing a scored assignment: one that should score high and one that should score low. If the evaluator doesn't separate them the way you'd expect, tighten your level descriptions or add exemplars — it's much cheaper to find this out now than after 30 students have submitted.

---

## Sharing and Reuse

From the assignment card on the dashboard you can:

- **Duplicate** — Copy the assignment into this course, or into any other course where you're an instructor. Copies land as drafts titled "… (Copy)".
- **Export** — Download the assignment's authoring fields (persona, scenario, rubric, config — no student data, no session references) as a portable `.ltisim.json` file.
- **Import** — Via the New Assignment chooser: bring an exported file into any course, on any LTISim server. Imports are validated and land as drafts.

Exemplars promoted from real sessions travel with duplicates and exports, but their links back to source sessions are stripped — session data never leaves the original course.
