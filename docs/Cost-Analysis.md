> **Carried over from the hosted product.** This document was written for the hosted multi-tenant product. Its figures are for specific AWS Bedrock models at the prices in effect when it was written. Use it as a method for estimating cost, not for the numbers; this edition ships no prices. See the [documentation index](README.md); where this document disagrees with the current ones, they are right.

# AI Token Cost Analysis — Per Session Estimates

## How Token Costs Accumulate

Understanding the cost per session requires knowing how conversational AI APIs work. You don't just pay for each new message — you pay for the **full conversation context** sent with every request.

Here's what happens each time a student sends a message:

1. The system sends the **AI persona instructions** (system prompt) — same every time.
2. The system sends the **entire conversation history** up to that point — this grows with every exchange.
3. The AI reads all of that and generates a response.

This means the 1st message is cheap (just the system prompt + one short message), but the 20th message includes the system prompt plus all 39 previous messages. Costs grow as the conversation progresses.

At the end, there's one additional AI call for **evaluation** — the system sends the full transcript plus the rubric and asks the AI to assess the student's performance.

---

## Assumptions for This Estimate

| Parameter | Estimate | Notes |
|-----------|----------|-------|
| Student messages per session | 20 | As specified |
| AI responses per session | 20 | One reply per student message |
| System prompt length | ~600 tokens | Persona name, description, scenario, rubric criteria |
| Avg student message | ~60 tokens | 2–4 sentences |
| Avg AI response | ~200 tokens | 1–3 paragraphs, staying in character |
| Evaluation prompt | ~6,000 tokens input | Full transcript + rubric + scoring instructions |
| Evaluation response | ~1,000 tokens output | JSON with per-criterion feedback |

**A token is roughly 4 characters or ¾ of a word.** A 60-token message is about 2–3 sentences. A 200-token response is about a paragraph and a half.

---

## Token Math

### Chat Phase (20 exchanges)

Each API call *n* (1 through 20) sends:

> System prompt + all previous messages + the new student message

The input tokens grow with each call. Averaging across all 20 calls:

| | Tokens |
|---|--------|
| Total input tokens (all 20 calls combined) | ~63,000 |
| Total output tokens (20 AI responses) | ~4,000 |

### Evaluation Phase (1 call at the end)

| | Tokens |
|---|--------|
| Input tokens (transcript + rubric + instructions) | ~6,000 |
| Output tokens (evaluation JSON with feedback) | ~1,000 |

### Session Total

| | Tokens |
|---|--------|
| **Total input tokens** | **~69,000** (~69K) |
| **Total output tokens** | **~5,000** (~5K) |

---

## Cost Per Session by Model

Prices are based on current Anthropic/AWS Bedrock on-demand pricing (per million tokens). Bedrock pricing matches Anthropic API pricing on global endpoints. Regional endpoints on Bedrock add a 10% premium for Claude 4.5+ models.

| Model | Input Price | Output Price | Input Cost | Output Cost | **Total / Session** |
|-------|------------|-------------|------------|-------------|---------------------|
| **Claude Haiku 3.5** | $0.80/MTok | $4.00/MTok | $0.055 | $0.020 | **$0.08** |
| **Claude Haiku 4.5** | $1.00/MTok | $5.00/MTok | $0.069 | $0.025 | **$0.09** |
| **Claude Sonnet 4.5** | $3.00/MTok | $15.00/MTok | $0.207 | $0.075 | **$0.28** |
| **Claude Opus 4.5** | $5.00/MTok | $25.00/MTok | $0.345 | $0.125 | **$0.47** |

*MTok = per million tokens*

The assignment editor currently offers six models: the four above plus **Claude Sonnet 4** (priced the same as Sonnet 4.5) and **Claude Opus 4.6** (priced the same as Opus 4.5) — per-session costs for those two follow their same-priced rows.

---

## Scaling to a Class

Here's what it looks like for a class of 30 students, each completing one 20-message session:

| Model | Cost per Session | 30 Students | 30 Students × 3 Attempts |
|-------|-----------------|-------------|--------------------------|
| **Haiku 3.5** | $0.08 | **$2.40** | **$7.20** |
| **Haiku 4.5** | $0.09 | **$2.70** | **$8.10** |
| **Sonnet 4.5** | $0.28 | **$8.40** | **$25.20** |
| **Opus 4.5** | $0.47 | **$14.10** | **$42.30** |

And for a larger deployment — 200 students across multiple sections:

| Model | 200 Students × 1 Attempt | 200 Students × 3 Attempts |
|-------|--------------------------|--------------------------|
| **Haiku 3.5** | **$16** | **$48** |
| **Haiku 4.5** | **$18** | **$54** |
| **Sonnet 4.5** | **$56** | **$168** |
| **Opus 4.5** | **$94** | **$282** |

---

## Model Comparison — Quality vs. Cost

