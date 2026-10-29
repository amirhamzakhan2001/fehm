---
name: workflow-book-chapter
description: 'Workflow Example: Book Chapter Development. Use this methodology for workflow book chapter.'
category: orchestration
sources:
- repository: agency-agents
  original_path: examples/workflow-book-chapter.md
  sha256: a0382f06c7536579be480c737d56257c3247b55fbacfc6fdc219f870053a8f3f
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Workflow Example: Book Chapter Development

> A focused single-agent workflow for turning rough source material into a strategic first-person chapter draft with explicit revision loops.

## When to Use This

Use this workflow when an author has voice notes, fragments, or strategic notes, but not yet a clean chapter draft. The goal is not generic ghostwriting. The goal is to produce a chapter that strengthens category positioning, preserves the author's voice, and exposes open editorial decisions clearly.

## Agent Used

| Agent | Role |
|-------|------|
| Book Co-Author | Converts source material into a versioned chapter draft with editorial notes and next-step questions |

## Example Activation

```text
Activate Book Co-Author.

Book goal: Build authority around practical AI adoption for Mittelstand companies.
Target audience: Owners and operational leaders of 20-200 person businesses.
Chapter topic: Why most AI projects fail before implementation starts.
Desired draft maturity: First substantial draft.

Raw material:
- Voice memo: "The real failure happens in expectation setting, not tooling."
- Notes: Leaders buy software before defining the operational bottleneck.
- Story fragment: We nearly rolled out the wrong automation in a cabinetmaking workflow because the actual problem was quoting delays, not production throughput.
- Positioning angle: Practical realism over hype.

Produce:
1. Chapter objective and strategic role in the book
2. Any clarification questions you need
3. Chapter 2 - Version 1 - ready for review
4. Editorial notes on assumptions and proof gaps
5. Specific next-step revision requests
```

## Expected Output Shape

The Book Co-Author should respond in five parts:

1. `Target Outcome`
2. `Chapter Draft`
3. `Editorial Notes`
4. `Feedback Loop`
5. `Next Step`

## Quality Bar

- The draft stays in first-person voice
- The chapter has one clear promise and internal logic
- Claims are tied to source material or flagged as assumptions
- Generic motivational language is removed
- The output ends with explicit revision questions, not a vague handoff

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `agency-agents/examples/workflow-book-chapter.md`
