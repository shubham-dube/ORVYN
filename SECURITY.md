# Security policy

ORVYN holds people's passwords, money records and documents. Security reports are taken seriously and handled first.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/shubham-dube/ORVYN/security/advisories/new).

Include what you can: the affected part (API, web, Android, extension, Windows app), steps to reproduce, and the
impact you see. You'll get a reply within 7 days. Once it's fixed, you'll be credited in the advisory if you'd like.

## What's in scope

- Anything that lets one person read or change another person's data on the same server.
- Anything that exposes Vault contents or keys, or weakens their encryption.
- Bypassing a module switch (using a feature the owner didn't give you).
- The extension leaking data to a web page, or a page making the extension act.
- Prompt injection that makes the AI act on money, messages or deletion without the person's confirmation.
- Authentication, session and token issues.

Out of scope: problems that need a fully compromised device, social engineering, denial of service by volume, and
reports from automated scanners without a demonstrated impact.

## Supported versions

Only the latest release and `main` get security fixes.

## How ORVYN is designed

The threat model, the cryptography and its libraries are documented in
[docs/architecture/security.md](docs/architecture/security.md) and the ADRs it links to.
