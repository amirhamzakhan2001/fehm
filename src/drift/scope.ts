import type { ProjectContext } from './types.js';
import type { Unit, Responsibility } from './units.js';
export interface ArchitectureArea { name: string; status: 'applicable' | 'insufficient-evidence'; evidence: string[]; limitation: string }
/** Applicability is supported by concrete source signals, never by the absence of a package. */
export function architectureAreas(context: ProjectContext, units: Unit[]): ArchitectureArea[] {
 const area = (name: string, responsibilities: Responsibility[], limitation: string, kinds: string[] = []): ArchitectureArea => {
  const evidence = [...new Set([...units.filter(u => responsibilities.some(r => u.responsibilities.has(r))).map(u=>u.path), ...context.frameworks.filter(f=>kinds.includes(f.kind)).flatMap(f=>f.evidence)])].slice(0,8);
  return {name,status:evidence.length ? 'applicable' : 'insufficient-evidence',evidence,limitation};
 };
 return [
  area('Frontend architecture',['rendering'],'Rendering evidence does not establish browser deployment or whether secrets reach a bundle.',['frontend']),
  area('Backend and API boundaries',['http'],'Route and import signals do not establish complete runtime middleware order.',['backend']),
  area('Database and persistence',['database'],'Data-access evidence does not establish transaction isolation, ownership or production storage.'),
  area('Authentication and authorization',['auth'],'Authentication references do not prove authorization on every protected resource; global policies may be outside the analyzed paths.'),
  area('AI and agent architecture',['ai'],'SDK references do not establish a deployed RAG pipeline or safe tool permissions.',['ml']),
  area('Events and integrations',['messaging','external-api'],'Messaging signals do not establish service boundaries, retries or delivery guarantees.'),
  area('Infrastructure and deployment',['cloud'],'Load balancers, rate limits and health checks require deployment and threat-model evidence; missing declarations are not violations.'),
  area('Configuration and error handling',['configuration','logging'],'Source signals do not establish runtime environment or operational reliability.'),
 ];
}
