# GoodNight

GoodNight is a local, deterministic tool for UESTC's “Good Night Chengdian” portal. It uses Node.js and Playwright to inspect today's record and service window, then tries check-in first using real GCJ-02 location and an available valid dormitory geofence. It may fall back to a report only under the rules below. The daily flow does not use an LLM.

## Status

The original macOS automation completed a report in authenticated Chrome at 22:30 on 2026-10-10. A later read found that day's `STUDENT_REPORTED` and `INSTRUCTOR_REPORTED` states and matching content. This validates the original macOS flow only. The new portable repository has not yet passed a school end-to-end test. Windows and Linux location and authentication are unverified. CI runs offline synthetic tests only.

This tool sends a real check-in or report to the school. Review the configuration and `run --dry-run` output. Make sure the action reflects your circumstances and follows school requirements. Only the current UESTC flow is implemented; other schools are not automatically supported.

## Requirements and quick start

- Node.js 22 or later and npm
- macOS, Windows, or Linux
- Installed Chrome is recommended. You complete login, OAuth, or CAPTCHA yourself in a visible browser window.
- Location requires a real OS/browser location provider and a location suitable for the intended action.

```sh
git clone https://github.com/beichenO2/GoodNight.git
cd GoodNight
npm ci
node bin/goodnight.mjs init
node bin/goodnight.mjs login
node bin/goodnight.mjs doctor
node bin/goodnight.mjs check
node bin/goodnight.mjs run --dry-run
```

`init` collects a 10–200 UTF-16 code-unit remark, keyword (default `旅游`, combined with the `OUTSIDE` location type), daily time (default `22:30`), and browser. The default remark is `在校外旅游会注意自己安全，导员放心`; press Enter to use it, or omit `--remark` in non-interactive mode. Custom remarks must meet the same length limit. Options include `--remark`, `--keyword`, `--time`, and `--browser`.

`login` opens GoodNight's isolated browser profile. In that window, complete unified authentication and click “晚安成电”; then return to the terminal and press Enter for an online business-authentication check. Logging in through your ordinary browser does not transfer the session to this isolated profile. `doctor` performs local checks by default; add `--online` to check online authentication. `check` reads today's record without submitting. `run --dry-run` checks the time window, real location, and form without sending either POST.

`run` tries check-in during the school's check-in window using real GCJ-02 location and an available valid dormitory geofence. If no valid dormitory geofence is available, or check-in is definitively rejected, it reads today's record again using the current authenticated session. It may fall back to reporting only if that fresh record remains `PENDING` and the actual location is suitable for reporting. The default `OUTSIDE` report applies only when the actual location is classified outside campus; campus location is never mislabeled as outside. An ambiguous check-in POST or timeout never triggers blind report fallback. Separate durable per-date journals are written before each operation's POST. If an outcome is unclear, run `check` first.

Browser choices are `chrome` (default), `msedge`, and `chromium`. Prefer installed Chrome or Edge. To use Playwright Chromium, run `npx playwright install chromium` and initialize with `--browser chromium`. Installing Chromium does not provide real campus location. Location first uses `uni.getLocation`; if unavailable, Acorn parses the current same-origin entry and student-page modules to identify the named import actually called with `{type: "gcj02", success, fail}` and its entry export. A missing or changed contract fails closed; the code does not guess aliases.

## Daemon and service

```sh
node bin/goodnight.mjs daemon
node bin/goodnight.mjs status
node bin/goodnight.mjs service install
node bin/goodnight.mjs service remove
```

The daemon checks scheduling every 30 seconds. By default it performs one read-only authenticated and real-location preflight from 22:10 to (but not including) 22:30, then starts the existing 22:30 submission flow. The existing 30-minute quick catch-up remains; eligible transient failures that have not submitted are retried every two minutes within its deadline; after that path is missed or exhausted, recovery checks can run every 10 minutes until the exclusive 23:55 cutoff, subject to the school’s own windows. Ambiguous POST outcomes are reconciled by GET and are never blindly repeated. An existing macOS 600-second keeper runs preflight on its first tick inside the window, not at an exact 22:10 trigger. Installing the service does not immediately submit outside the applicable window. It runs as the current user; keep the machine on and connected with the user session available. The service refers to the absolute checkout and Node paths used at installation; reinstall it after moving the checkout. `service install --write-only` writes the service definition without enabling it. The daemon does not hot-reload configuration; restart or reinstall its service after editing config. See [resilience and recovery](docs/resilience.md) for journaling, failure status, and notification behavior.

## Private data and recovery

Config, browser profile, authentication state, logs, and runtime state live outside the repository. Defaults are macOS `~/Library/Application Support/GoodNight`, Windows `%LOCALAPPDATA%\GoodNight`, and Linux `$XDG_STATE_HOME/goodnight` or `~/.local/state/goodnight`. Override with `GOODNIGHT_HOME` or `--data-dir PATH`. Do not commit private data or copy a browser profile across OSes or accounts; log in again on the new machine.

The server-side session lifetime is unknown. Periodic client access only extends client-side retention. Treat `need_login` as a failure and log in again.

An exclusive lock and separate durable per-date check-in and report journals prevent blind repeats after a crash or timeout. `frontendLocationExport` defaults to `auto`, which resolves the export from the current frontend source contract. Legacy explicit values such as `bk` and `bl` remain readable but are deprecated and do not override source discovery. If a unique valid binding cannot be found, the operation fails closed rather than guessing or using an LLM repair. `maxAccuracyMeters` defaults to 200 m; unknown or less precise readings stop the operation. Adjust it only for the genuine provider's actual accuracy, never to use a fixed location.

## Development

```sh
npm ci
npm test
```

CI runs offline tests on Node.js 22/24 and Ubuntu, macOS, and Windows, including synthetic tests for service-definition generators. These test candidate migration code; they do not establish that services were installed on those operating systems or that school E2E, GPS, or authentication works there. The [2026-10-12 location-export incident](docs/incidents/2026-10-12-location-export.md) also records shared-locator testing on macOS and read-only checks with the new adapter; neither establishes full E2E completion of the new CLI. See [architecture](docs/architecture.md), [portability](docs/portability.md), [resilience and recovery](docs/resilience.md), and the [source audit](docs/source-audit.md).
