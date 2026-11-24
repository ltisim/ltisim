# Voice

How spoken input and spoken replies work, what they need, and what happens when those needs are not met.

Voice is optional and off by default. An instructor turns it on per assignment with the **Voice conversation** checkbox (all persona-based types; not LLM interaction). Typing always remains available.

## Voice does not use your AI provider

Voice is separate from `AI_PROVIDER`. Whatever model you chose for conversation and grading, speech is handled by Amazon services when the server can reach them, and by the student's browser when it cannot.

| | With AWS access | Without AWS access |
|---|---|---|
| **Spoken input** (student speaks) | Amazon Transcribe, in every browser that has a microphone | The browser's own speech recognition, where the browser has one. Otherwise the student is told to type |
| **Spoken replies** (persona is read aloud) | Amazon Polly, in the voice the instructor picked | None. Replies appear as text only |

There is no setting that chooses between these. The server tries AWS, and the student's browser falls back when that fails.

"AWS access" means credentials the server can find and that are permitted to use the service. Credentials come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or, when those are unset, from the machine's own role or profile. So a server that has an AWS profile for some other purpose will use it for voice.

## Where the audio goes

Say this to whoever reviews privacy for your institution before turning voice on.

| Path | Audio is sent to | Stored by LTISim? |
|---|---|---|
| Amazon Transcribe | Your AWS account, through your server | No. Audio is relayed and discarded; only the text the student sends is kept |
| Browser speech recognition | Whoever makes the student's browser. In most browsers the audio goes to that company's servers, directly from the student's device | No |
| Amazon Polly | The text of the persona's reply goes to your AWS account | No |

The browser path matters most. If you chose a self-hosted model so that nothing leaves your network, the browser fallback does not honour that: recognition is done by the browser's maker, and your server is not involved. To avoid it, either give the server AWS access for Transcribe or leave voice off.

In both input paths the transcript appears in the message box, and the student can edit it before sending.

## Setting up AWS for voice

1. Give the server AWS credentials (see [Configuration](Configuration.md#ai-provider)). If you already use `AI_PROVIDER=bedrock`, the same credentials are used.
2. Allow these actions:

   | Action | Used for |
   |---|---|
   | `transcribe:StartStreamTranscription` | Spoken input |
   | `transcribe:CreateVocabulary`, `transcribe:UpdateVocabulary`, `transcribe:GetVocabulary`, `transcribe:DeleteVocabulary` | The per-assignment vocabulary (optional; see below) |
   | `polly:SynthesizeSpeech` | Spoken replies |

3. Pass WebSocket upgrades for `/api/voice/ws` through your reverse proxy (see [Self-hosting](Self-Hosting.md)).
4. Restart the app. A denied permission turns that service off until the next restart.

The region is taken from `AWS_BEDROCK_REGION`, even when Bedrock is not your AI provider. If it is unset, voice uses `us-east-2`. (Bedrock itself defaults to `us-east-1`; set the variable to avoid the mismatch.)

### What each permission failure does

Each part fails on its own, and none of them stops a session.

| Missing | Result |
|---|---|
| Transcribe streaming | Spoken input falls back to the browser |
| Vocabulary actions | Transcribe still works, without the assignment's vocabulary |
| Polly | No spoken replies; text only |
| WebSocket not passed by the proxy | Same as Transcribe missing: falls back to the browser |

### Vocabulary

When an assignment with voice is saved, LTISim builds a custom vocabulary from the persona names and rubric terms so that Transcribe recognises them. These appear in your AWS account as `ltisim-a<assignment number>`. They cost nothing extra.

## Limits

| Setting | Default | Meaning |
|---|---|---|
| `VOICE_SESSION_MAX_SECONDS` | `1800` | Total spoken input per session |
| `VOICE_STREAM_MAX_SECONDS` | `300` | Longest single stretch of spoken input |
| `VOICE_IDLE_SECONDS` | `15` | Silence after which listening stops |

These apply to the Transcribe path only. The browser path is not metered.

Spoken input through Transcribe is also stopped by the installation's monthly usage limits, like any other AI call.

## Usage and cost

Each stretch of spoken input through Transcribe is recorded as one call of type `voice`, against the model ID `aws.transcribe-streaming`, with one "token" per second of audio. It shows in the Instance area's **Usage & limits** tab with the other calls.

No price is shipped, so by default these calls count toward the call limit but not the dollar budget. To put a price on them, add a model in the **Models** tab with the ID `aws.transcribe-streaming`, enter your per-second price as the input price (a price of $0.024 per minute is 400 per million), enter 0 as the output price, and then switch the model off so it is not offered to instructors. This follows from how prices are applied; it has not been tried on a running installation.

Spoken replies through Polly are **not recorded** and are not stopped by the usage limits. Watch that cost in your AWS account.

The browser path costs nothing and records nothing.

## What is fixed

- **Language.** Transcribe is set to US English. The browser path uses the browser's language.
- **Voices.** Eight Polly voices, all US English, chosen per assignment.
- **Engine.** Transcribe first, browser second. There is no setting to force one or to disable the fallback.

## Not verified in this edition

See [Known limitations](Known-Limitations.md). In short: the voice code came from the hosted product unchanged. Spoken input through Transcribe ran in production there. The browser fallback and spoken replies have not been exercised on this edition, and spoken replies were never confirmed working on the hosted product either.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No microphone button | Voice is not enabled on the assignment, or it is an LLM interaction assignment |
| "Voice input needs microphone access" | The student declined the microphone prompt. Nothing falls back from this; they allow it or type |
| "Voice input is unavailable right now" | Transcribe could not be reached and the browser has no speech recognition of its own |
| A pause of a few seconds before listening starts, once per page | Transcribe did not answer and the browser took over. Expected without AWS access |
| No spoken replies | Polly is not permitted or not reachable. The server log has a `[tts]` line saying which |
| `[transcribe]` or `[tts]` errors in the log on an installation without AWS | Expected. The server tries AWS once per page load before the browser gives up on it |
