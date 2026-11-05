# Dependency security maintenance — November 4, 2026

The live npm advisory scan found nine advisories in the existing test/build
dependency graph: two critical Tinypool reports, four moderate reports and three
low reports. These findings require maintenance of developer and CI tooling;
they do not establish exploitation of the production application.

Vitest is upgraded from 3.2.7 to 4.1.12, including its matching mocker packages.
Vitest 4 removes Tinypool rather than forcing a different Tinypool major through
the old runner. It supports Node 22 and the existing Vite 7.3.7. The root Vite
version is explicit so resolving the test runner cannot introduce Vite 8. The
obsolete `minWorkers` option is removed; the existing two-worker maximum remains.
Application manifests and application source are unchanged.

Scoped overrides select the compatible patched Babel 7.29.6, esbuild 0.28.1 and
PostCSS selector parser 6.1.5. They retain the affected major/minor families;
there is no Tinypool override, audit suppression or disabled security check.

## Exposure and primary sources

- Tinypool's worker-option and `run()` findings are prototype-pollution gadgets.
  Exploitation requires an attacker to establish the relevant pollution first.
  In this repository Tinypool was reached through Vitest, so developer and CI
  processes are the relevant boundary. See the maintainer's
  [worker-options advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3)
  and [run-options advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr).
- The Vitest/mocker file-read and code-injection findings concern exposed
  development WebSocket mock registration. LifeOS does not use those plugins in
  its production request handlers. See the maintainer's
  [redirect-mock advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
  and [manual-mock advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8).
- Babel's finding requires compiling attacker-controlled source and exposing its
  output. See the [Babel advisory](https://github.com/babel/babel/security/advisories/GHSA-4x5r-pxfx-6jf8).
- The esbuild finding affects its development file server on Windows. The
  production host uses Debian; `tsx` also consumes esbuild when loading trusted
  backend source, so a package's development classification alone is not a claim
  that it is absent from runtime installations. See the
  [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr).
- Selector parser fixes cover the reported recursion and flat-selector CPU
  exhaustion findings. LifeOS uses it through Tailwind's build pipeline. See
  the [maintainer advisory](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf).

The [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration.html)
documents the removed Tinypool pool implementation, supported Node/Vite versions
and configuration changes. This runner upgrade requires the complete test and
release checks before adoption; a clean audit alone does not prove compatibility.

## Verification and rollback

Anonymous npm audits of the candidate lockfile on November 4 returned zero
advisories for the complete dependency graph and the production-only graph.
Exact-version metadata and private audit logs are retained with the release
evidence. This result describes the candidate dependency graph, not the currently
deployed commit or a guarantee against undisclosed vulnerabilities.

The root, TMA and web TypeScript checks passed under Node 22.23.2. Focused tests
passed 141 cases across six existing files, covering router selection/governance,
mock external capture, mock meal analysis and the web bridge allowlist. They ran
with one worker and no inherited credentials; the external-connection guard
recorded no blocked connection attempts. No real provider inference was tested.

Before merging, run the three TypeScript checks, the full TypeScript test suite,
production builds and CI for the final commit. Existing mock-provider tests must
remain offline; neither dependency maintenance nor tests authorize live AI
requests or owner notifications.

Rollback consists of reverting this dependency/configuration commit and
installing the prior frozen lockfile, then rebuilding the affected artifacts.
There are no database migrations or application-data changes in this change.
Keep production service credentials and private datasets out of development and
test processes during either release or rollback.
