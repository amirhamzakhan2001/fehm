# Git memory and concepts

Git Memory provides searchable history, semantic comparisons and historical analyzer snapshots. Concept Intelligence links engineering vocabulary to the codebase with evidence categories.

## Explore history

```sh
fehm git-memory "authentication"
fehm git-memory --from HEAD~1 --to HEAD --raw
fehm git-memory --snapshot --ref HEAD
```

Use revisions that exist in the repository. Historical snapshots run supported analyzers on committed content; they do not run its tests or prove runtime behavior. Git absence and shallow history limit evidence.

## Inspect concepts

```sh
fehm ontology "idempotency"
fehm concepts "idempotency"
```

Ontology lookup finds definitions and aliases. Codebase concept analysis distinguishes observed, supported, possible and insufficient evidence. Mentioning a concept does not establish correct implementation. These commands require Node 22.13+ for built-in SQLite.
