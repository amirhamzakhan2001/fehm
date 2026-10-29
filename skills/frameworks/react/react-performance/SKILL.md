---
name: react-performance
description: React and Next.js performance optimization patterns adapted from Vercel Engineering's React Best Practices
  (https://github.com/vercel-labs/agent-skills). Organizes 70+ rules across 8 priority categories — waterfalls,
  bundle size, server-side, client fetching, re-render, rendering, JS micro-perf, advanced. Use when writing, reviewing,
  or refactoring React/Next.js code for performance.
category: frameworks/react
sources:
- repository: ecc
  original_path: skills/react-performance/SKILL.md
  sha256: ac76e8694d4f802a7bccc3c07a73ac68ace6d82a65ea10f10d8b7384dda61a8f
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# React Performance

React and Next.js performance optimization patterns adapted from Vercel Engineering's React Best Practices (https://github.com/vercel-labs/agent-skills). Organizes 70+ rules across 8 priority categories — waterfalls, bundle size, server-side, client fetching, re-render, rendering, JS micro-perf, advanced. Use when writing, reviewing, or refactoring React/Next.js code for performance.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: React Performance; When to Activate; Priority Index; 1. Eliminating Waterfalls (CRITICAL); Cheap conditions before await; Defer awaits until used; Promise.all for independent work; Partial dependencies — start early, await late; Suspense for streaming; Server Components: parallel through composition; 2. Bundle Size Optimization (CRITICAL); Direct imports, not barrels; Statically analyzable paths; Dynamic imports for heavy components.

## Related skills and principles

- [accessibility/accessibility](../../../accessibility/accessibility/SKILL.md)
- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/nextjs/nextjs-turbopack](../../nextjs/nextjs-turbopack/SKILL.md)
- [frameworks/react/react-build](../react-build/SKILL.md)
- [frameworks/react/react-build-resolver](../react-build-resolver/SKILL.md)
- [frameworks/react/react-patterns](../react-patterns/SKILL.md)
- [frameworks/react/react-review](../react-review/SKILL.md)
- [frameworks/react/react-reviewer](../react-reviewer/SKILL.md)
- [frameworks/react/react-test](../react-test/SKILL.md)
- [frameworks/react/react-testing](../react-testing/SKILL.md)
- [frontend/frontend-patterns](../../../frontend/frontend-patterns/SKILL.md)

## Source provenance

- `ecc/skills/react-performance/SKILL.md`
