# Contributing

Thanks for taking the time to contribute.

Please start with an issue before opening a pull request. Direct pull requests without a linked issue may be closed, even when the change itself is useful.

By contributing to this project, you agree that your contribution is licensed under the GNU AGPL version 3 or later and that the App Store exception in APPSTORE-EXCEPTION.txt applies to your contribution.

## Before opening a pull request

1. Open an issue first.
2. Describe the problem, goal, or proposed change.
3. Wait for discussion or confirmation before starting implementation.
4. Keep the pull request focused on the agreed scope.
5. Link the issue in the pull request description.

This keeps changes reviewable and prevents surprise work from landing like a piano through the ceiling.

## Pull request expectations

A good pull request should:

- Solve one clear problem.
- Link to the issue it addresses.
- Explain the intent and outcome.
- Summarize meaningful changes by area or concept.
- Include validation steps.
- Call out risks or follow-up work.

Avoid large, unrelated changes in a single pull request.

## Code quality

Before opening a pull request, please run the relevant checks for the change.

At minimum, mention whether you ran:

- Tests
- Type checking
- Linting
- Manual verification

If a check was not run, explain why.

## Shared AI conventions (sibling repos)

Generic agent rules, skills, and editor defaults for **eskerra-go** and other siblings are maintained here. See [`specs/rules/shared-conventions.md`](specs/rules/shared-conventions.md) and run:

```bash
./scripts/sync-shared-conventions.sh /path/to/sibling-repo
```

## Security issues

Do not open a public issue for security vulnerabilities.

Please follow the instructions in `SECURITY.md`.