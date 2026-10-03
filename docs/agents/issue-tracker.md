# Issue tracker: GitHub

Issues and specs for this repo live as GitHub Issues in
`inaku-Gyan/Live-Serial-Plotter`. Use the `gh` CLI for all issue operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`.
- Read: `gh issue view <number> --comments`.
- List: `gh issue list --state open` with appropriate label filters.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Infer the repository from the GitHub remote when running inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- The map is one issue labelled `wayfinder:map`.
- Each decision ticket is a child issue, labelled `wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Prefer GitHub sub-issues through the `gh api` sub-issues endpoint. If unavailable,
  put `Part of #<map>` at the top of the child body and list it in the map body.
- Use native GitHub issue dependencies for blocking:
  `POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by`
  with the blocker's numeric database `issue_id`.
- The frontier is the map's open, unassigned, unblocked child issues.
- Claim a ticket by assigning it to the driving developer before doing work.
- Resolve a ticket by posting its answer as a comment, closing it, then appending
  a linked gist to the map's `Decisions so far`.
