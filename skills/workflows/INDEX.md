# workflows

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Autoplan](autoplan/SKILL.md) | Auto-review pipeline — reads the full CEO, design, eng, and DX review skills from disk and runs them sequentially with auto-decisions using 6 decision principles. (gstack) |
| [Bug Fixing](bug-fixing/SKILL.md) | Diagnose a reproducible defect, make the smallest repair, and prove the repair. |
| [Code Review](code-review/SKILL.md) | Compose structural review, engineering checks, and constructive specialist feedback. |
| [Design Review](design-review/SKILL.md) | Combine design direction, accessibility-aware UX, and live visual verification. |
| [Dev Context](dev-context/SKILL.md) | Development Context. Use this context for dev context. |
| [Dmux Workflows](dmux-workflows/SKILL.md) | Multi-agent orchestration using dmux (tmux pane manager for AI agents). Patterns for parallel agent workflows across Claude Code, Codex, OpenCode, and other harnesses. Use when running multiple agent sessions in parallel or coordinating multi-agent development workflows. |
| [Documentation](documentation/SKILL.md) | Create task-appropriate documentation and reconcile it with implementation. |
| [Dynamic Workflow Mode](dynamic-workflow-mode/SKILL.md) | Design task-local harnesses, eval gates, and reusable skill extraction for Claude dynamic workflow mode and other adaptive agent harnesses. Use when building a task-local harness, adding eval gates, or extracting a reusable skill from ad-hoc work. |
| [Feature Dev](feature-dev/SKILL.md) | Guided feature development with codebase understanding and architecture focus |
| [Feature Development](feature-development/SKILL.md) | Develop a feature from clarified intent through evidence-based release and reflection. |
| [Gstack Workflow Router](gstack-workflow-router/SKILL.md) | Router for the gstack skill suite. (gstack) |
| [Intent Driven Development](intent-driven-development/SKILL.md) | Turn ambiguous or high-impact product and engineering changes into scoped, verifiable acceptance criteria before or alongside implementation. Use when a user asks to clarify a feature, define acceptance criteria, de-risk a security/data/migration/integration change, prepare implementation requirements for another agent, or make a complex request testable. Do not trigger for trivial edits, straightforward fixes, active debugging, code review, or implementation requests whose acceptance conditions are already clear unless the user explicitly invokes this skill. |
| [Multi Agent Development](multi-agent-development/SKILL.md) | Coordinate bounded specialist work with explicit ownership, handoffs, and verified integration. |
| [Nasiko Control Plane](nasiko-control-plane/SKILL.md) | Use the experimental Nasiko CLI lifecycle bridge for pinned installation, read-only status, and qualified uninstall with explicit consent and telemetry and secrets boundaries. |
| [Plan](plan/SKILL.md) | Restate requirements, assess risks, and create step-by-step implementation plan. WAIT for user CONFIRM before touching any code. |
| [Plan Canvas](plan-canvas/SKILL.md) | Open plans and HTML artifacts in a local browser canvas where the human annotates elements, chats, and approves or requests changes without leaving the page. Use when presenting a plan for review, or when feedback like "move this, change that" is easier pointed at than typed. |
| [Plan Prd](plan-prd/SKILL.md) | Generate a lean, problem-first PRD and hand off to /plan for implementation planning. |
| [Plan Prd Pattern](plan-prd-pattern/SKILL.md) | Plan-PRD Pattern: Markdown-Staged Planning Flow. Use this methodology for plan prd pattern. |
| [Planner](planner/SKILL.md) | Expert planning specialist for complex features and refactoring. Use PROACTIVELY when users request feature implementation, architectural changes, or complex refactoring. Automatically activated for planning tasks. |
| [Project Init](project-init/SKILL.md) | Detect a project's stack and produce a dry-run ECC onboarding plan using the repository's install manifests and stack mappings. |
| [Prp Implement](prp-implement/SKILL.md) | Execute an implementation plan with rigorous validation loops |
| [Prp Plan](prp-plan/SKILL.md) | Create comprehensive feature implementation plan with codebase analysis and pattern extraction |
| [Prp Prd](prp-prd/SKILL.md) | Interactive PRD generator - problem-first, hypothesis-driven product spec with back-and-forth questioning |
| [Refactoring](refactoring/SKILL.md) | Refactor within an explicit scope while preserving observable behavior. |
| [Release](release/SKILL.md) | Prepare, document, land, deploy, and monitor a verified change. |
| [Research](research/SKILL.md) | Search, evaluate, and synthesize evidence before recommending implementation. |
| [Research Context](research-context/SKILL.md) | Research Context. Use this context for research context. |
| [Review Context](review-context/SKILL.md) | Code Review Context. Use this context for review context. |
| [Security Review](security-review/SKILL.md) | Select a security assessment variant and preserve its evidence and execution boundaries. |
| [Tdd](tdd/SKILL.md) | Use tests to define behavior, implement minimally, then verify the resulting change. |

<!-- imported:start -->
| Skill | Purpose |
| --- | --- |
| [brainstorming](brainstorming/SKILL.md) | You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation. (superpowers) |
| [writing-plans](writing-plans/SKILL.md) | Use when you have a spec or requirements for a multi-step task, before touching code (superpowers) |
| [executing-plans](executing-plans/SKILL.md) | Use when executing an implementation plan in the current session as the implementer yourself — your human partner chose inline execution, or no subagent tool is available (superpowers) |
| [requesting-code-review](requesting-code-review/SKILL.md) | Use when completing tasks, implementing major features, or before merging to verify work meets requirements (superpowers) |
| [receiving-code-review](receiving-code-review/SKILL.md) | Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation (superpowers) |
| [implement-from-spec](implement-from-spec/SKILL.md) | Implement a piece of work based on a spec or set of tickets. (matt-pocock-skills) |
| [grilling](grilling/SKILL.md) | Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases. (matt-pocock-skills) |
<!-- imported:end -->
