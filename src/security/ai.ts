import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FindingEvidence } from "../findings/model.js";
import { secFinding } from "./rules.js";
import type { TaintFlow } from "./taint.js";
import type { AgentTool, AiInventory, AttackSurface, LlmSite, McpServerConfig, SecurityFinding } from "./types.js";

/**
 * LLM, agent and MCP security. Inventory first (providers, frameworks,
 * prompt sites, tools, MCP servers and client configs), then findings and a
 * controls table in the spirit of Skylos' `defend` plugins (tool schema and
 * scope, dangerous sinks, untrusted input to prompts, output validation, PII
 * filtering, model pinning, cost controls, rate limiting, logging).
 * Percentages are the share of sites or tools where evidence of a control
 * was detected, never a statement that the system is safe.
 */

const PROVIDERS: [RegExp, string, "provider" | "framework"][] = [
  [/^openai$/, "OpenAI", "provider"],
  [/^(?:@anthropic-ai\/sdk|anthropic)$/, "Anthropic", "provider"],
  [/^(?:@google\/generative-ai|@google\/genai|google\.generativeai|google\.genai|vertexai)$/, "Google", "provider"],
  [/^(?:cohere|cohere-ai)$/, "Cohere", "provider"],
  [/^(?:mistralai|@mistralai\/mistralai)$/, "Mistral", "provider"],
  [/^(?:ollama)$/, "Ollama (local)", "provider"],
  [/^(?:groq|groq-sdk)$/, "Groq", "provider"],
  [/^(?:@aws-sdk\/client-bedrock-runtime|@aws-sdk\/client-bedrock-agent-runtime)$/, "AWS Bedrock", "provider"],
  [/^(?:replicate|together-ai|together)$/, "Hosted open models", "provider"],
  [/^(?:litellm)$/, "LiteLLM", "provider"],
  [/^(?:ai|@ai-sdk\/\w+)$/, "Vercel AI SDK", "framework"],
  [/^(?:langchain|@langchain\/\w+|langgraph|@langchain\/langgraph)/, "LangChain", "framework"],
  [/^(?:llamaindex|llama_index)/, "LlamaIndex", "framework"],
  [/^(?:crewai)$/, "CrewAI", "framework"],
  [/^(?:autogen|pyautogen|autogen_agentchat)$/, "AutoGen", "framework"],
  [/^(?:@openai\/agents|agents)$/, "OpenAI Agents SDK", "framework"],
  [/^(?:@modelcontextprotocol\/sdk|mcp|fastmcp)/, "Model Context Protocol", "framework"],
];
const ENDPOINTS: [RegExp, string][] = [
  [/api\.openai\.com/, "OpenAI"],
  [/api\.anthropic\.com/, "Anthropic"],
  [/generativelanguage\.googleapis\.com/, "Google"],
  [/(?:localhost|127\.0\.0\.1):11434/, "Ollama (local)"],
];
const SITE = /\.(?:chat\.completions\.create|completions\.create|responses\.create|messages\.create|messages\.stream|generateContent|generate_content|converse|invoke_model)\(|\b(?:generateText|streamText|generateObject|streamObject)\(/;
const TOOL_TS = /\b(?:server|mcp|mcpServer)\.(?:tool|registerTool)\(\s*["'`]([\w.-]+)["'`]|\bnew\s+(?:DynamicStructuredTool|DynamicTool)\(\s*\{|^\s*["']?([\w-]+)["']?\s*:\s*tool\(\s*\{/;
const TOOL_PY = /^\s*@(?:[\w.]*\.)?tool\b/;
const TOOL_JSON = /\btype:\s*["']function["'][^}]*?\bname:\s*["']([\w-]+)["']|\binput_schema\s*:/;
const CAP: [AgentTool["capabilities"][number], RegExp][] = [
  ["shell", /\bchild_process\b|(?<![\w.])(?:exec|execSync|spawn|spawnSync|execFile)\(|\bexeca\(|\bsubprocess\.|\bos\.(?:system|popen)\(/],
  ["code-eval", /(?<![\w.])eval\(|\bnew Function\(|\bvm\.run|(?<![\w.])exec\(\s*(?:compile|code|src)/],
  ["filesystem-write", /\b(?:writeFile|writeFileSync|appendFile|unlink|unlinkSync|rmSync|rm|mkdir|rename)\(|\bopen\([^)]*["'][wa]b?["']|\bshutil\.|\bos\.(?:remove|unlink|rmdir)\(/],
  ["filesystem-read", /\b(?:readFile|readFileSync|readdir|createReadStream)\(|(?<![\w.])open\(/],
  ["network", /\bfetch\(|\baxios\b|\brequests\.|\bhttpx\.|\bhttps?\.(?:get|request)\(|\burlopen\(/],
  ["database", /\.(?:query|execute|raw)\(|\bprisma\.|\bcursor\b|\bknex\(|\bsequelize\./],
];
const APPROVAL = /confirm|approv|human|consent|allowlist|allowList|ALLOWED_|sandbox|dryRun|dry_run|permission|isAllowed|requireConfirmation/;
const POISON = /ignore (?:all |any )?(?:previous|prior|above)|<important>|<\/?system>|do not (?:tell|mention|reveal|inform)|system prompt|before using (?:any|this) tool|you must (?:first|always)|<!--|[​‌‍⁠﻿]/i;
const OUTPUT_CHECK = /generateObject|streamObject|response_format|json_schema|zodResponseFormat|\.parse\(|safeParse|structured_output|with_structured_output|JSON\.parse/;
const PII = /\b(?:redact|pii|presidio|scrub|anonymi[sz]e|mask(?:Email|Pii|Sensitive))\w*/i;
const LOGGING = /\b(?:logger|logging|log)\.\w+\(|console\.(?:log|info|warn|error)\(|\blangfuse|\bhelicone|\blangsmith|\bopentelemetry|\btrace/i;
const DELIMIT = /<\/?(?:user_input|document|context|untrusted)>|```|"""|\.slice\(\s*0\s*,|\bmaxLength\b|\bmax_length\b|truncate/i;
const PINNED = (m: string): boolean => !/latest/i.test(m) && /\d{8}|\d{4}-\d{2}-\d{2}|-\d{3,4}$|@\d|:\d|-v\d+(?:\.\d+)*$|-\d{2}-\d{2}$/.test(m);
const MCP_CONFIGS = [".mcp.json", "mcp.json", ".cursor/mcp.json", ".vscode/mcp.json", "claude_desktop_config.json", ".claude/settings.json"];

export interface AiInputs {
  root: string;
  facts: BriefingFacts;
  skip: (p: string) => boolean;
  flows: TaintFlow[];
  surface: AttackSurface;
}

export function analyzeAi({ root, facts, skip, flows, surface }: AiInputs): { inventory: AiInventory; findings: SecurityFinding[]; configTexts: { path: string; lines: string[] }[] } {
  const files = facts.sourceFiles.filter((p) => !skip(p));
  const providers = new Map<string, Set<string>>();
  const frameworks = new Map<string, Set<string>>();
  for (const p of facts.packages) {
    const hit = PROVIDERS.find(([re]) => re.test(p.name));
    if (!hit) continue;
    const users = p.importers.filter((f) => !skip(f) && facts.roleByPath.get(f) === "source");
    if (!users.length) continue;
    const map = hit[2] === "provider" ? providers : frameworks;
    map.set(hit[1], new Set([...(map.get(hit[1]) ?? []), ...users]));
  }
  const sites: LlmSite[] = [];
  const tools: AgentTool[] = [];
  const mcpServers: AiInventory["mcpServers"] = [];
  const findings: SecurityFinding[] = [];
  const poisoned: FindingEvidence[] = [];
  const secretsToModel: FindingEvidence[] = [];

  for (const path of files) {
    const lines = facts.lines(path);
    const py = /\.py$/.test(path);
    const fileText = lines.slice(0, 20_000).join("\n");
    for (const [re, name] of ENDPOINTS) if (re.test(fileText)) providers.set(name, new Set([...(providers.get(name) ?? []), path]));
    for (let i = 0; i < Math.min(lines.length, 20_000); i += 1) {
      const l = lines[i]!;
      if (/^\s*(?:\/\/|#|\*)/.test(l)) continue;
      if (SITE.test(l)) {
        const window = lines.slice(i, i + 20).join("\n");
        const model = /\bmodel(?:Id|_id)?["']?\s*[:=]\s*(?:\w+\(\s*)?["'`]([^"'`]+)["'`]/.exec(window)?.[1];
        const call = SITE.exec(l)![0].replace(/^\./, "").replace(/\($/, "");
        const provider = [...providers.entries()].find(([, fs]) => fs.has(path))?.[0] ?? [...frameworks.entries()].find(([, fs]) => fs.has(path))?.[0] ?? "unknown";
        const untrusted = flows.some((f) => f.trace.sink.kind === "llm-prompt" && f.path === path && Math.abs(f.trace.steps.at(-1)!.line - (i + 1)) <= 20);
        const sink = flows.find((f) => f.trace.source.kind === "llm-output" && f.path === path && Math.abs(f.trace.steps[0]!.line - (i + 1)) <= 3);
        sites.push({ path, line: i + 1, provider, call, ...(model ? { model, modelPinned: PINNED(model) } : {}), maxTokens: /max_?(?:output_|completion_)?tokens|maxOutputTokens|maxTokens/i.test(window), untrustedInput: untrusted, ...(sink ? { outputToSink: sink.trace.sink.kind } : {}) });
        if (/process\.env\.\w*(?:KEY|SECRET|TOKEN|PASSWORD)\w*|os\.environ\[?["']\w*(?:KEY|SECRET|TOKEN|PASSWORD)/.test(window.split(/messages|prompt|contents|input/i).slice(1).join(""))) secretsToModel.push({ type: "pattern", path, line: i + 1, detail: `${call}: a secret environment value appears in the prompt` });
      }
      const ts = TOOL_TS.exec(l);
      const pyTool = py && TOOL_PY.test(l);
      const json = !py && TOOL_JSON.exec(l);
      if (ts || pyTool || json) {
        let name = ts?.[1] ?? ts?.[2] ?? (json ? json[1] : undefined);
        let end = Math.min(lines.length, i + 60);
        if (pyTool) {
          const def = lines.slice(i + 1, i + 5).findIndex((x) => /^\s*(?:async\s+)?def\s+\w+/.test(x));
          if (def >= 0) {
            const at = i + 1 + def;
            name = /def\s+(\w+)/.exec(lines[at]!)![1];
            const node = facts.definedIn(path).find((n) => n.location?.line === at + 1);
            if (node?.location?.endLine) end = node.location.endLine;
          }
        } else {
          const next = lines.slice(i + 1, end).findIndex((x) => TOOL_TS.test(x));
          if (next >= 0) end = i + 1 + next;
        }
        name ??= /\bname:\s*["'`]([\w.-]+)["'`]/.exec(lines.slice(i, i + 6).join("\n"))?.[1] ?? `tool@${i + 1}`;
        const body = lines.slice(i, end).join("\n");
        const description = /\bdescription["']?\s*[:=]\s*["'`]([^"'`]{3,400})["'`]/.exec(body)?.[1] ?? (pyTool ? /"""([\s\S]{3,400}?)"""/.exec(body)?.[1]?.trim() : undefined) ?? (ts?.[1] ? /["'`][\w.-]+["'`]\s*,\s*["'`]([^"'`]{3,400})["'`]/.exec(l)?.[1] : undefined);
        const capabilities = CAP.filter(([, re]) => re.test(body)).map(([c]) => c);
        const schema = pyTool ? /def\s+\w+\(([^)]*)\)/.test(body) && (/def\s+\w+\(([^)]*)\)/.exec(body)![1]!.split(",").filter((x) => x.trim() && !/^\s*(?:self|ctx|context)\b/.test(x)).every((x) => x.includes(":"))) : /\bz\.\w+\(|inputSchema|parameters\s*:|input_schema|schema\s*:|properties\s*:/.test(body);
        const framework: AgentTool["framework"] = pyTool ? (/mcp|server/.test(l) ? "mcp" : "langchain") : /server|mcp/i.test(l) ? "mcp" : /Dynamic/.test(l) ? "langchain" : /tool\(\s*\{/.test(l) ? "ai-sdk" : json ? "openai" : "other";
        if (!tools.some((t) => t.path === path && t.name === name)) tools.push({ name, framework, path, line: i + 1, capabilities, schema, approval: APPROVAL.test(body), ...(description ? { description: description.slice(0, 200) } : {}) });
        if (description && POISON.test(description)) poisoned.push({ type: "pattern", path, line: i + 1, detail: `tool ${name}: description contains instruction-like text` });
      }
      const http = /\bnew\s+(StreamableHTTPServerTransport|SSEServerTransport)\(|\.run\(\s*transport\s*=\s*["'](sse|streamable-http|http)["']/.exec(l);
      if (http) mcpServers.push({ path, line: i + 1, transport: /SSE|sse/.test(http[0]) ? "sse" : "http", auth: /authorization|bearer|oauth|verifyToken|auth\w*\(|requireAuth|api[_-]?key/i.test(fileText) });
      else if (/\bnew\s+StdioServerTransport\(|\.run\(\s*\)|\.run\(\s*transport\s*=\s*["']stdio["']/.test(l) && /mcp|McpServer|FastMCP/.test(fileText)) mcpServers.push({ path, line: i + 1, transport: "stdio", auth: false });
    }
  }

  // MCP client configurations checked into the repository.
  const mcpConfigs: McpServerConfig[] = [];
  const configTexts: { path: string; lines: string[] }[] = [];
  for (const rel of MCP_CONFIGS) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    configTexts.push({ path: rel, lines });
    let parsed: { mcpServers?: Record<string, { command?: string; args?: string[]; url?: string; type?: string }>; servers?: Record<string, { command?: string; args?: string[]; url?: string; type?: string }> };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      continue;
    }
    for (const [name, s] of Object.entries(parsed.mcpServers ?? parsed.servers ?? {})) {
      const line = Math.max(1, lines.findIndex((l) => l.includes(`"${name}"`)) + 1);
      const args = s.args ?? [];
      const runner = s.command && /(?:^|\/)(?:npx|bunx|pnpm|uvx|pipx)$/.test(s.command);
      const pkg = runner ? args.find((a) => !a.startsWith("-") && a !== "dlx" && a !== "run") : undefined;
      const unpinned = pkg && !/@\d|==\d|@sha|:\d/.test(pkg.replace(/^@[^/]+\//, "")) ? pkg : undefined;
      mcpConfigs.push({ path: rel, line, name, ...(s.command ? { command: [s.command, ...args].join(" ").slice(0, 160) } : {}), transport: s.url ? "http" : s.command ? "stdio" : "unknown", ...(unpinned ? { unpinnedPackage: unpinned } : {}) });
    }
  }

  // Findings.
  const dangerous = tools.filter((t) => t.capabilities.some((c) => c === "shell" || c === "code-eval" || c === "filesystem-write") && !t.approval);
  for (const t of dangerous.slice(0, 20)) {
    const worst = t.capabilities.includes("shell") || t.capabilities.includes("code-eval");
    findings.push(
      secFinding("sec/agent-tool-dangerous", {
        id: `sec:tool:${t.path}:${t.name}`,
        severity: worst ? "high" : "medium",
        title: `Agent tool ${t.name} can ${t.capabilities.filter((c) => c !== "filesystem-read").join(", ")} with no approval step`,
        message: `The ${t.framework} tool's arguments are chosen by the model; nothing in its body asks for confirmation or checks an allowlist.${t.schema ? "" : " It has no input schema either."}`,
        why: "A prompt injection anywhere in the model's input (a web page, a document, a tool result) can make the model call this tool with arguments of the attacker's choosing.",
        action: "Constrain the arguments (allowlist commands or paths, sandbox the working directory), and require human confirmation for destructive operations.",
        confidence: "inferred",
        file: t.path,
        line: t.line,
        symbol: t.name,
        evidence: [{ type: "framework", path: t.path, line: t.line, detail: `${t.framework} tool ${t.name}: ${t.capabilities.join(", ")}` }],
        controlsMissing: ["approval or allowlist"],
        ...(t.schema ? { controlsDetected: ["input schema"] } : {}),
      }),
    );
  }
  const noSchema = tools.filter((t) => !t.schema);
  if (noSchema.length) findings.push(secFinding("sec/agent-tool-no-schema", { id: "sec:tool-schema", title: `${noSchema.length} agent ${noSchema.length === 1 ? "tool has" : "tools have"} no input schema`, message: "No zod schema, JSON-schema parameters or typed signature was found.", why: "Without a schema the model can pass any shape of arguments, and nothing rejects malformed or oversized input before the tool runs.", action: "Declare a schema for every tool (zod, JSON Schema, or type hints for FastMCP).", confidence: "inferred", evidence: noSchema.map((t) => ({ type: "framework" as const, path: t.path, line: t.line, detail: `${t.framework} tool ${t.name}` })) }));
  if (poisoned.length) findings.push(secFinding("sec/mcp-tool-poisoning", { id: "sec:tool-poisoning", title: `${poisoned.length} tool ${poisoned.length === 1 ? "description contains" : "descriptions contain"} instructions to the model`, message: "Tool descriptions are shown to the model as trusted text; these contain instruction-like phrases or hidden characters.", why: "Instructions hidden in a tool description (tool poisoning) steer the model without the user seeing them.", action: "Keep descriptions factual; remove directives, HTML comments and zero-width characters.", confidence: "strong", evidence: poisoned }));
  for (const s of mcpServers.filter((x) => x.transport !== "stdio" && !x.auth)) findings.push(secFinding("sec/mcp-network-no-auth", { id: `sec:mcp-http:${s.path}:${s.line}`, title: `MCP server over ${s.transport.toUpperCase()} with no authentication detected`, message: "A network transport is created, and the file shows no authorization header, token or OAuth check.", why: "Anyone who can reach the port can list and call the server's tools.", action: "Require a bearer token or OAuth on the transport, or bind it to localhost.", confidence: "inferred", file: s.path, line: s.line, evidence: [{ type: "absence", path: s.path, line: s.line, detail: `${s.transport} transport` }] }));
  const unpinnedServers = mcpConfigs.filter((c) => c.unpinnedPackage);
  if (unpinnedServers.length) findings.push(secFinding("sec/mcp-unpinned-server", { id: "sec:mcp-unpinned", title: `${unpinnedServers.length} MCP ${unpinnedServers.length === 1 ? "server is" : "servers are"} launched from an unpinned package`, message: unpinnedServers.map((c) => `${c.name}: ${c.unpinnedPackage}`).join("; "), why: "npx/uvx fetch whatever version is current at launch; a compromised release runs with the agent's access.", action: "Pin the version (package@1.2.3) or install it as a locked dependency.", confidence: "verified", evidence: unpinnedServers.map((c) => ({ type: "config" as const, path: c.path, line: c.line, detail: c.command ?? c.name })) }));
  const prompts = flows.filter((f) => f.trace.sink.kind === "llm-prompt");
  for (const f of prompts.slice(0, 15)) {
    const sink = f.trace.steps.at(-1)!;
    const guarded = DELIMIT.test(facts.lines(f.path).slice(Math.max(0, sink.line - 15), sink.line + 10).join("\n"));
    findings.push(secFinding("sec/llm-prompt-injection", { id: `sec:prompt:${sink.path}:${sink.line}`, severity: guarded ? "low" : "medium", title: `Request data reaches an LLM prompt (${sink.path}:${sink.line})`, message: `${f.trace.source.label} flows into ${f.trace.sink.label}${guarded ? "; a delimiter or length limit was detected nearby" : " with no delimiter or length limit detected"}.`, why: "Text from users or documents can carry instructions; mixed into the prompt without separation it can override the system's intent.", action: "Keep untrusted text in a clearly delimited user message, cap its length, never grant tools more power than the least-trusted input deserves, and validate the output.", confidence: f.resolution === "ast" ? "strong" : "inferred", file: sink.path, line: sink.line, trace: f.trace, evidence: f.trace.steps.map((s) => ({ type: "taint-flow" as const, path: s.path, line: s.line, detail: `${s.role}: ${s.label}` })), ...(guarded ? { controlsDetected: ["delimiter / length limit"] } : { controlsMissing: ["delimiter / length limit"] }) }));
  }
  const unbounded = sites.filter((s) => !s.maxTokens);
  if (unbounded.length) findings.push(secFinding("sec/llm-unbounded", { id: "sec:llm-unbounded", title: `${unbounded.length} LLM ${unbounded.length === 1 ? "call has" : "calls have"} no output-token limit`, message: "No max_tokens / maxOutputTokens / max_completion_tokens near the call.", why: "Unbounded generations cost money and time; an attacker who can trigger them can run up the bill (OWASP LLM10).", action: "Set an output limit, and rate-limit the routes that trigger LLM calls.", confidence: "inferred", evidence: unbounded.map((s) => ({ type: "pattern" as const, path: s.path, line: s.line, detail: `${s.call}${s.model ? ` (${s.model})` : ""}` })) }));
  const unpinnedModels = sites.filter((s) => s.model && !s.modelPinned);
  if (unpinnedModels.length) findings.push(secFinding("sec/llm-model-unpinned", { id: "sec:model-unpinned", title: `${unpinnedModels.length} LLM ${unpinnedModels.length === 1 ? "call uses" : "calls use"} a model alias rather than a pinned version`, message: [...new Set(unpinnedModels.map((s) => s.model))].join(", "), why: "An alias can move to a new model version whose behaviour, safety tuning and cost differ.", action: "Use a dated snapshot identifier where the provider offers one, and upgrade deliberately.", confidence: "strong", evidence: unpinnedModels.map((s) => ({ type: "pattern" as const, path: s.path, line: s.line, detail: `model ${s.model}` })) }));
  if (secretsToModel.length) findings.push(secFinding("sec/llm-secret-to-model", { id: "sec:secret-to-model", title: `${secretsToModel.length} LLM ${secretsToModel.length === 1 ? "prompt includes" : "prompts include"} a secret value`, message: "A secret-named environment variable appears inside the prompt arguments.", why: "Anything in a prompt can be echoed back to the user or logged by the provider.", action: "Keep credentials out of prompts; give tools the credential instead of the model.", confidence: "inferred", evidence: secretsToModel }));

  // Controls table.
  const around = (s: { path: string; line: number }, re: RegExp): boolean => re.test(facts.lines(s.path).slice(Math.max(0, s.line - 15), s.line + 25).join("\n"));
  const untrusted = sites.filter((s) => s.untrustedInput);
  const risky = tools.filter((t) => t.capabilities.some((c) => c !== "filesystem-read"));
  const llmRoutes = surface.routes.filter((r) => r.reaches.llm);
  const piiAnywhere = files.some((p) => PII.test(facts.lines(p).slice(0, 5000).join("\n")));
  const controls: AiInventory["controls"] = [
    { id: "untrusted-input", label: "Prompt-injection separation (delimiter or length limit on untrusted input)", applicable: untrusted.length, detected: untrusted.filter((s) => around(s, DELIMIT)).length },
    { id: "tool-schema", label: "Tool input schemas", applicable: tools.length, detected: tools.filter((t) => t.schema).length },
    { id: "tool-scope", label: "Approval or allowlist on powerful tools", applicable: risky.length, detected: risky.filter((t) => t.approval).length },
    { id: "output-validation", label: "Structured or validated model output", applicable: sites.length, detected: sites.filter((s) => around(s, OUTPUT_CHECK)).length },
    { id: "no-dangerous-sink", label: "Model output kept away from dangerous sinks", applicable: sites.length, detected: sites.filter((s) => !s.outputToSink).length },
    { id: "pii", label: "PII filtering near the call", applicable: sites.length, detected: piiAnywhere ? sites.filter((s) => around(s, PII)).length : 0 },
    { id: "model-pinned", label: "Pinned model versions", applicable: sites.filter((s) => s.model).length, detected: sites.filter((s) => s.modelPinned).length },
    { id: "cost", label: "Output-token limits", applicable: sites.length, detected: sites.filter((s) => s.maxTokens).length },
    { id: "rate-limit", label: "Rate limiting on routes that call models", applicable: llmRoutes.length, detected: llmRoutes.filter((r) => r.rateLimit.state === "detected").length },
    { id: "logging", label: "Logging or tracing around model calls", applicable: sites.length, detected: sites.filter((s) => around(s, LOGGING)).length },
  ];
  const count = (m: Map<string, Set<string>>): { name: string; files: number }[] => [...m].map(([name, fs]) => ({ name, files: fs.size })).sort((a, b) => b.files - a.files);
  return { inventory: { providers: count(providers), frameworks: count(frameworks), sites, tools, mcpServers, mcpConfigs, controls }, findings, configTexts };
}
