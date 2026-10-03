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

Use the glossary's vocabulary in issue titles, plans, code, and tests. If a term
is missing or overloaded, resolve it through domain modeling before introducing
new terminology. If a proposed change contradicts an existing ADR, surface that
conflict explicitly.
