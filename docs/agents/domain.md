# Domain Docs

Before exploring, read the root `CONTEXT.md` when it exists and any relevant
ADRs under `docs/adr/`. If they do not exist, proceed silently; create them
lazily when domain terms or durable decisions are resolved.

This repository uses the single-context layout:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Source of truth

Use one layer for each kind of knowledge. When two layers appear to disagree,
the layer that owns that kind of knowledge is the starting point for resolving
the conflict.

| Layer                          | Owns                                                                                                          | Use it for                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Fact docs                      | Current behavior and supported workflows, including architecture, Profile/Pipeline, testing, and release docs | Describing what the repository does now                  |
| `AGENTS.md` and `docs/agents/` | Agent workflow, issue operations, triage labels, and documentation navigation                                 | Deciding how an agent should work in this repository     |
| `CONTEXT.md`                   | Domain vocabulary and ownership boundaries                                                                    | Naming concepts and checking domain boundaries           |
| `docs/adr/`                    | Hard-to-reverse choices with a meaningful trade-off                                                           | Understanding why a durable architecture boundary exists |
| GitHub Issues                  | Open work, decisions, bugs, and roadmap goals                                                                 | Planning, assigning, blocking, and closing work          |

Canonical Issue links to repository files use stable paths on the default
`main` branch. Research audits are historical evidence; they do not override
the current fact layer.

Use the glossary's vocabulary in issue titles, plans, code, and tests. If a term
is missing or overloaded, resolve it through domain modeling before introducing
new terminology. If a proposed change contradicts an existing ADR, surface that
conflict explicitly.
