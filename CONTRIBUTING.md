# Contributing to BoxOps

Thank you for helping. This page is for people; AI assistants working on
BoxOps follow [AGENTS.md](AGENTS.md), which goes further (the files that
change together, the release rules).

## Where to start

- **A bug, or an idea**: open an issue (**Issues** → **New issue**) and
  fill in its form. For anything bigger than a small fix, agree on it in the
  issue before you write the pull request.
- **A security problem**: never in a public issue or pull request.
  [SECURITY.md](SECURITY.md) says how to report one privately.

## Setting up

You need git; Node.js 24, as [.nvmrc](.nvmrc) says (Node.js 22 from 22.12,
and 26 or later, work too); and, for the unit tests, bash, zsh, jq, rsync
and sha256sum, which run the release workflow's steps and the commands
BoxOps prints for pasting. macOS has them all. GitHub's Ubuntu runners have
all but zsh; elsewhere, jq, rsync and zsh may need installing. (Without
zsh, the tests leave its cases out; CI runs them.) Then, from the
repository's top folder:

```sh
cd web
npm ci
npx playwright install webkit chromium firefox
```

`npm ci` installs the exact versions `package-lock.json` gives. The last
line downloads the browsers the browser tests run in, which Playwright
drives: WebKit (Safari's engine), Chromium (Chrome's and Edge's) and
Firefox.

## Running the app

From `web/`:

```sh
npm run dev
```

The app is then at http://localhost:5173, showing this repository's
roadmap, `roadmap/`, read-only, and reloading when a file changes.
[README.md](README.md#developing-the-app) lists the other commands.

## The checks

From `web/`:

| What | Command |
|---|---|
| Lint (oxlint; a warning fails it) | `npm run lint` |
| Types | `npm run typecheck` |
| Unit tests (Vitest; the docs' links among them) | `npm test` |
| The roadmap's files | `npm run validate` |
| The app builds | `npm run build` |
| Browser tests: WebKit first, then Chromium and Firefox (about 11 minutes) | `npm run e2e` |
| Performance: a 2,000-box roadmap, in WebKit | `npm run perf` |
| The docs' links and anchors | `node scripts/check-doc-links.mjs` |
| The changelog's form | `node scripts/check-changelog.mjs` |

Before `npm run e2e` or `npm run perf`, check that nothing listens on port
4173 (`lsof -nP -iTCP:4173 -sTCP:LISTEN` prints nothing): Playwright uses
a server it finds there, which may serve an old build.

CI (the checks GitHub Actions runs, `.github/workflows/ci.yml`) runs all of
these on every pull request: lint, types, the unit tests, the changelog's
form, the docs' links and validation; then it builds the release tree (the
files a release ships) and runs the browser tests and the performance
checks on it. It also tries the command-line tool and the action, and lints
the workflows. Before you push, run the checks your change needs:
[AGENTS.md](AGENTS.md#checks) lists them by what changed.

## Pull requests

- Small, and on one topic, from a branch of your fork.
- Tests with every change in behaviour: a fix comes with a test that fails
  without it.
- Docs kept in step: `README.md`, `docs/` and `templates/` say what the
  code does, so they change with it. A change a roadmap repository would
  notice goes in `CHANGELOG.md`'s Unreleased section too.
- Screenshots of anything you can see change, before and after.
- Safari (WebKit) first; Chrome, Edge and Firefox must work too.
- Keyboard and screen-reader use keeps working: everything can be done
  without a mouse, and changes are announced.

The pull request's template has this list to tick, and three more items
from the other sections: the checks, commit messages and dependencies.

## Commit messages

Each subject is a plain English sentence of at most 72 characters, saying
what is now true: "The timeline opens at today even if drawn before its
stylesheet is in", not "Fix scroll bug". `Docs: …` and `Tests: …` start a
commit that changes only those. `git log` shows the style.

Dates are written YYYY-MM-DD everywhere: in the app, its messages, the
docs and commits.

## Dependencies

No new runtime dependency for the app without talking it over in an issue
first. The command-line tool and the action bundle what they need into the
release (`dist/boxops.mjs`), so roadmap repositories install nothing. A new
dev dependency needs a reason.

## Changing the data format

A change that needs a new data format comes with a migration, which
BoxOps' `migrate` command runs to bring a roadmap up to the new format, and
follows [docs/data-format.md](docs/data-format.md#changing-the-format):
which changes need one (anything an older BoxOps would read wrongly or
damage), in which release, and what goes with it.

## Releases

Maintainers make releases, with the release workflow:
[docs/releasing.md](docs/releasing.md).

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). To
report a possible violation, email allen@veryboringdata.co.

## Licence

BoxOps is under the MIT licence ([LICENSE](LICENSE)), and what you
contribute is under it too.
