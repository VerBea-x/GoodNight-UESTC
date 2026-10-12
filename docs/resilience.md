# Resilience and recovery

GoodNight adds bounded checks around the existing daily flow. These mechanisms improve observability and provide another chance to run while the school window is open; they cannot keep a sleeping computer awake, renew a server session, guarantee OS notifications, or guarantee that the school accepts or retains a submission.

## Daily timing

All schedule calculations use `Asia/Shanghai`.

| Setting | Default | Behavior |
| --- | --- | --- |
| `reportTime` | `22:30` | Start of the normal report/check-in attempt |
| `preflightLeadMinutes` | `20` | Run one preflight per Shanghai calendar day from `reportTime - 20 min` up to, but not including, `reportTime` (normally 22:10–22:30) |
| `catchUpMinutes` | `30` | Keep the existing quick channel available after the configured time; eligible pre-submit transient failures (for example, login, location, or unknown outcomes not marked submitted) are retried every two minutes while its retry deadline remains open |
| `recoveryIntervalMinutes` | `10` | After the quick channel is missed or exhausted, make bounded recovery attempts at this cadence |
| `recoveryCutoff` | `23:55` | Exclusive same-day hard cutoff; server schedule windows can close sooner |

The standalone daemon checks its schedule every 30 seconds. A preflight authenticates with the school business API and checks actual browser-provided location and configured accuracy. It does not use today's school record as its success criterion; loading the school page may perform its own reads. It does not change that record or send either the check-in or report POST. A successful preflight records `lastPreflight`; a failure records its phase and date and may trigger a local alert.

An existing macOS keeper that samples every 600 seconds does not create a new exact 22:10 launch. After a hot update it will perform preflight at its first tick inside the 22:10–22:30 interval, which can be nearly ten minutes after the interval begins. The existing 22:30 primary run remains the primary attempt; the keeper can provide the preflight and recovery backup. This timing depends on the machine and keeper being awake and running.

After a missed or exhausted quick path, recovery uses the current authenticated session and current server schedule while both the recovery cutoff and server operation window permit it. It checks for completion at each attempt. A 23:55 cutoff is exclusive; it does not extend a school window. Recovery ends on the Shanghai business date and does not silently roll a missed report into the next day.

## Submission journal and restart behavior

Before each check-in or report POST, GoodNight creates a separate per-date, per-operation exclusive claim file with synchronous flush enabled. If a claim represents an unresolved or ambiguous POST, a later run performs authenticated GET reconciliation against the saved school record and does not repeat that POST. The explicit rejected-check-in case can proceed to a report only after a fresh `PENDING` record and location/type checks; it does not resend the same check-in. If the record is not confirmed, the result remains uncertain and the operator can inspect it with `check`.

Ordinary state files are written to a temporary file with flush enabled and then renamed into place. These local write patterns reduce duplicate submissions and partial state updates, but they are not a guarantee against every sudden power loss, filesystem failure, or server-side loss. A verified saved school record is the success criterion. Client-side session upkeep does not establish how long the server retains authentication.

## Failure records and status

Daemon-managed failures are recorded by Shanghai date and phase (for example, preflight, session, daily report, or recovery). Per-date/per-phase files retain each phase's current failure/resolution state; `failure-index.json` contains dates only, and `last-failure.json` points to the newest unresolved failure known to that index, or to the most recent resolved summary when no unresolved failure remains. Run `node bin/goodnight.mjs status` to inspect `lastPreflight`, `lastFailure`, and scheduler state. A manually invoked `run` still writes `last-result` and logs but does not use the daemon phase-notification recorder. The recorder stores allowlisted status fields rather than report text, credentials, coordinates, or raw error messages.

A valid session resolves a session-phase failure only. It does not erase a failed report. A verified same-day completion can resolve that date's failure records. A success on a later date does not resolve a prior missed or failed day; older unresolved failure information remains available through the archive and latest-unresolved summary.

Failure recording and native notification delivery are best effort. If outcome bookkeeping or local notification IPC fails, the recorder logs a sanitized bookkeeping event and does not replace the operation result or throw from the recorder into the recovery path. A failure to write the submission claim itself remains fail-closed: GoodNight must not send a POST without its claim.

## Local notifications

`notifications` defaults to `true`. For a daemon-managed failure, GoodNight makes at most one local alert attempt per Shanghai date and phase, then deduplicates repeats. Alerts contain only a phase and result summary. Set `notifications: false` to disable the UI attempt; daemon status files and logs continue to be written. No email, remote push service, or LLM integration is involved, so this feature does not incur third-party messaging or LLM service fees.

Implementation uses AppleScript `display notification` on macOS ([Apple documentation](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/DisplayNotifications.html)), `notify-send` on Linux (the desktop notification interface is described by the [freedesktop.org specification](https://specifications.freedesktop.org/notification/latest-single/)), and the legacy `WScript.Shell.Popup` method via PowerShell on Windows ([Microsoft method reference](https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/windows-scripting/x83z1d9f(v=vs.84))). Windows popups are requested for five seconds. The helper has an eight-second process timeout. Availability of a GUI session, the relevant command, notification permissions, and actual delivery vary by OS and configuration; Windows and Linux delivery have not been validated on live systems. An attempted alert can fail or be suppressed, so use `status` and local logs as the durable record.

## Applying configuration changes

The daemon loads configuration at startup; it does not hot-reload edits to `config.json`. Restart the running daemon/service after changing these settings so it reloads config; use `service install` to regenerate/reapply its definition when needed, then check `status`. The exact restart step is OS-specific. The service definition keeps the absolute Node and checkout paths captured at installation; moving the checkout requires reinstalling it. Updating files in an existing legacy runtime can update its code without changing its existing scheduler/service installation paths.
