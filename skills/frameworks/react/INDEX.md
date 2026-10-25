# frameworks / react

Load only skills relevant to the task. [Library compatibility contract](../../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [React Build](react-build/SKILL.md) | Fix React build failures (Vite, webpack, Next.js, CRA, Parcel, esbuild, Bun) incrementally — JSX/TSX compile errors, hydration mismatches, server/client component boundary failures, missing types. Invokes the react-build-resolver agent for minimal, surgical fixes. |
| [React Build Resolver](react-build-resolver/SKILL.md) | Diagnose and fix React build failures across Vite, webpack, Next.js, CRA, Parcel, esbuild, and Bun. Handles JSX/TSX compile errors, hydration mismatches, server/client component boundary failures, missing types, and bundler-specific configuration issues with minimal, surgical changes. MUST BE USED when a React build fails. |
| [React Coding Style Standard](react-coding-style-standard/SKILL.md) | React Coding Style. Use this standard for react coding style standard. |
| [React Hooks Standard](react-hooks-standard/SKILL.md) | React Hooks. Use this standard for react hooks standard. |
| [React Patterns](react-patterns/SKILL.md) | React 18/19 patterns including hooks discipline, server/client component boundaries, Suspense + error boundaries, form actions, data fetching, state management decision trees, and accessibility-first composition. Use when writing or reviewing React components. |
| [React Patterns Standard](react-patterns-standard/SKILL.md) | React Patterns. Use this standard for react patterns standard. |
| [React Performance](react-performance/SKILL.md) | React and Next.js performance optimization patterns adapted from Vercel Engineering's React Best Practices (https://github.com/vercel-labs/agent-skills). Organizes 70+ rules across 8 priority categories — waterfalls, bundle size, server-side, client fetching, re-render, rendering, JS micro-perf, advanced. Use when writing, reviewing, or refactoring React/Next.js code for performance. |
| [React Review](react-review/SKILL.md) | Comprehensive React/JSX code review for hook correctness, render performance, server/client component boundaries, accessibility, and React-specific security. Invokes the react-reviewer agent (and typescript-reviewer alongside on TSX/JSX changes). |
| [React Reviewer](react-reviewer/SKILL.md) | Expert React/JSX code reviewer specializing in hook correctness, render performance, server/client component boundaries, accessibility, and React-specific security. Use for any change touching .tsx/.jsx files or React component logic. MUST BE USED for React projects. |
| [React Security Standard](react-security-standard/SKILL.md) | React Security. Use this standard for react security standard. |
| [React Test](react-test/SKILL.md) | Enforce TDD workflow for React. Write React Testing Library tests first (behavior-focused, accessibility-first), then implement components. Detects Vitest or Jest and verifies coverage targets. |
| [React Testing](react-testing/SKILL.md) | React component testing with React Testing Library, Vitest/Jest, MSW for network mocking, accessibility assertions with axe, and the decision boundary between component tests and Playwright/Cypress end-to-end runs. Use when writing or fixing tests for React components, hooks, or pages. |
| [React Testing Standard](react-testing-standard/SKILL.md) | React Testing. Use this standard for react testing standard. |
