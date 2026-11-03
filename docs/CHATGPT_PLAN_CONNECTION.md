# Prepared ChatGPT plan connection

Verified against official documentation on November 3, 2026. This is an optional
single-owner connection preparation for Issue #31. **No owner OAuth grant,
subscription inference, account eligibility or successful live connection has been
verified.** The production router must keep this provider permission-required until
an approved integration and explicit browser consent have been established.

A public repository alone does not establish open-source licensing or SIWC
eligibility. No project `LICENSE` file was found in this audit; eligibility still
requires owner/provider confirmation. This change selects no license and grants
no OpenAI approval.

ChatGPT plan permission and OpenAI API-key billing are separate connections. This
flow does not convert a subscription into ordinary OpenAI API credits or expose
ChatGPT conversations. The [official overview](https://developers.openai.com/siwc/token-sharing-open-source)
describes eligible open-source/local clients; paid or remotely hosted products
need the applicable OpenAI approval. A self-hosted personal VM follows the
separate procedure below rather than assuming the website identity integration
is available to LifeOS.

## Owner-device authorization

The companion is inert without operation arguments. First read its help:

```bash
corepack pnpm exec tsx scripts/chatgpt-plan-companion.ts --help
```

Run this POSIX companion **on the device running your browser**, after reviewing
the source and confirming eligibility. Use the canonical LifeOS owner UUID from
your private administration records, not an email or Telegram ID. No token or
password belongs in the command or a chat message.

```bash
corepack pnpm exec tsx scripts/chatgpt-plan-companion.ts \
  --connect --consent --owner-device \
  --owner-id OWNER_UUID --state-dir /absolute/private/lifeos-chatgpt
```

The companion binds an ephemeral port exclusively on `127.0.0.1`, then prints an
OpenAI authorization URL for you to open manually. It does not launch a browser.
An SSH session is rejected for this operation. The callback is exactly
`http://127.0.0.1:PORT/auth/callback`; it is not a remotely hosted LifeOS route.

The [documented registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
uses a stable opaque host ID, dynamic initial client registration, fresh state,
PKCE-S256 and an OIDC nonce. The companion reuses the issued client ID for later
sign-ins, verifies the ID-token signature/issuer/audience/expiry/nonce and rejects
account replacement. Only the token response's granted
`chatgpt.tokens.use.direct` permission enables the plan flag. Identity-only sign-in
remains distinct. Authorization attempts are one-use and expire after five
minutes; an ambiguous code exchange is not automatically retried.
The token-free registration record is saved before exchange, so a failed exchange
can reuse its issued client ID after restart without claiming a connected account.

## Storage and transfer to the personal VM

The private directory must belong to the current OS user and have mode `0700`.
Its key, host ID and encrypted credential file have mode `0600`; symlinks are
rejected. Credential ciphertext reuses LifeOS AES-256-GCM and authenticates the
canonical owner and local host identifier as associated data. Access, refresh and
retained ID tokens never appear in settings, browser storage, URLs, Git or logs.
This is local at-rest binding; a host identifier is not an OpenAI proof of key
possession.

For the [official self-hosted VM procedure](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms),
complete OAuth locally for the same tool/account/workspace, then transfer the
selected protected credentials over an owner-authorized secure channel such as
SSH. Transfer `connection.enc` and `key.bin` into a private incoming directory;
do not print their contents or copy the laptop's `host-id` over the VM's file.
On the VM:

```bash
corepack pnpm exec tsx scripts/chatgpt-plan-companion.ts \
  --import --consent --owner-id OWNER_UUID \
  --state-dir /absolute/private/lifeos-chatgpt-vm \
  --source-envelope /absolute/private/incoming/connection.enc \
  --source-key /absolute/private/incoming/key.bin
```

Import validates the same owner, preserves the VM's generated host ID and
re-encrypts with the VM's own key. It refuses to replace an existing different
account registration. Let the VM manage subsequent refreshes; do not run laptop
and VM refresh loops concurrently for the transferred session. OpenAI currently
does not provide host-specific usage attribution/revocation for transferred
sessions. Import alone does not enable provider execution in the router.

## Renewal, revocation and status

Use `--status` with the same owner and state directory for an offline, token-free
status projection. Explicit `--refresh --consent` and `--revoke --consent` are
available after a real connection exists. All operations take an exclusive local
file lock; a stale lock requires operator inspection, never automatic removal.
Use one credential writer per installation. A refresh saves the newest rotation
atomically and omits scope escalation. Terminal refresh rejection clears unusable
tokens; temporary outages preserve the connection for recovery. Successful remote
revocation clears local tokens while retaining the account/client mapping.
Unconfirmed revocation is reported as a failure, not a disconnected grant.
See [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

A refresh response must contain a fresh access token and cannot add permissions
beyond the saved grant. New plan-sharing permission requires a new browser
authorization, not token renewal.

Manage plan usage and app access at
[ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). Plus plan allowance
can be shared with other approved app usage; LifeOS does not promise a separate
quota or infer a reset time. See [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).

## Prepared inference contract

`chatgpt-plan-protocol.ts` provides a narrow text-only request builder and bounded
SSE reader. It uses only public Responses requests with `store:false`,
`stream:true` and an input array, never private ChatGPT backend endpoints. A
successful result requires `response.completed`; partial text, interrupted
streams, incomplete responses and later errors fail closed. There is no implicit
switch to API-key billing. A real connection must discover that account's model
catalog before selecting an allowed model. See [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

The reader has its own 20-second deadline, which callers can only shorten, and
rejects unrequested tool/output types before accepting a completed text answer.

The current preview excludes several ordinary Responses fields, including
`max_output_tokens`, and does not support audio/video input. The prepared subset
therefore sends no tools or unsupported overrides. Output bytes are bounded
locally and execution still needs the existing LifeOS governor, permissions and
spending checks. Local cancellation cannot prove a provider billing stop. The
router rejects this provider in the current release. Connecting the companion
still requires future wiring of the encrypted vault, account-specific model catalog
and governed runtime adapter, followed by owner browser consent, eligibility
verification and a separately authorized live contract/usage test. See [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Native developer clients remain separate

Developers may use the unmodified native Claude Code client with their own
legitimate subscription. LifeOS does not inspect its credential store, collect
Claude subscription OAuth tokens, wrap the CLI as a generic inference service or
offer Claude-account login. An Anthropic API key is a separate provider/billing
connection requiring explicit authorization. This follows the current
[Claude Code legal and credential-use guidance](https://code.claude.com/docs/en/legal-and-compliance).
Native Codex development sign-in is also separate; this companion never reads or
reuses a Codex session.
