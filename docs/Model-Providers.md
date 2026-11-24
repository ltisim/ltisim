# Model providers

LTISim does not ship with a model. You connect one AI provider and decide which of its models your instructors may use.

- **The provider and its credentials** are set on the server, in `backend/.env`.
- **The models** are listed, and the defaults chosen, in the web interface under **Instance**, then **Models**.

No model name or price is built into LTISim. A new installation starts with an empty model list.

> **Voice is separate.** Spoken input and spoken replies do not go through the provider you choose here. See [Voice](Voice.md).

## Read this first: grading quality

LTISim uses a model in two roles:

- the **conversation model** plays the role in the session with the student;
- the **grading model** scores the finished session against the rubric and helps instructors draft assignments.

The grading approach was validated only on **Anthropic models through AWS Bedrock** (see [AI-Grading-Validation.md](AI-Grading-Validation.md) for exactly which models and settings). No other model or provider has been measured. Grading asks the model for a structured result by instruction alone, which smaller or local models follow less reliably.

If you use anything else, check it on your own rubrics before trusting it: have instructors grade some sessions before seeing the AI's score, and read the **Grading agreement** view in the Instance area.

## Choosing a provider

Set `AI_PROVIDER` to one of the following and restart.

### Anthropic API

```
AI_PROVIDER=anthropic
AI_API_KEY=sk-ant-...
```

Uses Anthropic's official SDK. If `AI_API_KEY` is unset, the SDK's own credential lookup applies (for example the `ANTHROPIC_API_KEY` variable). `AI_BASE_URL` points it at a gateway.

**List models** in the Instance area works with this provider.

### OpenAI-compatible API

For OpenAI, Azure OpenAI, and servers that speak the same Chat Completions format: Ollama, vLLM, LM Studio, LiteLLM and other gateways.

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
```

Examples:

| Service | Settings |
|---|---|
| OpenAI | `AI_BASE_URL=https://api.openai.com/v1` and `AI_API_KEY` |
| Ollama on the same machine | `AI_BASE_URL=http://localhost:11434/v1`, no key |
| Azure OpenAI | `AI_BASE_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>?api-version=<version>` and `AI_EXTRA_HEADERS={"api-key":"<key>"}` |

`AI_BASE_URL` is the API root; LTISim appends `/chat/completions` and `/models`, keeping any query string.

**List models** works when the server implements `/models`.

### AWS Bedrock

Anthropic models through AWS.

```
AI_PROVIDER=bedrock
AWS_BEDROCK_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Leave the two key variables unset to use the machine's own AWS credentials (an instance role, or the profile of the account running the app).

**List models** is not available for Bedrock. Add model IDs by hand, exactly as Bedrock names them, including any regional prefix such as `us.`.

## Adding models and choosing defaults

In the web interface, launch the tool from your LMS as an administrator and open **Instance**, then **Models**.

1. **Add models.** Use **List models** to pick from what your account offers, or type a model ID under **Add a model by ID**.
2. **Test each one.** The **Test** button sends one short request and reports whether it worked, or the provider's error.
3. **Choose defaults.** Pick a default conversation model and a default grading model. Assignments cannot run until a default conversation model is set.
4. **Optionally enter prices**, per million tokens. See [Usage and cost](#usage-and-cost).

Instructors can then override the conversation and grading model per assignment, choosing only from models you have marked available.

Models are listed per provider. If you change `AI_PROVIDER`, models added for the previous provider are hidden, and you add models for the new one.

Providers retire models. A retired model stays in your list until you remove or hide it; the Test button will show the provider's error.

## How LTISim adapts to different models

Because you choose the models, LTISim does not assume what a model supports. It finds out as it goes.

| Difference between models | What LTISim does |
|---|---|
| Some models reject sampling settings such as temperature | A rejected request is retried once without them, and that model is remembered until restart. Applies to all three providers |
| Some models think before answering, and the thinking counts toward the reply length limit | The Anthropic provider asks the API what each model supports and gives thinking models extra room, so replies and grading results are not cut short. Live conversation runs at low effort for speed; grading keeps the model's default |
| Some servers want `max_completion_tokens` instead of `max_tokens`, or reject usage reporting while streaming | The OpenAI-compatible provider retries with the alternative. Set `AI_MAX_TOKENS_PARAM` to skip the retry |
| A model declines a request on safety grounds | The request fails with a clear message; it is not returned as an empty reply |

On Bedrock, LTISim cannot ask what a model supports, so thinking models do not get extra room there. If replies or grading results from a newer Bedrock model are cut short, raise **Longest reply** on the assignment.

## Usage and cost

Every AI call is recorded with its model and token counts. The **Usage & limits** view shows calls and tokens by day, model, type and assignment.

Dollar figures appear only for models you have given a price. Prices are yours to enter: what you pay depends on your provider, region and contract, and is zero for a model you host. LTISim ships no prices and does not update them.

Two monthly limits are available:

| Limit | Needs prices? | Notes |
|---|---|---|
| AI call limit | No | Works with any model. One student message is one call |
| Budget in USD | Yes | Counts only calls to models that have a price. Calls to unpriced models are not counted, and the view warns you when that happens |

At a limit, new conversations, previews and drafting help are blocked until the next month. Grading of sessions already completed always continues, so no student is left without a result.

## Troubleshooting

Use the Test button first; it shows the provider's own error.

| Message | Meaning |
|---|---|
| The API rejected the credentials | Wrong or missing key |
| Model was not found | The model ID is not exactly what the provider expects, or your account cannot use it |
| Rate limit was reached | The provider is throttling your account |
| Could not reach the endpoint | Wrong `AI_BASE_URL`, or the server cannot reach it |
| This model version has reached the end of its life | The provider has retired the model |
| No AI model is configured | No default conversation model is set |

## Verification status

- **AWS Bedrock:** the provider the hosted product has always used. After the changes in this edition, a live request reached AWS but a successful reply has not yet been confirmed.
- **Anthropic API:** verified live: listing models, the connection test on four models, a streamed conversation, and rubric grading.
- **OpenAI-compatible:** covered by automated tests against simulated responses. It has not made a live request.
