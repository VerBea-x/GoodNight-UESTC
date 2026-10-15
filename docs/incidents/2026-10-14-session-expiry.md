# 2026-10-14 connection failure and loss of client session

Status: mitigation deployed and authentication rechecked on 2026-10-15. The source of the historical TLS interruption and the old server session's lifetime remain unconfirmed. All times below are Asia/Shanghai.

## Evidence

- **2026-10-13 22:30:18–20:** the installed macOS job submitted the daily report and verified the saved record for that business date.
- **2026-10-14 15:51:44:** last successful session probe before the outage. Probes returned `unknown` from **16:01:56** onward; the old probe code discarded detailed reasons, so those early events do not establish a specific network cause.
- **22:30:07–22:31:14:** the primary job ran and made three attempts. Each failed during GET `/auth/user-info`, before a secure TLS connection was established and before any report POST.
- **22:49–23:47:** six recovery runs made another eighteen failed authentication requests. All twenty-one logged failed requests had the same TLS failure; none of their request Cookie headers contained `SESSION`. No submission claim was created for that date. Raw headers and cookies are private and are not included here.
- **2026-10-15 15:04 onward:** probes began receiving an unauthenticated response rather than only a transport failure. A read-only check that evening confirmed `user-info` code `5000`.
- **After an interactive login flow that evening:** read-only `user-info` returned code `0`, and `/today` returned the current business date with `PENDING`. This establishes restored authentication, not a completed report for October 15 or a recovery of October 14.

## Cause assessment

**Confirmed submission blocker:** the primary job and recovery jobs were running, but authentication requests could not establish TLS. Retrying did not repair the persistent connection failure. Current DNS/proxy settings alone cannot identify the source of yesterday's interruption; no historical school-side or proxy-side trace was available.

**Confirmed client weakness:** both adapters previously changed a successfully validated SESSION's browser expiry to one hour after the validation. During a prolonged connection failure this expiry could not be extended, allowing the browser to drop the credential even if the server might still accept it. `SESSION` was absent from the logged evening requests. This is consistent with local expiry, but the logs do not show the actual deletion event or prove that the old server session was still valid. A server timeout/revocation cannot be ruled out.

**Diagnostic weakness:** the installed legacy probe recorded most failures as `unknown` / `probe_failed`. Its report path could also save Playwright's raw exception text, including request details, to private logs. The public adapter already converted request exceptions into safe error codes.

## Mitigation and limits

- Following successful server validation, retain the browser credential for at least seven days from that validation, preserving any longer existing expiry. Do not extend it after a failed request or rejected authentication. Keep cookie security attributes unchanged.
- This adjusts **local retention only**. It neither renews OAuth nor changes the server's expiry or revocation rules. A server-rejected session still requires the documented login flow.
- The legacy request boundary now replaces transport exceptions with fixed safe reasons such as `tls_disconnect`, `timeout`, and `transport_error`; result logging no longer stores raw request exception text. Known frontend-contract failures remain distinguishable.
- Existing server-window checks, real location, submission claims, saved-record verification, and the 23:55 recovery cutoff remain in force. No historical POST was made to simulate a successful recovery.

Offline tests cover day-long outage retention, preservation of longer expiries and cookie security attributes, failure/rejection without retention extension, and exclusion of synthetic credentials from diagnostic output. Real authentication was checked after deployment; another prolonged outage and the next scheduled submission have not been exercised as part of this investigation.
