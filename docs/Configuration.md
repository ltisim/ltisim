# Configuration reference

LTISim is configured in two places:

- **The server's environment** (`backend/.env`): anything tied to infrastructure or secrets. Changes need a restart.
- **The Instance area in the web interface**: everything an administrator may change while it runs. See [Instance administration](Instance-Admin.md).

Secrets are only ever set in the environment. No password, API key or token can be entered or viewed in the web interface.

A commented template of every setting is in `backend/.env.example`.

## Settings in the Instance area

| Setting | Where |
|---|---|
| Which models instructors may choose | Models |
| Default conversation model and default grading model | Models |
| Optional price per model, for spend tracking | Models |
| Monthly AI call limit | Usage & limits |
| Monthly budget in USD | Usage & limits |
| Who receives usage alerts | Usage & limits |

## Environment variables

### Server

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PUBLIC_URL` | Yes | | The public HTTPS address of this installation. Tool URLs given to the LMS are built from it. `FRONTEND_URL` is accepted as an older name |
| `PORT` | No | `3000` | Port the app listens on. The example file sets `3001` |
| `HOST` | No | all interfaces | Address to listen on. Use `127.0.0.1` behind a reverse proxy on the same machine |
| `NODE_ENV` | No | | Set to `production` |
| `TRUST_PROXY_HOPS` | No | `1` | Number of reverse proxies in front of the app |
| `LOG_VERBOSE` | No | off | `1` logs full requests, including personal data. For debugging only |

### Database

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Yes | | PostgreSQL connection |
| `DB_SSL` | No | off | `true` requires TLS to the database |
| `DB_SSL_CA` | No | system CAs | Path to a CA bundle, if your database needs one |
| `DB_AUTO_MIGRATE` | No | on | `false` stops the app applying database changes at startup; run `npm run db:migrate` yourself |

### LTI

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LTI_KEY` | Yes | | Signs session tokens and encrypts the LMS registration. Generate once; **changing it makes the existing registration unreadable** |
| `TOOL_NAME` | No | `LTISim` | Name shown in the LMS. Applied at registration time |
| `LTI_SESSION_HOURS` | No | `24` | How long a launch stays valid before the person must reopen the tool from the LMS |
| `LTI_DEV_MODE` | No | `false` | `true` relaxes launch cookie checks. Needed when browsers block third-party cookies inside the LMS frame |

### Connecting the LMS

Leave these unset to use the registration link printed at startup. See [Canvas setup](Canvas-Setup.md).

| Variable | Default | Purpose |
|---|---|---|
| `SETUP_TOKEN` | random per start | Fixes the token in the registration link |
| `LMS_TYPE` | | `canvas-cloud`, `canvas-self` or `moodle`. Fills in the standard endpoints |
| `LMS_URL` | | Your LMS address |
| `LMS_CLIENT_ID` | | Client ID of the developer key. Setting it triggers registration at startup if no LMS is registered |
| `LMS_NAME` | `LMS_URL` | Display name |
| `LMS_ISSUER`, `LMS_AUTH_ENDPOINT`, `LMS_TOKEN_ENDPOINT`, `LMS_KEYSET_URL` | from `LMS_TYPE` | Overrides for non-standard setups |

### Instance administrators

| Variable | Default | Purpose |
|---|---|---|
| `INSTANCE_ADMIN_ROLES` | on | `false` stops treating LMS administrators as instance administrators |
| `INSTANCE_ADMIN_USER_IDS` | | Comma-separated LTI user IDs who are instance administrators. Preferred over email: the ID cannot be edited by the user |
| `INSTANCE_ADMIN_EMAILS` | | Comma-separated email addresses who are instance administrators |

A person is an instance administrator if any one of these matches.

### AI provider

See [Model providers](Model-Providers.md) for what each provider needs.

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `bedrock` | `anthropic`, `openai-compatible` or `bedrock` |
| `AI_API_KEY` | | API key for `anthropic` and `openai-compatible` |
| `AI_BASE_URL` | provider's own | Endpoint. Required for most `openai-compatible` servers |
| `AI_EXTRA_HEADERS` | | JSON object of extra request headers (`openai-compatible`) |
| `AI_MAX_TOKENS_PARAM` | `max_tokens` | `max_tokens` or `max_completion_tokens` (`openai-compatible`) |
| `AI_TIMEOUT_MS` | `120000` | Request timeout (`openai-compatible`); streaming requests allow ten minutes |
| `AWS_BEDROCK_REGION` | `us-east-1` | AWS region (`bedrock`). Also the region for voice, which defaults to `us-east-2` when this is unset |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | machine credentials | AWS credentials (`bedrock`, voice). Leave unset to use the machine's own AWS role or profile |
| `AI_MODEL`, `AI_GRADING_MODEL` | | Default models, as an alternative to choosing them in the Instance area. A choice made in the Instance area takes precedence |

### Voice (optional)

Voice is independent of `AI_PROVIDER`. Spoken input uses Amazon Transcribe when the server has AWS access and falls back to the student's browser otherwise; spoken replies use Amazon Polly and have no fallback. [Voice](Voice.md) covers the permissions needed, where audio goes, and cost. There is no variable that turns voice on: instructors enable it per assignment.

These limits apply to spoken input through Transcribe:

| Variable | Default | Purpose |
|---|---|---|
| `VOICE_SESSION_MAX_SECONDS` | `1800` | Total spoken input allowed per session |
| `VOICE_STREAM_MAX_SECONDS` | `300` | Longest single stretch of spoken input |
| `VOICE_IDLE_SECONDS` | `15` | Silence after which the stream closes |

### Outgoing email (optional)

Used only to send usage-limit alerts. With these unset, alerts are not emailed and nothing else is affected.

| Variable | Default | Purpose |
|---|---|---|
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | | Mail server and login. All three are needed |
| `SMTP_PORT` | `587` | `465` uses implicit TLS |
| `SMTP_FROM` | `SMTP_USER` | From address |
| `ALERT_EMAIL` | `SMTP_USER` | Fallback recipient when none is set in the Instance area |

### Other

| Variable | Purpose |
|---|---|
| `LEARNING_CONTENT_IFRAME_HOSTS` | Comma-separated hosts allowed in embedded learning content |
