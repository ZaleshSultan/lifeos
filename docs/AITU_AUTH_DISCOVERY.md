# AITU authorized connection: verified capability and blocker

Issue [#14](https://github.com/ZaleshSultan/lifeos/issues/14) remains **PARTIAL / BLOCKED for automatic authorization**. LifeOS does not have a university-approved API grant. A browser login alone does not grant the backend access.

Public, unauthenticated checks recorded on November 3, 2026, Asia/Almaty (November 2, 19:22 UTC):

- The genuine [AITU login page](https://lms.astanait.edu.kz/login/index.php) returned HTTP 200 and offered OpenID Connect.
- `/auth/oidc/?source=loginpage` returned 303 to Microsoft's `organizations/oauth2/authorize`. The registered callback remains `https://lms.astanait.edu.kz/auth/oidc/`; requested scope was `openid profile email`, with Microsoft Graph as the resource. This institutional login is not a Moodle API authorization for LifeOS.
- Moodle's documented `/admin/tool/mobile/launch.php` with service `moodle_mobile_app` returned a Moodle 404 error whose documentation target was `error/webservice/servicenotavailable`. Mobile service access is unavailable in the inspected configuration. This does not prove that every possible institutional service is disabled.
- A public-config AJAX GET did not yield usable configuration; no claim is made from that failed request. No account password, cookie or authenticated page was used, and no sign-in attempt or token creation completed.

The connection screen now opens the genuine AITU sign-in page in an external browser, explains that this does not connect LifeOS, and places the existing manual session workflow under an explicit advanced compatibility section. Existing saved records remain available. The connection API returns versioned, credential-free authorization guidance, the known blockers and sync freshness based on the existing six-hour threshold. A login click never marks the account connected, saves a secret, creates a synchronization request or changes academic records.

## What is required for a supported connection

An AITU administrator must provide one of these approved mechanisms and its permitted data scope:

1. A Moodle Web Services service/token assigned to the student and restricted to required read operations, with the institution's token lifetime/revocation policy. Moodle's standard mobile browser handoff can be assessed only after the service is enabled and the custom/native callback is explicitly supported. LifeOS must validate a one-time owner-bound handoff and verify the returned Moodle account before saving any grant.
2. An institution-approved LifeOS OAuth/OIDC registration, exact HTTPS redirect URI and authorized Moodle API audience/scopes, including refresh-token policy when supported. A Microsoft Graph token or an ID token is not assumed to authorize Moodle. Do not reuse the university's existing client ID or modify its callback.

No client registration, admin consent or refresh mechanism was available during this task. No OAuth callback/exchange implementation is advertised as operational. Once a supported grant exists, extend the encrypted, owner-bound backend store and existing per-user worker lease; do not put grants/cookies in browser JavaScript or public URLs. Reauthentication, MFA and CAPTCHA remain on the genuine provider page.

[Moodle's official mobile authentication guidance](https://docs.moodle.org/405/en/Moodle_app_guide_for_admins#Mobile_authentication) requires enabled services and appropriate institution configuration. The [official launch implementation](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/admin/tool/mobile/launch.php) uses a custom app scheme and one-time passport validation; it is not a generic HTTPS OAuth callback. Microsoft's [redirect URI requirements](https://learn.microsoft.com/entra/identity-platform/how-to-add-redirect-uri) require registration, and [authorization-code documentation](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow) describes scoped resource grants and refresh policy.

## Security and verification boundary

`GET /api/tma/lms/connection` and `/work` expose owner-scoped, safe metadata to authenticated Telegram and web sessions. Credential validation/save/delete and sync mutations retain the stricter Telegram authentication boundary. Guidance contains only fixed official URLs and enum codes. It does not expose raw OAuth redirect URLs, state, nonces, login HTML, credentials or internal user IDs. Browser projection rejects URL overrides and unverifiable capability claims. `Cache-Control: no-store` remains enforced.

Historical assignments, grades and schedules are never removed on reauthentication failure. No database migration or worker credential replacement is part of this capability change. Authenticated university access, current grades and automatic renewal remain unverified until the university supplies the supported grant and the owner completes consent.