| Model | Relative Cost | Best For |
|-------|--------------|----------|
| **Haiku 3.5** | Lowest (~$0.08) | High-volume, straightforward practice scenarios. Good for introductory exercises where nuance is less critical. Fastest response times. |
| **Haiku 4.5** | Low (~$0.09) | Similar cost to 3.5 but noticeably smarter. Best balance of cost and capability for most use cases. Recommended starting point. |
| **Sonnet 4.5** | Moderate (~$0.28) | Complex simulations requiring nuanced character portrayal, sophisticated responses, and detailed evaluation. Good for mid-to-high stakes assignments. Currently the application default. |
| **Opus 4.5** | Higher (~$0.47) | Most capable model. Best for high-stakes assessments where evaluation quality is paramount, or simulations requiring highly nuanced, expert-level conversation (e.g., advanced clinical scenarios). |

---

## What Affects Cost

**Things that increase cost:**
- Longer conversations (more messages = more accumulated context)
- Longer individual messages (verbose students or detailed AI responses)
- Complex rubrics with many criteria (larger system prompt and evaluation prompt)
- Multiple attempts per student
- Using a more capable model
- Practice sessions (ungraded, capped at 10 messages, but still real AI calls)
- AI-assisted authoring (draft generation, field refines, rubric reviews, test-grades — modest per call, and they run on the grading-tier model)
- Running a stronger model for grading than for chat (`AI_GRADING_MODEL`) — raises only the evaluation call's cost

**Things that reduce cost:**
- Shorter conversations (10 messages instead of 20 cuts cost roughly in half)
- Setting max message limits to prevent runaway conversations
- Using Haiku for practice/low-stakes and reserving Sonnet/Opus for graded work
- Concise persona descriptions (smaller system prompt)

---

## Where Pricing and Cost Tracking Live in the App

This document is a planning estimate. Actual costs are tracked in the application itself:

- **Pricing is data, not code.** Per-model rates live in the `ai_models` table as **per-1k-token** values (`input_cost_per_1k` / `output_cost_per_1k`). Migration `migrate-v18` reconciled the table so all six models offered by the assignment editor are priced (and a boot-time check warns if a configured model is ever missing a price).
- **Cost is recorded per call.** Every AI call (chat, evaluation, authoring, etc.) logs its token counts and a computed `cost_usd` to the `ai_usage` table, so real spend per tenant, assignment, or call type is queryable — no need to extrapolate from this document.
- **Tenant budget quotas.** Each tenant can carry a monthly AI call limit and/or a monthly budget in USD (`monthly_ai_call_limit`, `monthly_ai_budget_usd`). Enforcement is fail-open and exempts evaluation calls (a student who finished a session always gets graded); threshold alert emails go out at 80% and 100% of quota, and the operator portal's Usage page shows quota progress per tenant.
- **Monthly statements.** A cron script emails each tenant a previous-month usage statement, so institutions see actuals without portal access.

---

## Important Notes

- **No per-seat or license fees** — You only pay for actual AI usage (tokens processed).
- **Server and database costs are separate** — These are modest for a standard web application and don't scale with AI usage.
- **Evaluation is a small portion of cost** — The one-time evaluation call at the end is roughly 8–10% of total session cost. The bulk comes from the cumulative chat history.
- **These are estimates** — Actual costs depend on how much students write, how verbose the AI is, and how detailed your rubric/persona setup is. Real usage may be 20–40% higher or lower.
- **Instructor preview chats** also consume tokens, but these are typically short (a few messages to test the persona) and negligible in aggregate.

---

## Cost per Session at Different Conversation Lengths

For reference, here's how session cost changes with conversation length (using Sonnet 4.5):

| Student Messages | Approx. Input Tokens | Approx. Output Tokens | Sonnet 4.5 Cost |
|-----------------|----------------------|----------------------|-----------------|
| 5 | ~8,000 | ~2,000 | $0.05 |
| 10 | ~23,000 | ~3,000 | $0.11 |
| 15 | ~44,000 | ~4,000 | $0.19 |
| **20** | **~69,000** | **~5,000** | **$0.28** |
| 25 | ~99,000 | ~6,000 | $0.39 |
| 30 | ~135,000 | ~7,000 | $0.51 |

The cost grows more than linearly because each new message requires resending the full history.

---

## Voice input (Amazon Transcribe streaming, v22)

When a student speaks instead of types, mic audio streams to Amazon Transcribe at **$0.024/min** of audio ($0.40 per 1,000 seconds — 1 "input token" = 1 second in `ai_usage`, `call_type='voice'`, model `aws.transcribe-streaming`). Voice cost therefore appears in the same tenant budgets, alerts, and statements as model cost.

| Speaking time per session | Transcribe cost |
|---------------------------|-----------------|
| 5 min | $0.12 |
| 10 min | $0.24 |
| 15 min | $0.36 |
| 30 min (session cap default) | $0.72 |

Guardrails: `VOICE_SESSION_MAX_SECONDS` (default 1,800 s = $0.72 worst case per session), 300 s per stream, 15 s idle auto-stop. The Web Speech fallback is free. Custom vocabularies cost nothing extra.

---

*Pricing sourced from [Anthropic Claude API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/), February 2026; reconciled into the `ai_models` table July 2026 (`migrate-v18`). If rates change, update `ai_models` — the app computes costs from the table, not from this document.*
