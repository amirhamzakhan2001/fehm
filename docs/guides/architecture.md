# Architecture and drift

Architecture views organize repository components, dependencies, workflows and boundaries. FEHM distinguishes inferred structure from explicit project decisions.

## Inspect the current structure

```sh
fehm architecture --list
fehm architecture --view dependencies
fehm architecture --view security
fehm drift
```

The dashboard offers /architecture and /drift. Click source evidence before deciding that a relationship is a defect.

## Use project-specific constraints

Explicit architecture contracts live in .fehm/architecture.json. The technical drift reference describes the schema and supported rules. Missing configuration is not proof of architectural compliance; inferred conventions are weaker evidence than approved constraints.

## Interpret findings in context

A dependency crossing a declared boundary can justify review. A common pattern or a missing file alone cannot establish bad engineering. Drift, Health and Security share evidence through their existing services rather than creating a separate practices framework.

The former fehm practices commands are not implemented in this checkout. Use the current drift and health workflows.
