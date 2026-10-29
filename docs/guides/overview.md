# Introduction

FEHM combines a local source graph, token-budgeted retrieval, optional workflow skills and engineering analysis. The CLI, library API and localhost dashboard share the same engine.

## Start with a question

```sh
fehm scan .
fehm search "authentication"
fehm context "change authentication" --budget 4000
```

Search ranks source matches. Context assembles selected source and relationships for a person or coding assistant. A context packet is evidence, not an LLM-written explanation or a complete repository dump.

## What is implemented

Graph exploration, codebase briefing, architecture views, drift, project health, security review, prompt intelligence, Git memory, concepts, verification and debugging are available. Skill routing and assistant installation reuse the same catalog and context budget.

## What remains incomplete

Static relationships can miss runtime behavior. The broader revision-aware Change Impact Engine is a design plan; current working-tree analysis lives in guardrails. This checkout has no native MCP server, Python-wheel installer or bundled Open Code Review runtime.

Continue with the [quickstart](quickstart.md) or [installation guide](installation.md).
