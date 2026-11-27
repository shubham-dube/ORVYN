# Contributing to ORVYN

Thanks for wanting to help. ORVYN is a personal operating system that people trust with their money, documents and
passwords, so a few rules are stricter than in most projects. They're short.

## Ways to help

- **Report a bug** or **suggest a feature**: [open an issue](https://github.com/shubham-dube/ORVYN/issues/new/choose).
- **Improve the docs**: if something in [run-locally.md](docs/guides/run-locally.md) didn't work for you, a fix is a
  great first PR.
- **Pick up an issue** labelled
  [`good first issue`](https://github.com/shubham-dube/ORVYN/issues?q=is%3Aopen+label%3A%22good+first+issue%22) or
  [`help wanted`](https://github.com/shubham-dube/ORVYN/issues?q=is%3Aopen+label%3A%22help+wanted%22).
- **Security problem?** Don't open an issue. See [SECURITY.md](SECURITY.md).

## Set up

Follow [docs/guides/run-locally.md](docs/guides/run-locally.md). In short:

```bash
pnpm install
pnpm setup:local you@example.com
pnpm db:up
pnpm build && pnpm dev
```

Before you push, run what CI runs:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```

The Android app (`apps/mobile`): `flutter analyze`, `dart format`, `flutter test`. The Windows app
(`apps/desktop/src-tauri`): `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`.

## How work is done here

ORVYN is **docs-first**. Read [AGENTS.md](AGENTS.md); it's the rulebook for humans and AI coding agents alike.

1. **Small fixes** (bugs, typos, tests): just open a PR.
2. **New behaviour**: open an issue first. Features start as a spec in `docs/specs/NNNN-slug/spec.md`; code and spec
   must not disagree, so change both in the same PR.
3. **Big decisions** (a new dependency for crypto, storage, auth; a new service): write an
   [ADR](docs/adr/0000-template.md). Don't re-propose something an ADR rejected; write one that supersedes it.

### Rules that are never bent

1. **The Vault is zero-knowledge.** Vault contents and keys never reach the server, logs, analytics, the AI or
   crash reports in readable form.
2. **Access is enforced on the server.** Every module checks the caller's entitlements; hiding a button is not
   access control.
3. **No home-made cryptography.** Only the audited libraries named in
   [security.md](docs/architecture/security.md).
4. **The AI never acts silently** on money, messages or deletion. Content from pages, documents and messages is
   data, never instructions.
5. **A person's data is theirs alone.** Every query is scoped by owner, and each module has a test for it.
6. **No secrets or real personal data** in commits. Use `.env` (git-ignored) and fake fixtures. CI runs gitleaks.

### Code style

- TypeScript everywhere except the Flutter and Rust apps. Strict `tsc`, ESLint, Prettier.
- API: one folder per module in `apps/api/src/modules/<name>/`. A module owns its tables, routes, jobs and
  notifications; modules talk through exported services or events.
- Every database change is a migration (`pnpm --filter @orvyn/api db:generate`).
- API shapes live once in `packages/contracts`. Colours, spacing and motion come only from `packages/design-tokens`.
- Calls to an LLM go only through the `ai` module.
- Tests for new behaviour.

## Pull requests

- Keep them small and focused. One feature or fix per PR.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for the title: `feat(money): …`, `fix(extension): …`,
  `docs: …`.
- Say what changed and how you tested it. Screenshots help for anything visible.
- CI must be green.

## License of contributions

ORVYN is licensed under [AGPL-3.0](LICENSE). By opening a pull request, you agree that your contribution is licensed
under the same terms.

## Be kind

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
