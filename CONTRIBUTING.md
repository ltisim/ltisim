# Contributing to LTISim

Contributions are welcome: bug reports, fixes, documentation, and reports of what did and did not work when you installed it.

## Before you start

- **Something broken?** Open an issue with the steps, what you expected and what happened. Say which AI provider and model you use; behaviour differs between them.
- **Something larger?** Open an issue first and describe what you want to change. It saves you building something that does not fit.
- **A security problem?** Do not open an issue. See [SECURITY.md](SECURITY.md).

Scope of the project today: one installation per institution, self-hosted, tested with Canvas. See [docs/Features.md](docs/Features.md) for what is deliberately not included.

## Setting up

You need Node.js 20 or later and PostgreSQL 14 or later.

```
# database
sudo -u postgres psql -c "CREATE ROLE ltisim LOGIN PASSWORD 'dev'"
sudo -u postgres psql -c "CREATE DATABASE ltisim OWNER ltisim"

# backend
cd backend
cp .env.example .env        # set the DB_* values and LTI_KEY
npm ci
npm test
npm run dev                 # restarts on change

# frontend
cd ../frontend
npm ci
npm run build               # the backend serves frontend/dist
```

Most of the app is only reachable by launching it from an LMS, which needs a public HTTPS address. [docs/Self-Hosting.md](docs/Self-Hosting.md) and [docs/Canvas-Setup.md](docs/Canvas-Setup.md) cover that.

## Making a change

- Keep a pull request to one purpose.
- Add or update tests for behaviour you change. Tests live in `backend/test/` and run with `npm test`; they must not need a database, an LMS or a real AI provider.
- **Update the documentation in the same pull request.** [docs/README.md](docs/README.md) has a table of which document covers what.
- Database changes go in a new numbered file in `backend/db/migrations/`. Never edit a migration that has been released.
- Nothing about a specific model belongs in the code: no model names, prices or capability tables. Models are configured by each installation.
- Secrets are read from the environment only. Do not add a way to enter or display one in the web interface.
- Text shown to people should not assume a particular LMS or AI provider unless the feature really is specific to one.

## Contributor License Agreement

Before your first contribution can be merged, you need to agree to the [Contributor License Agreement](CLA.md). You keep ownership of your work; the agreement gives the project the rights it needs to distribute it, including in the owner's hosted version.

To agree, add this line to your pull request description:

> I have read the LTISim Contributor License Agreement and I agree to it.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
