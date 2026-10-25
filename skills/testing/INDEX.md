# testing

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Accessibility Auditor](accessibility-auditor/SKILL.md) | Expert accessibility specialist who audits interfaces against WCAG standards, tests with assistive technologies, and ensures inclusive design. Defaults to finding barriers — if it's not tested with a screen reader, it's not accessible. |
| [Ai Regression Testing](ai-regression-testing/SKILL.md) | Regression testing strategies for AI-assisted development. Sandbox-mode API testing without database dependencies, automated bug-check workflows, and patterns to catch AI blind spots where the same model writes and reviews code. Use when adding regression coverage to AI-assisted code, or when the same model both wrote and reviewed a change. |
| [Api Tester](api-tester/SKILL.md) | Expert API testing specialist focused on comprehensive API validation, performance testing, and quality assurance across all systems and third-party integrations |
| [Browser Qa](browser-qa/SKILL.md) | Use this skill to automate visual testing and UI interaction verification using browser automation after deploying features. |
| [Click Path Audit](click-path-audit/SKILL.md) | Trace every user-facing button/touchpoint through its full state change sequence to find bugs where functions individually work but cancel each other out, produce wrong final state, or leave the UI in an inconsistent state. Use when: systematic debugging found no bugs but users report broken buttons, or after any major refactor touching shared state stores. |
| [E2E Runner](e2e-runner/SKILL.md) | End-to-end testing specialist using Vercel Agent Browser (preferred) with Playwright fallback. Use PROACTIVELY for generating, maintaining, and running E2E tests. Manages test journeys, quarantines flaky tests, uploads artifacts (screenshots, videos, traces), and ensures critical user flows work. |
| [E2E Testing](e2e-testing/SKILL.md) | Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management, and flaky test strategies. Use when writing Playwright tests, structuring page objects, or fixing flaky E2E runs in CI. |
| [Evidence Collector](evidence-collector/SKILL.md) | Screenshot-obsessed, fantasy-allergic QA specialist - Default to finding 3-5 issues, requires visual proof for everything |
| [Health](health/SKILL.md) | Code quality dashboard. (gstack) |
| [Performance Benchmarker](performance-benchmarker/SKILL.md) | Expert performance testing and optimization specialist focused on measuring, analyzing, and improving system performance across all applications and infrastructure |
| [Pr Test Analyzer](pr-test-analyzer/SKILL.md) | Review pull request test coverage quality and completeness, with emphasis on behavioral coverage and real bug prevention. |
| [Qa](qa/SKILL.md) | Systematically QA test a web application and fix bugs found. (gstack) |
| [Qa Only](qa-only/SKILL.md) | Report-only QA testing. (gstack) |
| [Reality Checker](reality-checker/SKILL.md) | Stops fantasy approvals, evidence-based certification - Default to "NEEDS WORK", requires overwhelming proof for production readiness |
| [Skill Health](skill-health/SKILL.md) | Show skill portfolio health dashboard with charts and analytics |
| [Tdd Guide](tdd-guide/SKILL.md) | Test-Driven Development specialist enforcing write-tests-first methodology. Use PROACTIVELY when writing new features, fixing bugs, or refactoring code. Ensures 80%+ test coverage. |
| [Tdd Workflow](tdd-workflow/SKILL.md) | Use this skill when writing new features, fixing bugs, or refactoring code. Enforces test-driven development with 80%+ coverage including unit, integration, and E2E tests. |
| [Test Automation Engineer](test-automation-engineer/SKILL.md) | Expert end-to-end test automation engineer for Playwright and Cypress — resilient selectors, flake elimination, isolated test data, CI parallelization, and trace-driven failure debugging. |
| [Test Coverage](test-coverage/SKILL.md) | Analyze coverage, identify gaps, and generate missing tests toward the target threshold. |
| [Test Results Analyzer](test-results-analyzer/SKILL.md) | Expert test analysis specialist focused on comprehensive test result evaluation, quality metrics analysis, and actionable insight generation from testing activities |
| [Tool Evaluator](tool-evaluator/SKILL.md) | Expert technology assessment specialist focused on evaluating, testing, and recommending tools, software, and platforms for business use and productivity optimization |
| [Workflow Optimizer](workflow-optimizer/SKILL.md) | Expert process improvement specialist focused on analyzing, optimizing, and automating workflows across all business functions for maximum productivity and efficiency |

<!-- imported:start -->
| Skill | Purpose |
| --- | --- |
| [test-driven-development](test-driven-development/SKILL.md) | Use when implementing any feature or bugfix, before writing implementation code (superpowers) |
| [tdd-red-green](tdd-red-green/SKILL.md) | Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests. (matt-pocock-skills) |
| [migrate-to-shoehorn](migrate-to-shoehorn/SKILL.md) | Migrate test files from `as` type assertions to @total-typescript/shoehorn. Use when user mentions shoehorn, wants to replace `as` in tests, or needs partial test data. (matt-pocock-skills) |
<!-- imported:end -->
