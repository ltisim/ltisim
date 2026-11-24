# Security policy

LTISim handles student names, email addresses, conversation transcripts and grades. Please report security problems privately so they can be fixed before they are widely known.

## Reporting a vulnerability

Email **security@ltisim.com**. Do not open a public issue.

Include what you can of:

- what the problem is and what it allows;
- how to reproduce it;
- the version or commit you tested;
- whether you believe it is being exploited.

You will get an acknowledgement, and updates as the report is investigated. If you would like credit when the fix is released, say so.

Please give a reasonable time for a fix before publishing details, and do not access, change or delete data that is not yours while testing.

## Supported versions

Security fixes are made to the latest release only.

## Things worth knowing when you deploy

These are properties of the design, not vulnerabilities, but they affect how you should run it.

- **Access comes from the LMS.** There are no LTISim accounts. What a person may do is decided by the role your LMS reports for them at launch, so who is an administrator in your LMS matters. You can name instance administrators explicitly instead; see [docs/Configuration.md](docs/Configuration.md).
- **The session token travels in the page address** after launch and is valid for 24 hours by default. Keep `LTI_SESSION_HOURS` low if that matters to you.
- **`LTI_KEY` protects everything.** It signs session tokens and encrypts the LMS registration. Anyone who has it can act as any user. Keep it out of backups you share and out of version control.
- **Secrets live in the environment file.** Restrict who can read `backend/.env`.
- **`LOG_VERBOSE=1` writes personal data and tokens to the log.** Use it only briefly, for debugging.
- **Student conversations are sent to the AI provider you configure.** Check that provider's data handling against your institution's obligations.
- **A data export contains everything**, including transcripts. Each one is recorded in the audit log.

Known open issues are listed in [docs/Known-Limitations.md](docs/Known-Limitations.md).
