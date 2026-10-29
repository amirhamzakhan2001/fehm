import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FehmEngine } from '../engine.js';
import { git, optionalGit } from '../git-memory/git.js';
import { digest } from '../guardrails/snapshot.js';
import { safeIndexedPath, parseFrames, resolveFrames, sanitize, validateInput } from './input.js';
import { failureRecord } from './verification.js';
import type { DiagnosticAction, FailureInput, Investigation, InvestigationEvidence } from './types.js';

export const indexDigest = (engine: FehmEngine): string => digest([...engine.fileHashes()].sort(([a],[b])=>a.localeCompare(b)));
const LIMITS = {files:12,nodes:60,evidence:80};
export function investigate(engine: FehmEngine, supplied: FailureInput): Investigation {
  const input = validateInput(supplied), unknowns: string[] = [];
  const captured = input.runId && input.evidenceId ? failureRecord(engine.root,input.runId,input.evidenceId) : undefined;
  const failureText = sanitize([input.text ?? '',captured?.before.output ?? ''].join('\n'));
  const observedInput = {...input,text:failureText};
  const traceApplicable = !captured || captured.before.fingerprint === captured.snapshot.fingerprint;
  if (!traceApplicable) unknowns.push('The original execution predates the current source snapshot. Its frames are historical; current line mapping is not established.');
  if ((input.text?.length ?? 0) >= 32000) unknowns.push('Failure text was bounded to 32,000 characters; earlier context may be absent.');
  const head = optionalGit(engine.root,['rev-parse','HEAD']);
  const report: Investigation = {
    schemaVersion:1,analysisVersion:1,id:randomUUID(),root:engine.root,created:new Date().toISOString(),input,head,indexDigest:indexDigest(engine),stale:!engine.freshness().fresh,
    revisionStatus:input.failureRevision ? head?.startsWith(input.failureRevision) ? 'matches HEAD' : 'different or unavailable' : 'unknown',
    summary:'Cause not established. Gather a discriminating observation before changing code.',frames:resolveFrames(engine,parseFrames(observedInput)),evidence:[],hypotheses:[],actions:[],
    reproduction:captured?.reproduction ?? {status:'not attempted',explanation:'Supplied failure text is an observation, not FEHM execution evidence.',tests:[]},unknowns,
    limitations:['Static relationships are not an observed runtime or data-flow trace.', 'Only indexed repository source is read; external libraries and runtime service state are unknown.', 'No model, network request, project check execution or source modification occurs during analysis. Local Git commands only read evidence.', 'Hypotheses are tentative. A passing test does not establish a root cause.', 'History is bounded and compared against the current checkout; source maps and historical symbol mapping are unsupported.'],bounds:{files:0,nodes:0,evidence:0,truncated:false},
  };
  const add = (e: Omit<InvestigationEvidence,'id'>): string => {
    if (report.evidence.length >= LIMITS.evidence) { report.bounds.truncated=true; return ''; }
    if (e.text.length > 6000) report.bounds.truncated=true;
    const id=`e${report.evidence.length + 1}`; report.evidence.push({...e,text:sanitize(e.text).slice(0,6000),id}); return id;
  };
  const observations: string[] = [];
  if (input.text || !captured) observations.push(add({origin:'user-input',kind:'observation',text:input.text ?? 'Selected source location; runtime behavior was not supplied.'}));
  if (captured) observations.push(add({origin:'execution',kind:'output',text:captured.before.output}));
  const observation=observations.at(-1)!;
  if (report.revisionStatus !== 'matches HEAD') unknowns.push('Failure revision is unknown or differs from HEAD; current source locations may not describe the failing build.');
  if (report.frames.some(f=>f.mapping === 'suffix')) unknowns.push('Some paths were mapped by unique indexed suffix; confirm that the failing build uses this checkout.');
  if (report.frames.some(f=>f.status !== 'resolved')) unknowns.push('Some reported frames are ambiguous, outside the index, or have invalid line numbers.');
  if (report.frames.length === 100) report.bounds.truncated=true;
  const anchors = report.frames.filter(f=>f.status === 'resolved').slice(0,8);
  if (report.frames.filter(f=>f.status === 'resolved').length > 8) report.bounds.truncated=true;
  const seeds = anchors.map(f=>f.nodeId!);
  if (!seeds.length) {
    const query = failureText.slice(0,2000);
    for (const hit of engine.search(query,{intent:'debug',limit:5,depth:0})) seeds.push(hit.nodeId);
    unknowns.push('No exact stack location resolved. Search matches are navigation leads, not causal evidence.');
  }
  const nodes = new Set(seeds), queue=seeds.map(id=>({id,depth:0}));
  const paths = new Set<string>();
  const ranges = new Map<string,{start:number;end:number;nodeId:string}[]>();
  const excerpt = (path:string,line:number,nodeId:string) => {
    if (!safeIndexedPath(engine,path)) return;
    if (!paths.has(path) && paths.size >= LIMITS.files) { report.bounds.truncated=true; return; }
    const lines=engine.sourceLines(path); if (!lines || line < 1 || line > lines.length) return;
    paths.add(path);
    const start=Math.max(1,line-6), end=Math.min(lines.length,line+8), existing=ranges.get(path) ?? [];
    const overlap=existing.find(r=>r.start <= end && r.end >= start);
    if (overlap) { overlap.start=Math.min(overlap.start,start); overlap.end=Math.min(overlap.end+15,Math.max(overlap.end,end)); }
    else if (existing.length < 3) existing.push({start,end,nodeId}); else report.bounds.truncated=true;
    ranges.set(path,existing);
  };
  for (const anchor of anchors) excerpt(anchor.resolvedPath!,anchor.line,anchor.nodeId!);
  for (let i=0;i<queue.length;i++) {
    const item=queue[i]!, node=engine.graph.node(item.id); if (!node) continue;
    if (node.path) excerpt(node.path,node.location?.line ?? 1,node.id);
    if (item.depth >= 2) continue;
    for (const edge of engine.graph.edgesOf(node.id,'both',['calls','references','imports','handles','writes','configures'])) {
      const other=edge.source === node.id ? edge.target : edge.source;
      if (nodes.has(other)) continue;
      if (nodes.size >= LIMITS.nodes) { report.bounds.truncated=true; break; }
      nodes.add(other);queue.push({id:other,depth:item.depth+1});
      if (report.evidence.filter(e=>e.kind === 'relationship').length < 35) add({origin:'repository',kind:'relationship',edgeId:edge.id,provenance:edge.evidence.provenance,text:`${edge.source} --${edge.kind}--> ${edge.target}. ${edge.evidence.detail ?? ''}`});
    }
  }
  for (const [path,list] of ranges) for (const range of list) {
    const lines=engine.sourceLines(path)!;
    add({origin:'repository',kind:'source',path,line:range.start,endLine:range.end,nodeId:range.nodeId,sourceHash:engine.fileHashes().get(path)!,text:lines.slice(range.start-1,range.end).map((s,i)=>`${range.start+i}: ${s.length>300 ? (report.bounds.truncated=true,s.slice(0,300)+' …'):s}`).join('\n')});
  }
  for (const id of nodes) {
    const n=engine.graph.node(id);
    if (n?.isTest && n.path) add({origin:'repository',kind:'test',nodeId:n.id,path:n.path,text:`${n.name}: connected statically; execution is not established.`});
  }
  if (!report.evidence.some(e=>e.kind === 'test')) unknowns.push('No connected tests found in the bounded traversal. This does not establish that tests are absent.');
  const anchoredPaths=[...new Set(anchors.map(a=>a.resolvedPath!))].slice(0,3);
  if (anchoredPaths.length && head) {
    try {
      const changes=git(engine.root,['diff','--no-ext-diff','--no-textconv','--no-color','--unified=3','HEAD','--',...anchoredPaths],128*1024);
      if (changes.trim()) add({origin:'git',kind:'change',commit:head,text:changes.slice(0,6000)});
      const history=git(engine.root,['log','-10','--format=%h %s','--',...anchoredPaths],32000);
      if (history.trim()) add({origin:'git',kind:'change',commit:head,text:`Recent commits touching anchored paths (recency is not causality):\n${history}`});
      const commits=git(engine.root,['log','-3','--format=%H','--',...anchoredPaths],32000).trim().split('\n').filter(id=>/^[a-f0-9]{40,64}$/.test(id));
      for (const commit of commits) {
        const patch=git(engine.root,['show','--format=','--no-ext-diff','--no-textconv','--no-color','--unified=3',commit,'--',...anchoredPaths],128*1024);
        if (patch.trim()) add({origin:'git',kind:'change',commit,text:`Historical change; relevance to this failure is unconfirmed.\n${patch}`});
      }

      if (changes.length>6000) report.bounds.truncated=true;
    } catch { unknowns.push('Targeted Git evidence is unavailable or exceeds its bound.'); }
  } else if (!head) unknowns.push('Git HEAD unavailable; no recent-change attribution can be made.');
  const action = (a:Omit<DiagnosticAction,'id'>): string => { const id=`a${report.actions.length+1}`; report.actions.push({...a,id}); return id; };
  if (captured) {
    const check=captured.run.policy.checks.find(c=>c.id === captured.before.checkId);
    if (check) action({kind:'run-check',title:'Rerun the recorded check',reason:'Compare the original failure with new execution evidence using the same command.',confirms:'The original named test fails again with a comparable assertion.',rejects:'The original named test passes; this rejects persistence in this run, not every alternative cause.',evidenceIds:[observation],runId:captured.run.id,checkId:check.id,argv:check.argv,cwd:check.cwd});
  }
  const text=failureText, sources=report.evidence.filter(e=>e.kind === 'source');
  const hypothesize=(cause:string,rationale:string,evidenceIds:string[],missing:string,alternatives:string[],a:Omit<DiagnosticAction,'id'>) => {
    if (report.hypotheses.length>=3) return;
    report.hypotheses.push({id:`h${report.hypotheses.length+1}`,cause,confidence:'tentative',status:'proposed',rationale,evidenceIds,missing,alternatives,actionId:action(a)});
  };
  // Only anchored, contemporaneous source can support these narrow rules. Unknown revision stays a hypothesis.
  if (traceApplicable && anchors.length && report.revisionStatus !== 'different or unavailable') {
    const config=sources.find(e=>/process\.env|os\.environ|os\.getenv/.test(e.text));
    if (config && /missing|required|undefined|environment|configuration/i.test(text)) hypothesize('A required configuration value may be missing or invalid in the failing process.','The supplied failure and an anchored configuration read are compatible; runtime configuration has not been observed.',[...observations,config.id],'Presence and type of the named value in the failing process.', ['The wrong environment or deployed revision may have been selected.','A caller may supply an invalid value despite valid configuration.'],{kind:'inspect',title:'Check configuration presence in the failing process',reason:'Distinguish missing configuration from invalid upstream input without exposing a secret.',confirms:'The required key is absent or has the wrong type in that process.',rejects:'The expected key is present and valid in the failing process.',evidenceIds:[config.id]});
    const anchorSource=sources.find(e=>anchors.some(f=>f.resolvedPath === e.path && f.line >= e.line! && f.line <= e.endLine!));
    if (anchorSource && /TypeError|AttributeError|Cannot read properties|NoneType/.test(text)) hypothesize('The failing operation may receive a missing value or an unexpected shape.','A reported type/attribute error maps to repository code. The value and its producer are not known.',[...observations,anchorSource.id],'The value and arguments at the exact failing operation.', ['The test fixture may construct an unsupported input.','The supplied trace may refer to another revision.'],{kind:'inspect',title:'Inspect the receiver and caller arguments at the reported line',reason:'Observe the failing value before changing guards or defaults.',confirms:'The value is absent or has a shape incompatible with the operation.',rejects:'The expected value and shape reach this operation in the reproducer.',evidenceIds:[anchorSource.id]});
    if (anchorSource && /ERR_ASSERTION|AssertionError|assertion.*fail/i.test(text)) hypothesize('The implementation and the test expectation may disagree at this boundary.','An assertion failure anchors the investigation, but does not establish whether code, fixture or expectation is wrong.',[...observations,anchorSource.id],'Expected and actual values, fixture setup and intended behavior.', ['The fixture may be stale.','Environment-dependent behavior may change the result.'],{kind:'inspect',title:'Compare the assertion with its fixture and immediate callee',reason:'Distinguish a behavioral regression from a fixture or expectation error.',confirms:'The intended input produces a result that violates the stated requirement.',rejects:'The fixture or expected value does not represent the intended requirement.',evidenceIds:[anchorSource.id]});
  }
  const changed=report.evidence.find(e=>e.kind === 'change' && e.text.includes('diff --git'));
  if (changed && report.actions.length < 3) action({kind:'compare-change',title:'Compare the anchored change with the failing input',reason:'A change touches a reported path; chronology and causal relevance must be checked.',confirms:'The same reproducer passes before the change and fails after it in a comparable environment.',rejects:'The same failure occurs before the change, or the changed branch is not exercised.',evidenceIds:[changed.id]});
  if (!report.actions.length) action({kind:'supply-observation',title:anchors.length ? 'Supply the expected and actual value at the failing location' : 'Supply a repository location or a reproducible failing test',reason:'Available evidence does not distinguish a cause.',confirms:'A concrete failing input and observation anchor a testable explanation.',rejects:'If the symptom cannot be reproduced, runtime/deployment evidence is still required.',evidenceIds:[observation]});
  if (report.hypotheses.length) report.summary=`${report.hypotheses.length} tentative explanation${report.hypotheses.length === 1 ? '' : 's'}; no root cause is confirmed.`;
  for (const path of paths) {
    try { if (!safeIndexedPath(engine,path) || createHash('sha256').update(readFileSync(join(engine.root,path))).digest('hex') !== engine.fileHashes().get(path)) report.stale=true; }
    catch { report.stale=true; }
  }
  if (!engine.freshness().fresh) report.stale=true;
  if (report.stale) { report.hypotheses=[];report.summary='Source changed during analysis. Refresh before using these conclusions.';unknowns.push('Analysis is stale; source excerpts are historical evidence only.'); }
  report.bounds={files:paths.size,nodes:nodes.size,evidence:report.evidence.length,truncated:report.bounds.truncated};
  if (report.bounds.truncated) unknowns.push('Collection reached a scope or output bound; evidence is incomplete.');
  return report;
}
