# Contributing

Thanks for helping improve GoodNight. Keep changes deterministic, local-first, and specific to the supported UESTC flow unless you are deliberately proposing a separately scoped adapter.

## Before submitting

1. Use Node.js 22 or later and install the lockfile dependencies with `npm ci`.
2. Run `npm test`. These tests are offline and must use synthetic fixtures; do not make school requests in CI.
3. Explain behavior changes and how you verified them. Distinguish offline tests from live school validation.
4. Update the relevant documentation when changing CLI options, data paths, scheduling, submission, recovery, or platform behavior.

## Privacy and safety

Never commit credentials, cookies, browser profiles, storage state, real report text, student records, private logs, or screenshots containing personal data. Keep all runtime data in the ignored user data directory. Do not add code that fabricates location or treats an unverified submission as success. Do not add scheduled GitHub Actions that submit reports or recommend cloud/Docker execution for live reporting, which depends on real location and user-driven display login.

## Changes to school integration

School pages and APIs can change. Preserve fail-closed behavior when options, location integration, submission responses, or saved-record verification do not match expectations. Do not silently repair upstream changes using an LLM. Include the source and audit date for externally verified integration assumptions without publishing private account data.

## Pull requests

Keep pull requests focused. Include a concise description, user-visible behavior, validation performed, and any unverified platform or school-side assumptions. Do not claim cross-platform or school E2E support based only on offline CI.
