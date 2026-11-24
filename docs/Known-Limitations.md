# Known limitations

Open issues in this edition, most important first. Each says what the problem is and what to do about it meanwhile.

## Not yet verified

These are untested, not known to be broken.

| Area | State | Meanwhile |
|---|---|---|
| Sessions beyond a single test | One complete student session from a Canvas assignment is verified end to end on the Anthropic API, including the score being sent to Canvas. Several students at once, the other assignment types, and review-before-release have not been run on this edition | Run a rehearsal in a test course before real use |
| Installing on a separate machine | Starting from an empty database is verified with Node directly and with Docker Compose, on the development server. A full install elsewhere by someone following the guide, including the reverse proxy, is not | Follow [Self-hosting](Self-Hosting.md) and report what needed adjusting |
| OpenAI-compatible provider | Tested only against simulated responses. (The Anthropic API provider is verified live) | Use the Test button on each model after setup |
| AWS Bedrock after this edition's changes | A live request reached AWS; a successful reply was not confirmed | Use the Test button |
| Teacher and student launches | The role rules are unit-tested, and an administrator launch is verified live; a real teacher or student launch is not | Test with Canvas Student View and a teacher account |
| Canvas account-menu entry | Registered but never launched | Use the Instance tab from a course |
| Manual developer-key setup | Only the registration link has been used | Prefer the registration link |
| LMSs other than Canvas | Not tested | Canvas only |
| Voice | How the engine is chosen (`VOICE_MODE`) is covered by automated tests, and the status shown at start is verified. Nobody has yet spoken into a running copy of this edition: not through Amazon Transcribe, not through the browser, and no reply has been heard through Amazon Polly. Spoken replies were never confirmed working on the hosted product either | Try an assignment with voice in a test course, in each browser your students use, before offering it |

## Grading quality depends on your model

Grading was validated only on Anthropic models through AWS Bedrock. Grading asks the model for a structured result by instruction alone; a model that does not follow it produces a result that cannot be read, and the session waits in "evaluation pending" while the system retries.

Meanwhile: collect blind grades and read the Grading agreement view before using automatic release.

## Voice depends on Amazon or the student's browser

Voice is not routed through your AI provider. Spoken input uses Amazon Transcribe or the student's browser, which works in only some browsers and usually sends audio to the browser's maker. Spoken replies need Amazon Polly and have no alternative. On the Amazon path the language is fixed to US English.

Meanwhile: read [Voice](Voice.md) and choose a `VOICE_MODE`. If audio must not go to a browser maker, use `aws` or `off`.

## Bedrock cannot tell which models think first

On the Anthropic API, LTISim asks what each model supports and gives thinking models extra room for output. Bedrock offers no equivalent lookup here, so a newer Bedrock model may have replies or grading results cut short.

Meanwhile: raise **Longest reply** on affected assignments.

## Launch cookie checks may need relaxing

Browsers increasingly block third-party cookies inside the LMS frame, which breaks strict launch validation in some browsers.

Meanwhile: set `LTI_DEV_MODE=true`. This relaxes one check on the launch; the launch itself is still verified against the LMS's signature.

## The session token travels in the address

After launch, the tool's session token is passed in the page address and kept in the browser tab's session storage. It is valid for 24 hours by default and only for the launch it belongs to, but anyone who obtains the address within that time could act as that person in that course.

Meanwhile: keep `LTI_SESSION_HOURS` low if this matters to you, and do not enable `LOG_VERBOSE` in production.

## No per-student deletion or retention

There is no way in the interface to delete or anonymise one student's data, and nothing is deleted automatically. Transcripts are kept until the database is cleaned by hand.

## Budget limit ignores unpriced models

The monthly budget counts only calls to models that have a price. The call limit counts everything.

Meanwhile: use the call limit as the hard stop, or price every model.

## One server process

Rate limits are not applied, and some state (which models reject which settings, the generated setup token) is held in memory. The app is meant to run as a single process; it has not been run as several behind a load balancer.

## Depends on the LTI library's own tables

Grade return reads two tables that belong to the LTI library (`ltijs`). An upgrade of that library could change them. The library versions are not yet pinned.

## Reference documentation is missing

There is no architecture, API or database reference for this edition yet. The [documentation index](README.md) says where to look in the code meanwhile. `Cost-Analysis.md` and `AI-Grading-Validation.md` were written for the hosted product and carry a notice saying how to read them.
