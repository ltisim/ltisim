# Instance administration

The Instance area is where an administrator manages the whole installation: the LMS connection, models, usage limits, grading evidence, the audit log and data export.

## Getting there

There is no separate login. Launch the tool from your LMS as an administrator:

- **From a course:** open **LTISim** in the course menu. The dashboard shows an **Instance** tab next to Assignments, Students and Review Queue.
- **From the Canvas account admin menu:** an **LTISim** entry opens the Instance area directly, with no course involved. This entry is registered but has not yet been tested.

Only instance administrators see the tab, and the server refuses every Instance request from anyone else. By default, instance administrators are the administrators of your LMS; see [Canvas setup](Canvas-Setup.md#who-counts-as-an-administrator) to change that.

## Setup

The first tab. It opens with a checklist of what is configured and what is not, with a fix for each item:

| Check | Passes when |
|---|---|
| Public address uses HTTPS | `PUBLIC_URL` on the server starts with `https://` |
| Learning platform connected | An LMS is registered and has launched at least once |
| Models listed | At least one model is available to instructors |
| Default model chosen | A default conversation model is set |
| AI provider responds | You press **Test connection** and the default model answers |
| Outgoing email (optional) | The server has mail settings. Only needed for usage alerts |

Below the checklist:

- **Learning platform:** the registered LMS, its issuer, client ID, status and dates. One installation serves one LMS; replacing it is done on the server because it removes all course data.
- **Tool URLs:** the launch, login, key and redirect addresses, with copy buttons. They are built from the installation's public address and are only needed when configuring the LMS by hand.
- **Export all data:** see [Data export](#data-export).
- Counts of courses, assignments, sessions and people, and the LTISim version.

## Models

Covered in full in [Model providers](Model-Providers.md). In brief:

- **Defaults:** the conversation and grading models used by every assignment that does not choose its own.
- **Available models:** rename, hide, test, and optionally price each model.
- **Find models from your provider:** list what your account offers and add with one click (Anthropic API and OpenAI-compatible providers).
- **Add a model by ID:** for anything not listed.

The provider itself and its credentials are set on the server.

## Usage & limits

- **This month:** calls and spend against your limits.
- **Monthly limits:** an AI call limit, a budget in USD, and the address that receives alerts at 80% and 100%.
- **Breakdowns:** calls per day for the last 30 days, and totals by model, by type of call, and by assignment.

Spend appears only for models with a price entered. Until then the view says spend is not tracked, and the call limit is the control to use. See [Usage and cost](Model-Providers.md#usage-and-cost).

Alert emails need the server's mail settings; without them the limits still apply but no email is sent.

## Grading agreement

How often the AI's grade matches an instructor's, across all courses. It is built from sessions an instructor graded before seeing the AI's score; each pair is one rubric criterion scored by both.

It shows the share of criteria where both chose the same level, the average gap in points, and the same figures split by the AI's stated confidence and by assignment.

This is your evidence for how well your chosen grading model works on your rubrics. It is empty until instructors record blind grades from a session's review page.

## Audit log

A record of registration events, rejected launches, and every change made in the Instance area: settings, models, and data exports. Filter by event type.

It does not record ordinary instructor or student activity.

## Data export

**Download export** on the Setup tab produces one JSON file containing everything the installation holds: the LMS registration, courses, people, enrolments, assignments, templates, sessions with full transcripts, grades, feedback, grading agreement, AI usage, models, settings and the audit log.

- It contains student names, email addresses and conversations. Store it as you would any student record.
- Each export is recorded in the audit log.
- It is for records requests and portability. It cannot be loaded back in, so it does not replace a database backup (see [Self-hosting](Self-Hosting.md#backups)).

## What is not here

Things an administrator might look for that this release does not have:

| Not available | Instead |
|---|---|
| Viewing, regrading or releasing a session in any course from one place | Launch into that course; instance administrators can manage any course they launch into |
| Promoting an instructor's assignment to a shared template | Three sample templates are installed at first start. Instructors can export an assignment as a file and import it into another course |
| Editing or disabling the LMS registration | `npm run platform:reset` on the server, or edit the developer key in Canvas |
| Changing the AI provider or mail settings | The server's `.env`, then restart |
| Deleting or anonymising one student's data | Not built. It requires working directly in the database |
| Automatic deletion of old data | Not built |
