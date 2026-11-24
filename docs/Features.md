# Features

What this release includes, what it leaves out, and how it differs from the hosted multi-tenant product it was derived from.

Scope of this release: **one installation, one institution, Canvas.**

## Included

### For students

- Role-play sessions with an AI persona, opened directly from a Canvas assignment.
- Replies that stream as they are written.
- Spoken input: Amazon Transcribe when AWS credentials allow, otherwise the browser's own speech recognition.
- Practice sessions that do not count toward the grade, where the instructor allows them.
- Feedback against the rubric once it is released.

### For instructors

- Five assignment types:

  | Type | What it is |
  |---|---|
  | Simulation | A conversation with a persona in a scenario |
  | Staged simulation | A simulation that moves through defined stages |
  | Simulation with write-up | A conversation followed by a written piece, graded together |
  | AI examiner | The AI leads, asking questions across defined topic areas |
  | LLM interaction | Open work with an AI assistant, graded on what the student accomplishes |

- AI help with drafting an assignment, refining a field, and critiquing a rubric.
- Preview chat and a test grade before publishing.
- Rubric-based AI grading with cited evidence, and example answers per criterion to steer it.
- Three ways to release results: immediately, after instructor review, or automatically only when the AI is confident.
- A review queue, per-assignment analytics, and a course roster.
- Blind grading: score a session before seeing the AI's grade, to measure agreement.
- Per-assignment choice of conversation and grading model, from the models the administrator allows.
- Copy an assignment to another of your courses; export and import an assignment as a file.
- Three sample assignment templates.
- Grades returned to the Canvas gradebook, with retry if Canvas is unavailable.

### For the LMS administrator

- Registration with Canvas by pasting one link, or by a hand-made developer key.
- Instance area inside the tool: setup checklist, model list and defaults, connection test, usage and limits, grading agreement, audit log, data export.
- Monthly AI call limit and budget, with email alerts.
- No separate accounts or passwords: access comes from the person's role in Canvas.

### For the person running it

- One process serving the pages, the API and the LTI endpoints.
- Database tables created and upgraded automatically on startup.
- Three AI providers: Anthropic API, any OpenAI-compatible API, AWS Bedrock.
- All secrets in the server's environment, none in the database or the web interface.

## Not included

| Not in this release | Notes |
|---|---|
| LMSs other than Canvas | The standard LTI 1.3 flow and Moodle endpoint presets are in the code, but nothing other than Canvas has been tested |
| More than one LMS per installation | By design. Run a second installation for a second institution |
| Accounts, passwords, or a login page | By design. Everything is reached by launching from the LMS |
| An administrator view across all courses' sessions | Administrators launch into a course to manage it |
| Shared templates curated by the administrator | Only the three built-in samples; no way to add to the gallery from the interface |
| Deleting or anonymising one student's data, and automatic retention | Not built |
| Model prices | None are shipped. Spend is tracked only for models you price yourself |
| Grading validation for non-Anthropic models | Not measured. See [Model providers](Model-Providers.md) |
| The grading validation scripts | The method and results are documented, but the scripts depended on private data and are not included |
| Spoken AI replies | The code path exists (Amazon Polly) but is not enabled |

## Differences from the hosted product

The hosted product serves many institutions from one deployment. This edition removes that layer.

| Hosted (multi-tenant) | This edition |
|---|---|
| Many institutions, each an isolated tenant, each with one or more LMS connections | One institution, one LMS |
| Operator portal with its own email-and-password login | Removed. Its useful parts moved into the in-LMS Instance area |
| Read-only institution portal with its own login | Removed |
| The operator registers each LMS in the portal, or mints an invitation link | The installation prints one registration link at first start, or reads the LMS from its environment |
| Usage limits per tenant | One set of limits for the installation |
| Monthly usage statements emailed per tenant | Removed |
| AWS Bedrock only, with a fixed list of models and prices | Three providers; models and prices entered by the administrator |
| The operator can view, regrade and release any session across tenants | Removed; done by launching into the course |
| The operator promotes assignments into a shared gallery | Removed; three built-in samples |
| Data export per tenant | Data export for the whole installation |
| Roles matched loosely by keyword | Roles matched exactly, per course |
| Session tokens never expire | A launch is valid for 24 hours by default |
| The course is inferred from the Canvas deployment | The course is recorded from each launch, which is what makes account-level installs work |

What did not change: the assignment types, the authoring tools, the grading method, the review workflow, voice input, and the student experience.
