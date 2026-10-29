# ai / rag

Load only skills relevant to the task. [Library compatibility contract](../../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Iterative Retrieval](iterative-retrieval/SKILL.md) | Pattern for progressively refining context retrieval to solve the subagent context problem. Use when a subagent lacks the context it needs and retrieval must be refined across passes. |
| [Knowledge Graph Engineer](knowledge-graph-engineer/SKILL.md) | Structures information and capabilities into interconnected nodes (entities) and edges (relationships) — enabling dynamic context navigation, modular competency chaining, lower token costs, and hallucination reduction. |
| [Rag Pipeline Engineer](rag-pipeline-engineer/SKILL.md) | Production RAG specialist focused on chunking strategy, retrieval quality, hybrid search, re-ranking, and eval-driven iteration. Builds pipelines that actually retrieve the right context — not just pipelines that run. |
| [Rag Pipeline Reviewer](rag-pipeline-reviewer/SKILL.md) | Reviews RAG (Retrieval-Augmented Generation) pipelines for retrieval quality, chunking strategy, embedding choices, and evaluation coverage. Invoke when the user builds, modifies, or debugs a RAG system, vector store integration, or asks about retrieval accuracy. |
