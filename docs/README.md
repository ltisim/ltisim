# Documentation

When the software changes, change the matching document in the same piece of work. The "Covers" column says what each document is responsible for.

## Current

Written for this edition (single institution, self-hosted, Canvas).

| Document | For | Covers |
|---|---|---|
| [../README.md](../README.md) | Everyone | What LTISim is, what you need, project status |
| [Self-Hosting.md](Self-Hosting.md) | Person installing | Install, configure, run, reverse proxy, upgrade, backup, commands, troubleshooting |
| [Canvas-Setup.md](Canvas-Setup.md) | LMS administrator | Registering with Canvas, placements, who counts as an administrator, re-registering |
| [Model-Providers.md](Model-Providers.md) | Person installing, LMS administrator | The three providers, adding models, defaults, how models are handled, usage and cost |
| [Instance-Admin.md](Instance-Admin.md) | LMS administrator | Each tab of the Instance area, data export, what is not there |
| [Configuration.md](Configuration.md) | Person installing | Every environment variable and every in-app setting |
| [Features.md](Features.md) | Everyone | What is included, what is not, differences from the hosted product |
| [Known-Limitations.md](Known-Limitations.md) | Everyone | Untested areas and open issues, with workarounds |
| [assignment-editor-guide.md](assignment-editor-guide.md) | Instructors | Building assignments. Written for the hosted product, but the editor is unchanged apart from the AI Config tab |

## Carried over

Written for the hosted multi-tenant product and kept because they stand on their own. Each has a notice at the top.

| Document | Read it as |
|---|---|
| [AI-Grading-Validation.md](AI-Grading-Validation.md) | The method and results of the grading validation. They apply to Anthropic models on AWS Bedrock only, and the scripts it refers to are not included in this edition |
| [Cost-Analysis.md](Cost-Analysis.md) | A method for estimating cost. Its figures are for specific Bedrock models at the prices in effect when it was written; this edition ships no prices |

## Not written yet

Reference documentation for this edition's architecture, HTTP API and database does not exist yet. Until it does:

| For | Look at |
|---|---|
| The database | `backend/db/migrations/`, which is the schema |
| The HTTP API | `backend/src/routes/`: `simulation.js` (students), `admin.js` and `authoring.js` (instructors), `instance.js` (administrators) |
| How a launch is handled | `backend/src/config/lti.js` and `backend/src/utils/launch.js` |
| How models are called | `backend/src/services/ai/` |

## What changed where

A map from parts of the software to the documents to update.

| If you change | Update |
|---|---|
| An environment variable | Configuration.md, and `backend/.env.example` |
| Registration, placements, or role rules | Canvas-Setup.md |
| A provider, or how models are handled | Model-Providers.md |
| Anything in the Instance area | Instance-Admin.md |
| Install, run, upgrade or backup steps | Self-Hosting.md |
| Add or remove a feature | Features.md |
| Fix or find a limitation, or verify something untested | Known-Limitations.md, and Project status in the README |
