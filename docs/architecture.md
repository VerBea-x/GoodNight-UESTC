# Architecture

## Runtime flow

GoodNight is a deterministic Node.js command-line program backed by Playwright. The current adapter targets one service: UESTC's “Good Night Chengdian” portal. The runtime should fail closed whenever a required page element, option, or location function cannot be identified.

The daily operation flow is:

Location defaults to the device/browser provider (`locationMode: "real"`). With `locationMode: "virtual"`, the adapter returns validated `virtualLocation` GCJ-02 coordinates directly, without invoking the browser location provider. Preflight and check-in use the same selected provider. Virtual mode is check-in only: school windows, dormitory circles, submission journals and saved-record verification still apply, but failure does not fall through to a report. Use the CLI `location` command to save coordinates and optionally change the daily time, then restart a running daemon/service to load them.

1. Load per-user configuration and the authenticated current-day record and server schedule.
2. Obtain real location through the frontend API with GCJ-02 requested; reject unknown or over-limit accuracy (default 200 m).
3. During the check-in server window, try check-in using available valid dormitory geofences.
4. If no valid dormitory geofence is available or check-in is definitively rejected, fetch a fresh record using the current authenticated session. Fall back to report only if it remains `PENDING` and actual location permits that report type. The default `OUTSIDE` type is valid only for an actually outside-campus location.
5. Read the saved record. For check-in verify the date and `CHECKED_IN` status; for a report verify date, `STUDENT_REPORTED`, location type, category, and configured text.

`run --dry-run` performs preflight, including actual location, but does not issue either the check-in or report POST. `check` reads the current day's saved school record. A missing or mismatching saved record is not success.

## Reliability and scheduling

An exclusive lock prevents concurrent local runs. Separate per-date, per-operation exclusive claim files are synchronously flushed before check-in and report POSTs. A restart or ambiguous POST with a claim present performs GET reconciliation rather than repeating that POST. A timeout or other ambiguous check-in outcome blocks report fallback; the system must not infer rejection from a missing response. If a crash or timeout leaves an uncertain outcome, only a verified saved school record establishes success; use `check` before taking further action. Local flush/rename patterns do not guarantee survival of every power loss or server-side record retention.

The daemon uses `Asia/Shanghai` regardless of host timezone and checks scheduling every 30 seconds. Its default 20-minute preflight window is once per day before the configured report time; preflight validates the business session and real location without check-in/report POSTs. The existing 30-minute quick catch-up remains, followed by recovery checks every 10 minutes until the exclusive 23:55 cutoff, subject to server windows. An existing macOS 600-second keeper samples the preflight window at its first tick inside the window, not at an exact 22:10 time. See [`resilience.md`](resilience.md) for failure archives, alert limits, and restart behavior.

## Local data and trust boundaries

Configuration and browser state live in the OS-specific user data directory, outside the checkout. They can be redirected using `GOODNIGHT_HOME` or `--data-dir`. Authentication happens in the user's browser profile; cookies or storage state must not be exported into logs or source control. After successful server validation, SESSION receives a minimum seven-day local retention period without shortening an existing longer expiry. Failed requests and rejected authentication do not extend it. This helps preserve credentials through connection outages; it does not establish or change the school's server-side session lifetime. See the [October 14 investigation](incidents/2026-10-14-session-expiry.md).

Location first checks and invokes `globalThis.uni.getLocation`, bound to its owning `uni` object. If unavailable, an Acorn AST parser discovers the current same-origin entry module and student-page chunk, identifies the named import actually called with `{ type: "gcj02", success, fail }`, verifies that the entry module exports that name, then dynamically imports the entry and invokes that export. The `frontendLocationExport` config field defaults to `auto`; old explicit values such as `bk` or `bl` are accepted for config compatibility but deprecated and ignored in favor of the source contract. If neither path exists, stop with an error rather than try guessed aliases, infer coordinates, or use an LLM repair. Location accuracy must be known and at or better than `maxAccuracyMeters` (default 200 m). Operators may change the threshold only to match a genuine location provider's real accuracy, never to force acceptance of fixed or fabricated coordinates.

The default report reason is `在校外旅游会注意自己安全，导员放心`, with keyword `旅游` (combined with the `OUTSIDE` location type). Blank input during initialization selects this default. Custom reasons use the frontend-style 10–200 UTF-16 code-unit limit. The app must not submit the default `OUTSIDE` report for a location classified on campus.

## Extension boundary

The current code supports the UESTC flow only. Supporting another school requires a separately designed adapter for its options, authentication, location, submission, and saved-record verification. The existence of this CLI does not imply compatibility with another institution.

## Validation boundary

The historical macOS validation and the portable package have different evidence. The 2026-10-12 incident record distinguishes old-runtime report recovery, shared AST-locator validation on macOS, new-adapter read-only checks, and the uncompleted portable CLI E2E in [`incidents/2026-10-12-location-export.md`](incidents/2026-10-12-location-export.md). Original automation completed a report with authenticated Chrome on 2026-10-10 and later read the saved statuses/content. The new repository has not yet completed a school E2E run. CI runs offline synthetic tests, including service-definition generator tests; it does not validate a live service installation, school access, GPS, or authentication on any operating system.
