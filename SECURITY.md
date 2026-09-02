# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.9.x | Yes |
| 1.8.x | Yes |
| 1.7.x | Yes |
| 1.6.x | Yes |
| 1.5.x | Yes |
| 1.4.x | Yes |
| 1.3.x | Yes |
| 1.2.x | Yes |
| 1.1.x | Yes |
| 1.0.x | No — upgrade to 1.9.0 |
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

## Supply chain

Releases are published from CI by the `Release` workflow using npm trusted publishing (OIDC):
there is no long-lived publish token, and each tarball carries a provenance attestation linking
it to the commit and workflow that produced it. You can verify it with `npm audit signatures`.
