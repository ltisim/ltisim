# LTISim

AI role-play and simulation assignments that run inside your learning management system.

An instructor describes a scenario and a rubric. Students open the assignment from the LMS and hold a conversation with an AI playing a role: a patient, a client, an examiner. The session is then scored against the rubric with cited evidence, the instructor reviews it, and the grade goes back to the LMS gradebook.

LTISim is self-hosted: one installation serves one institution's LMS, and you bring your own AI model.

> **Status: pre-release.** This edition has been derived from a hosted product and is not yet packaged for general use. See [Project status](#project-status) for what has and has not been verified.

## What you need

- **Canvas** as your LMS. Canvas is the only LMS this release has been tested with.
- **A server** with Node.js 20 or later and PostgreSQL 14 or later, reachable at a public HTTPS address.
- **An AI provider account**, one of:
  - the Anthropic API
  - any OpenAI-compatible API (OpenAI, Azure OpenAI, Ollama, vLLM, LiteLLM and similar)
  - AWS Bedrock (Anthropic models)

## How it fits together

| Who | Where | What they do |
|---|---|---|
| Person installing | The server | Sets the public address, database, and AI credentials in `.env`, then starts the app |
| LMS administrator | Canvas, then the tool's **Instance** area | Registers the tool with one link; lists models, picks defaults, sets usage limits |
| Instructor | The tool's dashboard, opened from a course | Builds assignments, links them to Canvas assignments, reviews and releases results |
| Student | A Canvas assignment | Holds the conversation and sees feedback |

There is no separate login. Everyone reaches the tool by launching it from the LMS, and what they may do comes from their role there.

## Getting started

1. [Self-hosting](docs/Self-Hosting.md): install and start the app.
2. [Canvas setup](docs/Canvas-Setup.md): register the tool with Canvas.
3. [Model providers](docs/Model-Providers.md): connect your AI provider and choose models.
4. [Instance administration](docs/Instance-Admin.md): limits, usage, audit log, data export.
5. [Assignment editor guide](docs/assignment-editor-guide.md): for instructors.

Reference:

- [Configuration](docs/Configuration.md): every environment variable.
- [Features](docs/Features.md): what is included, and what is not.
- [Known limitations](docs/Known-Limitations.md)
- [Documentation index](docs/README.md), including which older documents still describe the hosted product.

## About grading quality

LTISim grades with whichever model you configure, and grading quality depends on that model.

The grading validation described in [AI-Grading-Validation.md](docs/AI-Grading-Validation.md) was measured **only on Anthropic models through AWS Bedrock**. No other model or provider has been validated. If you use something else, treat AI scores as unverified until you have checked them yourself.

The tool gives you the means to check: instructors can grade a session before seeing the AI's score, and the **Grading agreement** view shows how often the two match on your own rubrics. Collect that evidence before relying on automatic release of grades.

## Project status

Verified against a live Canvas instance:

- Registering the tool with Canvas by link (dynamic registration)
- Launching from a course as an LMS administrator, in more than one course
- The instructor dashboard and the Instance area

Verified against the Anthropic API, driving the app's own API with a simulated student:

- Listing models, the connection test, a streamed conversation, and rubric grading with per-criterion scores and evidence
- A student being refused instructor routes

Covered by automated tests only (no live run yet):

- The OpenAI-compatible provider
- Role handling for teachers

Not yet verified in this edition:

- A session started by a real student from a Canvas assignment, and the grade returning to the Canvas gradebook
- A full install on a separate machine by someone following the guide. (Starting from an empty database is verified, with Node directly and with Docker Compose)
- Any LMS other than Canvas

## Development

```
cd backend  && npm ci && npm test        # unit tests
cd frontend && npm ci && npm run build   # production build, served by the backend
```

The backend serves the built frontend, the API, and the LTI endpoints from one process. See [Self-hosting](docs/Self-Hosting.md) for running it.

## License

[Apache License 2.0](LICENSE). Copyright 2025-2026 Tim Schwichtenberg; see [NOTICE](NOTICE).

- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under the [Contributor License Agreement](CLA.md).
- **Security:** report problems privately; see [SECURITY.md](SECURITY.md).
- **The name:** "LTISim" is not covered by the license. A modified version must use a different name; see [TRADEMARKS.md](TRADEMARKS.md).
- **Contact:** contact@ltisim.com
