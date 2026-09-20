# Public website plan

The initial public website is implemented in `website/`: 28 static pages covering the product, installation, six assistant integrations, practices, thirteen native documentation guides, release notes, privacy, and 404 recovery. It is separate from the local cockpit. The complete implementation and launch plan is [website/PLAN.md](../website/PLAN.md); setup is in [website/README.md](../website/README.md). Hosting, domain, live analytics, visual-browser qualification, and deployment remain pending.

## Product story

Lead with the outcome: understand a codebase, keep changes aligned with its architecture, and give agents focused evidence. Present the same ten website capability groups as the README:

1. Understand the system.
2. Give agents focused context.
3. Keep engineering practices consistent.
4. Review and verify changes.
5. Improve quality and reliability.
6. Engineer AI systems.
7. Operate and share the codebase brain.

Explain architecture drift with a small before/after dependency example. Explain practice drift with a removed CI/test control. Keep project approval and static-evidence limitations visible. Avoid “all industry standards,” “fully autonomous safety,” or feature-count marketing claims.

## Sitemap

| Page | Purpose |
| --- | --- |
| Home | Outcome, three concrete workflows, sanitized product preview, install action |
| Product | Seven groups with representative reports and their limits |
| Engineering practices | Profiles, approval, exemptions, architecture versus practice drift |
| Getting started | uv installation, assistant registration, scan, localhost URL, first query, optional MCP setup |
| Documentation | CLI help, APIs, architecture, deployment, troubleshooting |
| Security | Local/default privacy boundary, explicit provider calls, execution trust |
| Releases and roadmap | Verified release artifacts and clearly labeled future work |

## Demo boundary

Use a synthetic or deliberately public repository. Replace absolute personal paths and avoid proprietary symbols, prompts, secrets, real traces, approval records, or source excerpts. A static demo must be labeled as a demo and must not claim a live connection to the visitor's repository.

The local cockpit is the working interface. The website should link to setup instructions instead of trying to become a second analysis engine.

## Design and accessibility

Use readable typography, semantic navigation, keyboard-accessible controls, meaningful alternative text, visible focus, and responsive layouts. Screenshots should show an understandable task rather than a dense graph without explanation. Provide text equivalents for interactive examples.

Public routes need appropriate metadata, real 404 responses, crawler decisions, performance budgets, and link checks. Those concerns differ from the private localhost cockpit, which does not need search indexing.

Implement server-rendered/static indexable content, unique titles and descriptions, canonical URLs, sitemap.xml, robots.txt, Open Graph cards, and appropriate structured data. Each capability and assistant integration should have a useful explanation and tested code examples. Avoid empty pages created only to target search terms.

The website implements optional GA4 with an environment-configured measurement ID, explicit opt-in before loading Google, sanitized page locations, and allowlisted link events. No property is connected by default. Analytics does not identify every individual visitor. Review deployment-specific privacy disclosures and property settings before enabling it. Repository paths, source code, prompts, secrets, and localhost activity are outside the website's measurement scope.

## Release acceptance

Before launch, verify installation instructions against the released artifact, all links/downloads, browser behavior, accessibility, responsive layout, security headers, and factual claims. Do not publish automatically as part of a code audit. Hosting, domain registration, analytics, and public deployment need explicit decisions and authorization.
