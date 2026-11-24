# Voice

How spoken input and spoken replies work, what they need, and what happens when those needs are not met.

Voice is optional and off by default. An instructor turns it on per assignment with the **Voice conversation** checkbox (all persona-based types; not LLM interaction). Typing always remains available.

## Voice does not use your AI provider

Voice is separate from `AI_PROVIDER`. Whatever model you chose for conversation and grading, speech is handled by Amazon services or by the student's browser.

| | Amazon | Student's browser |
|---|---|---|
| **Spoken input** (student speaks) | Amazon Transcribe, in every browser that has a microphone | The browser's own speech recognition. Only some browsers have one; in the others the student is told to type |
| **Spoken replies** (persona is read aloud) | Amazon Polly, in the voice the instructor picked | Not available. Replies appear as text only |

## Choosing what voice uses

Set `VOICE_MODE` on the server and restart.

| `VOICE_MODE` | Spoken input | Spoken replies | Choose it when |
|---|---|---|---|
| `auto` (default) | Amazon Transcribe if the server has AWS access; otherwise, or if Transcribe fails, the student's browser | Amazon Polly if the server has AWS access | You want voice to work with whatever is available |
| `aws` | Amazon Transcribe only. If it is unavailable, students type | Amazon Polly | Audio must never go to a browser maker |
| `browser` | The student's browser only. AWS is never contacted, even if credentials exist | None | You have no AWS account, or do not want voice to use it |
| `off` | None | None | You do not want voice at all. The option stays in the editor but tells instructors it has no effect |

`VOICE_REPLIES=false` turns spoken replies off in any mode, leaving spoken input as it is.

"AWS access" means credentials the server can find: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or, when those are unset, the machine's own role or profile. So in `auto`, a server that has an AWS profile for some other purpose will use it for voice. Use `browser` or `off` to rule that out.

### Seeing what is in effect

- **Server log at start:** one line, for example `[voice] mode=auto; spoken input: Amazon Transcribe (browser if it fails); spoken replies: Amazon Polly`.
- **Instance area, Setup tab:** the **Voice** row says the same, with the AWS region and the reason if something is unavailable.
- **Assignment editor:** the text under **Voice conversation** tells the instructor what students will get on this installation.

At start the server only checks that credentials exist. Whether they are *permitted* to use Transcribe and Polly is found out on first use; a refusal is then remembered until restart, and the three places above update.

## Where the audio goes

Say this to whoever reviews privacy for your institution before turning voice on.

| Path | Audio is sent to | Stored by LTISim? |
|---|---|---|
| Amazon Transcribe | Your AWS account, through your server | No. Audio is relayed and discarded; only the text the student sends is kept |
| Browser speech recognition | Whoever makes the student's browser. In most browsers the audio goes to that company's servers, directly from the student's device | No |
| Amazon Polly | The text of the persona's reply goes to your AWS account | No |

The browser path matters most. If you chose a self-hosted model so that nothing leaves your network, browser recognition does not honour that: it is done by the browser's maker, and your server is not involved. To rule it out, set `VOICE_MODE=aws` or `VOICE_MODE=off`.

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
4. Restart the app and read the `[voice]` line in the log.

The region is `AWS_VOICE_REGION` if set, otherwise `AWS_BEDROCK_REGION`, otherwise `AWS_REGION`, otherwise `us-east-1`. Set `AWS_VOICE_REGION` only if voice should use a different region from Bedrock.

### What each failure does

Each part fails on its own, and none of them stops a session. A refusal is tried once and remembered until restart.

| Problem | In `auto` | In `aws` |
|---|---|---|
| No credentials, or they are rejected | Spoken input moves to the browser; no spoken replies | No spoken input; no spoken replies |
| Transcribe permission refused | Spoken input moves to the browser | No spoken input; students type |
| WebSocket not passed by the proxy | Each student's browser takes over after a short pause | Students are told voice is unavailable |
| Vocabulary permissions refused | Transcribe works, without the assignment's vocabulary | Same |
| Polly permission refused | No spoken replies; text only | Same |

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

Both Amazon services are recorded in the Instance area's **Usage & limits** tab, and both are stopped by the installation's monthly usage limits.

| | Call type | Model ID | Counted as |
|---|---|---|---|
| Spoken input (Transcribe) | `voice` | `aws.transcribe-streaming` | One call per stretch of speech; one "token" per second of audio |
| Spoken replies (Polly) | `voice_reply` | `aws.polly-neural` | One call per reply; one "token" per character read aloud |

When a limit is reached, spoken input and spoken replies stop and the session carries on in text.

No price is shipped, so by default these calls count toward the call limit but not the dollar budget. To put a price on one, add a model in the **Models** tab with the model ID from the table, enter your price per million seconds or characters as the input price (for example, $0.024 per minute of audio is 400), enter 0 as the output price, and then switch the model off so it is not offered to instructors. This follows from how prices are applied; it has not been tried on a running installation.

The browser path costs nothing and records nothing.

## What is fixed

- **Language.** Transcribe is set to US English. The browser path uses the browser's language.
- **Voices.** Eight Polly voices, all US English, chosen per assignment.

## Not verified in this edition

See [Known limitations](Known-Limitations.md). In short: the choice of engine, and what is reported to administrators and instructors, are covered by automated tests. Nobody has yet spoken into a running copy of this edition, on any path. The Transcribe path was in use on the hosted product; spoken replies were never confirmed working there either.

## Troubleshooting

Start with the `[voice]` line in the server log, or the Voice row in the Instance area's Setup tab.

| Symptom | Likely cause |
|---|---|
| No microphone button | Voice is not enabled on the assignment, it is an LLM interaction assignment, or spoken input is off on this installation |
| "Voice input needs microphone access" | The student declined the microphone prompt. Nothing falls back from this; they allow it or type |
| "Voice input is not available in this browser" | `VOICE_MODE=browser`, and this browser has no speech recognition |
| "Voice input is unavailable right now" | Transcribe could not be reached, and either the browser is ruled out (`VOICE_MODE=aws`) or it has no speech recognition |
| Listening starts, then stops, then starts again | In `auto`, Transcribe failed on first use and the browser took over. It happens once; after that the server sends students straight to the browser |
| No spoken replies, and no "Voice on" button | Replies are off: no AWS access, Polly refused, or `VOICE_REPLIES=false`. The server log has a `[voice]` or `[tts]` line saying which |
| Spoken input and replies stop partway through the month | A usage limit was reached |
