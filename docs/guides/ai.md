# Prompts and model use

Ordinary indexing, context retrieval, skill routing and static reports run without an LLM. FEHM estimates the size of generated context; model tokens are consumed when an assistant or model reads that context.

## Inspect prompts

```sh
fehm prompts
fehm prompts --json
```

The /prompts workspace inventories prompts and tool contracts, shows evidence, compares candidates, and retains revision/evaluation records. It does not invent missing roles, permissions or requirements from weak evidence.

## Evaluate honestly

The implemented evaluation workflow uses supplied cases and recorded outputs. Consult fehm help and the technical prompt specification for input schemas. Recorded model outputs are not proof of a new live model run. This checkout does not expose the older fehm ai-evaluations command.

## Optional external commands

Semantic summaries can invoke a configured command provider. Skill routing supports an explicitly configured reranker command. Those commands may contact a model service and incur costs; FEHM cannot guarantee their data handling. Inspect inputs and command configuration before enabling them.

Prompt application uses its own explicit --apply --approve flow. Do not treat a proposed candidate as a tested fix.
