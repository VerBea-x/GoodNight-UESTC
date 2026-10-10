# Security policy

## Reporting a vulnerability

Please do not post credentials, personal records, cookies, browser profiles, or exploitable details in a public issue. Contact the repository maintainers privately through the security reporting channel configured on the hosting platform. If no private channel is configured, ask a maintainer for a private contact route without including sensitive data in the request.

## Sensitive data

GoodNight stores browser and runtime state locally so it can use the user's authenticated session. Keep the data directory private. Never attach it, its logs, or its profile to an issue or pull request. The project does not need exported cookies; do not add cookie export or secret upload features.

If check-in or a report may have been submitted but the client did not verify it, first inspect the school record with `check`. Separate local per-operation POST journals prevent blind automatic retries. In particular, an ambiguous check-in outcome must never be treated as a definitive rejection that permits report fallback. The journals cannot determine the server's final state while the school is unavailable.

## Supported versions

The project currently targets Node.js 22+ and macOS, Windows, and Linux. Live school behavior and platform authentication/location remain unverified for the new portable package; CI is offline only. Security reports are welcome for the CLI, dependencies, service installation/removal, local file handling, and authentication boundaries.
