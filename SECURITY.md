# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.13.x | Yes |
| 1.12.x | Yes |
| 1.11.x | Yes |
| 1.10.x | Yes |
| 1.9.x | Yes |
| 1.8.x | Yes |
| 1.7.x | Yes |
| 1.6.x | Yes |
| 1.5.x | Yes |
| 1.4.x | Yes |
| 1.3.x | Yes |
| 1.2.x | Yes |
| 1.1.x | Yes |
| 1.0.x | No — upgrade to the latest 1.x |
| < 1.0 | No |

1.0.0 cannot be installed on any Angular newer than 17 and shipped a dependency fault that
breaks dependency injection. If you are on it, upgrading is the fix.

## Reporting a vulnerability

Please report privately via
[GitHub security advisories](https://github.com/berserker5619/Dynamic-Entity/security/advisories/new)
rather than opening a public issue.

Include the affected package and version, what an attacker can achieve, and a reproduction if
you have one. You can expect an acknowledgement within a few days; this is a small project, so
please allow reasonable time before disclosing publicly.

## What these packages do and do not protect

Read this before filing — two behaviours look like security features and are not.

**Permissions and masking are presentational.** `EntityPermissions` (`view`/`edit`/`delete`)
and `maskData` control what the browser renders. A masked field displays `XXXXXXXXX` while the
real value remains in the form control and is included in the submitted record. A field hidden
by `permissions.view` was still sent to the browser by whatever supplied the record.

They are a UI convenience, not an access-control boundary. **Authorize on the server**: do not
send a user data they may not see, and re-check every permission when a submitted record
reaches your API. A report that a masked value is readable in DevTools is expected behaviour,
documented in the README and in the code.

**Configs are data, and are treated as such.** The rules engine interprets enumerated
operators over structured conditions — there is no `eval`, no `new Function`, and no template
compilation of config strings anywhere in the packages. Dot-paths from config (`refererField`,
tab ids) refuse `__proto__`, `constructor` and `prototype` on both read and write, so a config
cannot reach an object's prototype.

If you find a way for config content to execute code or escape those guards, that is a real
vulnerability and we want to hear about it.

## `@dynamic-entity/server`: an upload endpoint, and what it does not cover

The other packages run in a browser tab or in a build step. This one accepts a file over the
network, which changes the threat model rather than extending it — so it gets its own section.

### What the router does guard

Every limit below has a **finite default**, and each is enforced *during* streaming rather than
after. A guard that runs once the file is in memory has already lost.

| Threat | Guard |
|---|---|
| Upload exhaustion | `maxBytes`, counted as bytes arrive; the body is abandoned and closed on breach |
| A `.csv` that is really a zip | Format is decided by **magic bytes**, never by the client-controlled extension |
| Zip bomb (an `.xlsx` is a zip) | `maxUncompressedBytes`, `maxCompressionRatio`, `maxZipEntries`, per-entry size — all checked *as entries inflate* |
| XML entity expansion / XXE | The parser refuses an undefined entity outright and does not process an internal DTD subset; asserted with crafted files rather than assumed |
| Row / column / cell floods | `maxRows`, `maxColumns`, `maxCellLength` |
| Formula injection in generated files | Every written cell goes through `escapeFormula`, and the xlsx writer's output is checked for formula elements |
| Path traversal via `:entity` | A lookup key into the configs you supplied. Never a path segment, never interpolated |
| `Content-Disposition` header injection | Filenames are derived from the config's entity and sanitised; a client-supplied name never reaches a header |
| Prototype pollution via a posted plan | `setRecordValue` refuses `__proto__` and `constructor.prototype`; a posted hostile plan is a test, not an inherited assurance |
| A malformed or hostile plan | `validateMappingPlan` runs **before a single row is read** |
| Multipart abuse | Field count, field-name length, field value size and file count are all capped |
| Stalled uploads (slowloris) | Idle and total request timeouts, both of which close the connection |
| Information disclosure | The error envelope carries a code and a message this library wrote. No stack, no filesystem path, no parser internals |

### What it does not, and you must

**Authentication, authorization and concurrency limiting are yours.** The router is mounted
inside your app, behind your middleware. Nothing in it checks who is asking, and nothing in it
limits how many imports run at once. A report that an unauthenticated request reaches the
import endpoint is a report about the app it was mounted in.

**An import is not transactional, and a retry will double-write.** A stream that fails at row
30,000 has already written 29,999 records. Over HTTP a retry is *likely* rather than possible —
a client, a proxy or a user will send the same file again — so **`onImport` must be
idempotent**. This library does not deduplicate: an `EntityFormConfig` has no natural-key
concept for it to deduplicate on. `POST /:entity/validate` runs the identical pipeline and
writes nothing, which is the intended way to find problems before anything is stored.

**`validators.pattern` became a server concern.** It is a config-supplied regular expression
that core compiles and runs against cell text. In a browser a catastrophic backtrack costs the
user their own tab; on a server the cell content is attacker-chosen and the cost is your CPU.
`maxCellLength` bounds the input and therefore bounds the blow-up, but a pattern authored
without that in mind is now a denial-of-service surface. If you author patterns, review them
for catastrophic backtracking.

**A published template is a file another program executes.** Cells are escaped and the writer's
output is checked, but the *content* comes from your config's labels. A label you would not
paste into a spreadsheet is a label you should not put in a config.

## Supply chain

Releases are published from CI by the `Release` workflow using npm trusted publishing (OIDC):
there is no long-lived publish token, and each tarball carries a provenance attestation linking
it to the commit and workflow that produced it. You can verify it with `npm audit signatures`.
