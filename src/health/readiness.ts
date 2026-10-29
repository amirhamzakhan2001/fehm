import type { Finding } from '../findings/model.js';
import { isOpen } from '../findings/model.js';
import type { BuildReport } from './types.js';

export type Audience = 'public' | 'private' | 'local' | 'unknown';
export interface ReadinessProfile { include: string[]; audience: Audience }
export interface WebAssessment {
  documents: number;
  publicDocuments: number;
  excluded: number;
  limitations: string[];
}
export interface EngineeringReadiness {
  status: 'risks-detected' | 'evidence-incomplete';
  authorship: 'unknown';
  summary: string;
  areas: { name: string; owner: string; status: 'risks-detected' | 'evidence-incomplete' | 'checked-within-scope'; findingIds: string[]; references?: { title: string; href: string }[]; detail: string }[];
  verification: { checkId: string; status: 'not-run' | 'stale' | 'passed' | 'failed' | 'timeout' | 'error'; command: string }[];
  limitations: string[];
}

/** References existing findings; never copies them or infers authorship from defects. */
export function engineeringReadiness(findings: Finding[], build: BuildReport, web: WebAssessment): EngineeringReadiness {
  const groups = [
    ['Implementation integrity', '/health#ai-code', ['ai-code']],
    ['Reliability', '/health#reliability', ['reliability']],
    ['Tests and verification', '/health#tests', ['test', 'coverage', 'build', 'ci']],
    ['Web Delivery & SEO', '/health#web-delivery', ['web-delivery']],
  ] as const;
  const areas: EngineeringReadiness['areas'] = groups.map(([name, owner, categories]) => {
    const matches = findings.filter(f => isOpen(f) && (categories as readonly string[]).includes(f.category));
    return { name, owner, status: matches.length ? 'risks-detected' : 'evidence-incomplete', findingIds: matches.map(f => f.id), detail: matches.length ? `${matches.length} open findings; inspect their evidence and confidence before drawing a conclusion.` : 'No supported findings detected. This does not establish that the required safeguards work.' };
  });
  areas.push(
    { name: 'Security and trust boundaries', owner: '/security', status: 'evidence-incomplete', findingIds: [], detail: 'Review Security findings and validate resource authorization. This assessment does not execute a security scan.' },
    { name: 'Architecture and system boundaries', owner: '/drift', status: 'evidence-incomplete', findingIds: [], detail: 'Review configured architecture rules and exceptions in Architecture Drift.' },
  );
  const verification = build.checks.map(c => ({ checkId: c.id, command: c.display, status: !c.last ? 'not-run' as const : c.last.stale ? 'stale' as const : c.last.status }));
  const risks = areas.some(a => a.status === 'risks-detected');
  return {
    status: risks ? 'risks-detected' : 'evidence-incomplete', authorship: 'unknown',
    summary: risks ? 'Engineering risks detected. Inspect the evidence and verify the affected behavior.' : 'Engineering readiness is unverified. No supported findings is not proof of production readiness.',
    areas, verification,
    limitations: ['Code observations cannot establish whether an engineer, a beginner or an AI wrote the software.', 'Static absence is not proof of a missing runtime control. Middleware, SDKs and deployment settings may supply safeguards.', 'Passing checks apply only to their recorded scope; they do not prove all critical workflows are correct.', ...web.limitations],
  };
}
