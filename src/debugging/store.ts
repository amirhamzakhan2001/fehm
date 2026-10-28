import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { FehmEngine } from '../engine.js';
import { stateDir, writeJsonAtomic } from '../persistence.js';
import { Guardrails } from '../guardrails/workflow.js';
import { digest } from '../guardrails/snapshot.js';
import { indexDigest, investigate } from './investigate.js';
import { validateInput } from './input.js';
import { failureRecord } from './verification.js';
import type { Investigation } from './types.js';

export class InvestigationStore {
  readonly directory: string;
  readonly root: string;
  constructor(root:string, readonly stateDirectory?:string) {
    this.root=realpathSync(root);this.directory=join(stateDir(this.root,stateDirectory),'debugging');
    // Resolve existing ancestors so /var and /private/var aliases cannot hide an internal state path.
    let ancestor=resolve(stateDir(this.root,stateDirectory));
    while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor=dirname(ancestor);
    const canonical=resolve(realpathSync(ancestor),relative(ancestor,resolve(stateDir(this.root,stateDirectory))));
    const local=relative(this.root,canonical);
    if (stateDirectory && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local) && local !== '.fehm' && !local.startsWith(`.fehm${sep}`)) throw new Error('Investigation state inside the repository must be under .fehm to avoid indexing its own evidence; use an external state directory otherwise');

  }
  private path(id:string):string {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid investigation ID');
    // Do not follow repository-controlled symlinks while persisting or reading investigation data.
    for (let path=resolve(this.directory);;path=dirname(path)) {
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Investigation storage must not use symlinks');
      if (path === dirname(this.directory) || path === dirname(path)) break;
    }
    const path=join(this.directory,`${id}.json`);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Investigation file must not be a symlink');
    return path;
  }
  save(report:Investigation):void {
    if (realpathSync(report.root) !== this.root || report.schemaVersion !== 1) throw new Error('Investigation belongs to another repository');
    const path=this.path(report.id);
    if (Buffer.byteLength(JSON.stringify(report))>1024*1024) throw new Error('Investigation exceeds 1 MiB');
    mkdirSync(this.directory,{recursive:true});
    if (existsSync(path)) throw new Error('Investigation versions are immutable; analyze again to save a new version');
    writeJsonAtomic(path,{...report,root:this.root});
  }
  load(id:string):Investigation {
    const path=this.path(id);
    if (lstatSync(path).size>1024*1024) throw new Error('Investigation exceeds 1 MiB');
    const r=JSON.parse(readFileSync(path,'utf8')) as Investigation;
    if (r.schemaVersion !== 1 || r.analysisVersion !== 1 || r.id !== id || r.root !== this.root || !Array.isArray(r.evidence) || !Array.isArray(r.actions) || !Array.isArray(r.hypotheses) || typeof r.indexDigest !== 'string') throw new Error('Invalid saved investigation');
    validateInput(r.input);
    return r;
  }
  remove(id:string):void { unlinkSync(this.path(id)); }
  current(id:string,engine:FehmEngine):Investigation {
    const r=this.load(id);
    r.stale ||= indexDigest(engine) !== r.indexDigest || !engine.freshness().fresh;
    if (r.input.runId && r.input.evidenceId) {
      try { r.reproduction=failureRecord(this.root,r.input.runId,r.input.evidenceId).reproduction; }
      catch { r.reproduction={status:'inconclusive',explanation:'Referenced verification ledger unavailable.',tests:[]}; }
    }
    return r;
  }
  async run(id:string,actionId:string,approve:boolean):Promise<Investigation> {
    if (!approve) throw new Error('Explicit approval is required for the selected existing check');
    const r=this.load(id), action=r.actions.find(a=>a.id === actionId);
    if (!action || action.kind !== 'run-check' || !action.runId || !action.checkId || action.runId !== r.input.runId || !r.input.evidenceId) throw new Error('Action is not an existing verification check');
    const guard=new Guardrails(this.root), record=failureRecord(this.root,action.runId,r.input.evidenceId);
    const check=record.run.policy.checks.find(c=>c.id === action.checkId);
    if (!check || record.before.checkId !== check.id || digest(check.argv) !== digest(action.argv) || check.cwd !== action.cwd) throw new Error('Selected check changed; create a new investigation');
    await guard.execute(action.runId,check.id,'green',true);
    const engine=FehmEngine.open(this.root,{dryRun:true,...(this.stateDirectory ? {stateDirectory:this.stateDirectory}:{})});
    return investigate(engine,r.input);
  }
}
