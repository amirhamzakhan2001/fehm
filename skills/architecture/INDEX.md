# architecture

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Architect](architect/SKILL.md) | Software architecture specialist for system design, scalability, and technical decision-making. Use PROACTIVELY when planning new features, refactoring large systems, or making architectural decisions. |
| [Architecture Decision Records](architecture-decision-records/SKILL.md) | Capture architectural decisions made during Claude Code sessions as structured ADRs. Auto-detects decision moments, records context, alternatives considered, and rationale. Maintains an ADR log so future developers understand why the codebase is shaped the way it is. |
| [Ats Validator Architect](ats-validator-architect/SKILL.md) | Architect and validator for Applicant Tracking Systems (ATS) and resume parsers. Combines deterministic information retrieval (BM25/TF-IDF and n-grams without AI), quantified Google/IBM X-Y-Z heuristics calibrated by seniority, layout linearization and PDF text layer integrity auditing, regulatory compliance (EU AI Act, NYC LL 144), sub-5ms client-side execution, and Agent-Native BYOK architecture. |
| [Automation Governance Architect](automation-governance-architect/SKILL.md) | Governance-first architect for business automations (n8n-first) who audits value, risk, and maintainability before implementation. |
| [Backend Architect](backend-architect/SKILL.md) | Senior backend architect specializing in scalable system design, database architecture, API development, and cloud infrastructure. Builds robust, secure, performant server-side applications and microservices |
| [Blueprint](blueprint/SKILL.md) | Turn a one-line objective into a step-by-step construction plan for multi-session, multi-agent engineering projects. Each step has a self-contained context brief so a fresh agent can execute it cold. Includes adversarial review gate, dependency graph, parallel step detection, anti-pattern catalog, and plan mutation protocol. TRIGGER when: user requests a plan, blueprint, or roadmap for a complex multi-PR task, or describes work that needs multiple sessions. DO NOT TRIGGER when: task is completable in a single PR or fewer than 3 tool calls, or user says "just do it". |
| [Code Architect](code-architect/SKILL.md) | Designs feature architectures by analyzing existing codebase patterns and conventions, then providing implementation blueprints with concrete files, interfaces, data flow, and build order. |
| [Contract First](contract-first/SKILL.md) | Use when multiple consumers and providers must evolve an API or event schema without field drift, integration surprises, or one side silently redefining the interface. |
| [Hexagonal Architecture](hexagonal-architecture/SKILL.md) | Design, implement, and refactor Ports & Adapters systems with clear domain boundaries, dependency inversion, and testable use-case orchestration across TypeScript, Java, Kotlin, and Go services. Use when introducing or refactoring toward Ports and Adapters, or when domain logic has become entangled with I/O. |
| [Master Plan Architect](master-plan-architect/SKILL.md) | Master planning architect, technical educator, and ruthless plan critic who specializes in deep architectural teaching, Red Teaming / risk critique, and crafting comprehensive Implementation Plans in Markdown with ZERO code execution. |
| [Pdf Engine Architect](pdf-engine-architect/SKILL.md) | Architect and specialist in deterministic HTML-to-PDF document compilation, Playwright browser context pools, dynamic Euclidean page sizing, LayoutNG subpixel budgeting, tagged PDF (PDF/UA-1 & PDF/A-2b), and 1:1 sheet canvas editors. |
| [Salesforce Architect](salesforce-architect/SKILL.md) | Solution architecture for Salesforce platform — multi-cloud design, integration patterns, governor limits, deployment strategy, and data model governance for enterprise-scale orgs |
| [Software Architect](software-architect/SKILL.md) | Expert software architect specializing in system design, domain-driven design, architectural patterns, and technical decision-making for scalable, maintainable systems. |
| [Workflow Architect](workflow-architect/SKILL.md) | Workflow design specialist who maps complete workflow trees for every system, user journey, and agent interaction — covering happy paths, all branch conditions, failure modes, recovery paths, handoff contracts, and observable states to produce build-ready specs that agents can implement against and QA can test against. |

<!-- imported:start -->
| Skill | Purpose |
| --- | --- |
| [deep-modules](deep-modules/SKILL.md) | Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary. (matt-pocock-skills) |
| [improve-codebase-architecture](improve-codebase-architecture/SKILL.md) | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. (matt-pocock-skills) |
| [domain-modeling](domain-modeling/SKILL.md) | Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording or editing an ADR. (matt-pocock-skills) |
<!-- imported:end -->
