# Portability and operations

## Supported execution environments

The package targets Node.js 22+ on macOS, Windows, and Linux. This is a declared target, not proof that live UESTC reporting works on each platform. The prior macOS automation and shared AST locator have runtime evidence, and the new adapter has authenticated read-only location/record evidence. The new portable CLI has not completed a school submission E2E; Windows and Linux location/authentication remain unverified.

CI checks deterministic code using Node.js 22 and 24 on Ubuntu, macOS, and Windows with synthetic offline tests, including service-definition generator tests. These tests exercise migration candidates and synthetic service-definition output checks; they do not prove full schema conformance or that a service was installed or run on the corresponding real OS. CI does not contact the school, perform real geolocation, or test authentication.

## Browser and location

The browser channel is `chrome` by default, with `msedge` and `chromium` options. Installed Chrome is recommended. Playwright-managed Chromium can be installed with `npx playwright install chromium`; choose it with `init --browser chromium`. A browser binary alone does not provide campus location. The operating system and browser need a location provider that can supply the user's real location, in GCJ-02 as expected by this integration. Location first calls `globalThis.uni.getLocation` bound to `uni`; if unavailable, Acorn parses the current same-origin entry and student-page chunks to identify the named import actually used with `{ type: "gcj02", success, fail }`, confirms its export exists, and invokes it from the entry module. `frontendLocationExport` defaults to `auto`. Legacy explicit values such as `bk` and `bl` are accepted but deprecated and ignored in favor of current source discovery. If the contract is missing, ambiguous, or changed, location fails closed without guessing aliases. `maxAccuracyMeters` defaults to 200 m and unknown/over-limit accuracy fails closed. Change the limit only to accommodate the genuine provider's real accuracy. Do not replace failed location with fixed or fabricated coordinates.

Authentication uses a persistent, isolated per-user browser profile. Run `login`, complete unified authentication in the opened browser, click “晚安成电”, then press Enter in the terminal for the online business-authentication check. Logging in through your ordinary browser does not transfer authentication to GoodNight's isolated profile. Do not copy that profile between operating systems or user accounts; repeat manual login on the destination device. Server-side session expiry is unknown, so `need_login` is a failure requiring login.

The [2026-10-12 location-export incident](incidents/2026-10-12-location-export.md) records the prior locator failure, shared-helper Mac runtime checks, and separate new-adapter read-only checks. Those checks do not establish full school submission E2E for the portable CLI or live location/authentication on Windows or Linux.

## Data locations

Default private data locations:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/GoodNight` |
| Windows | `%LOCALAPPDATA%\GoodNight` |
| Linux | `$XDG_STATE_HOME/goodnight`, otherwise `~/.local/state/goodnight` |

Set `GOODNIGHT_HOME` or pass `--data-dir PATH` to select another directory. Keep config, browser profiles, auth state, logs, and runtime state outside the source checkout and out of version control.

## Daemon lifecycle

`daemon` runs the scheduler in the foreground. `service install` installs one per-user OS service to keep it running; `service install --write-only` writes the definition without enabling it. `service remove` removes the generated service. The service is tied to the absolute Node and checkout paths present at install time, so reinstall after moving the checkout.

The scheduler uses `Asia/Shanghai` and checks its schedule every 30 seconds. It runs one authenticated, read-only location preflight per day during the default 20-minute lead window (22:10–22:30 for a 22:30 report); preflight sends no check-in or report POST. The existing 30-minute quick catch-up is unchanged, followed by 10-minute recovery checks until the exclusive 23:55 cutoff, subject to the school’s schedule windows. An existing macOS 600-second keeper samples the window at its first tick within it rather than firing at exactly 22:10. Installing the service does not submit outside the applicable window. The computer must be powered on, network-connected, and have the user's session available. Recovery does not wake the computer or guarantee that login is renewed. Sleep, shutdown, captive portals, school outages, browser updates, or upstream page changes can prevent a report.

## Submission recovery

`run --dry-run` performs checks and real location preflight without sending a check-in or report POST. `run` tries check-in first during the school check-in window, using available valid dormitory circles. If none is valid or check-in is definitively rejected, GoodNight fetches a fresh authenticated record and falls back to report only while it remains `PENDING` and the actual location is suitable. The default outside report is used only for an actually outside-campus location. An ambiguous check-in POST or timeout must not fall back to report. Separate per-date durable journals are written before each corresponding POST, and an exclusive lock prevents concurrent runs. If a request times out or the process stops after submission, run `check` before another operation.

The exclusive per-date/per-operation POST claim is synchronously flushed before submission. If it exists after restart or an ambiguous POST, the next run performs GET reconciliation rather than repeating the POST. State files use flushed temporary writes followed by rename; these measures reduce duplicate sends and partial state, but cannot guarantee survival of every power loss or school-side retention. Treat only a verified saved school record as success.

See [resilience and recovery](resilience.md) for failure archives, notifications, the 600-second legacy keeper caveat, and configuration reload behavior. Daemons read config at startup, so restart/reinstall the service after config edits. The Linux service is intended for desktops that integrate systemd’s `graphical-session.target`; other desktop environments may need their own user-session startup configuration. See [systemd desktop integration](https://github.com/systemd/systemd/blob/main/docs/DESKTOP_ENVIRONMENTS.md).
