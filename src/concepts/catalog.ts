import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync as Database } from 'node:sqlite';
import type { ConceptCandidate, ConceptRecord, DetectionGuidance, OntologyCatalog } from './types.js';
export const ONTOLOGY_PATH = fileURLToPath(new URL('../../assets/ontology/fehm_engineering_ontology.json', import.meta.url));
export const normalizeConceptTerm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[-_\s]+/gu, ' ').trim();
const TYPES = new Set(['anti_pattern', 'artifact', 'concept', 'failure_mode', 'mechanism', 'metric', 'pattern', 'principle', 'property', 'term']);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim().length > 0);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validateOntology(value: unknown): OntologyCatalog {
    const fail = (message: string): never => { throw new Error(`Invalid ontology: ${message}`); };
    if (!object(value) || value.schema_version !== '1.0' || !object(value.metadata) || typeof value.metadata.version !== 'string' || !Array.isArray(value.sections) || !object(value.detection_profiles) || !object(value.policy) || value.policy.catalog_only !== true)
        fail('root/schema/metadata');
    const x = value as unknown as OntologyCatalog;
    const ids = new Map<string, ConceptRecord>(), names = new Set<string>(), sections = new Set<string>();
    const guidance = (g: unknown) => {
        if (!object(g))
            throw new Error('Invalid ontology: detection guidance');
        for (const key of ['modes', 'evidence', 'signals', 'anti_signals', 'requirements'])
            if (g[key] !== undefined && !strings(g[key]))
                fail(`guidance ${key}`);
        if (g.limit !== undefined && typeof g.limit !== 'string')
            fail('guidance limit');
        if (Array.isArray(g.modes) && g.modes.some(m => !x.policy.detection_modes.includes(String(m))))
            fail('detection mode');
    };
    if (!strings(x.policy.detection_modes) || !strings(x.policy.confidence_labels))
        fail('policy');
    for (const g of Object.values(x.detection_profiles))
        guidance(g);
    const facets = (v: unknown) => { if (v !== undefined && (!object(v) || Object.values(v).some(a => !strings(a))))
        fail('retrieval facets'); };
    for (const section of x.sections) {
        if (!section || typeof section.id !== 'string' || !section.id || typeof section.name !== 'string' || sections.has(section.id) || !Array.isArray(section.concepts))
            fail('section');
        sections.add(section.id);
        facets(section.retrieval);
        for (const c of section.concepts) {
            if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || typeof c.definition !== 'string' || !c.definition.trim() || !strings(c.aliases) || !strings(c.related) || !TYPES.has(c.type))
                fail(`record ${c?.id ?? '?'}`);
            if (ids.has(c.id) || names.has(normalizeConceptTerm(c.name)))
                fail(`duplicate identity/name ${c.id}`);
            guidance(c.detection);
            if (!x.detection_profiles[c.detection.profile])
                fail(`profile ${c.id}`);
            facets(c.retrieval);
            if (c.source_entries !== undefined && !strings(c.source_entries))
                fail('source entries');
            ids.set(c.id, c);
            names.add(normalizeConceptTerm(c.name));
        }
    }
    for (const c of ids.values()) {
        for (const id of [...c.related, ...(c.parent ? [c.parent] : [])])
            if (!ids.has(id) || id === c.id)
                fail(`edge ${c.id} → ${id}`);
        const visited = new Set([c.id]);
        let parent = c.parent;
        while (parent) {
            if (visited.has(parent))
                fail(`parent cycle ${c.id}`);
            visited.add(parent);
            parent = ids.get(parent)?.parent;
        }
    }
    if (x.metadata.total_sections !== sections.size || x.metadata.total_concepts !== ids.size)
        fail('metadata counts');
    return x;
}
function sqlite(path: string): Database {
    try {
        const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
        return new DatabaseSync(path);
    }
    catch (e) {
        throw new Error(`Ontology SQLite requires Node.js 22.13+ (current ${process.version}): ${(e as Error).message}`);
    }
}
export class OntologyIndex {
    private constructor(private readonly db: Database, readonly hash: string, readonly version: string, readonly rebuilt: boolean) { }
    static open(options: {
        catalogPath?: string;
        stateDirectory?: string;
        memory?: boolean;
    } = {}): OntologyIndex {
        const text = readFileSync(options.catalogPath ?? ONTOLOGY_PATH, 'utf8');
        // Validate before touching either the current database or its rollback copy.
        const catalog = validateOntology(JSON.parse(text)), hash = createHash('sha256').update(text).digest('hex');
        const path = options.stateDirectory && !options.memory ? join(options.stateDirectory, 'ontology.sqlite') : ':memory:';
        if (path !== ':memory:' && existsSync(path)) {
            let existing: Database | undefined;
            try {
                existing = sqlite(path);
                if (existing.prepare('SELECT value FROM metadata WHERE key = ?').get('hash')?.value === hash && existing.prepare('SELECT value FROM metadata WHERE key = ?').get('indexVersion')?.value === '1' && Number(existing.prepare('SELECT count(*) AS n FROM concepts').get()?.n) === catalog.metadata.total_concepts)
                    return new OntologyIndex(existing, hash, catalog.metadata.version, false);
            }
            catch { /* Rebuild a corrupt or incompatible derived index. */ }
            existing?.close();
        }
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        const temp = path === ':memory:' ? path : `${path}.${randomUUID()}.tmp`;
        const db = sqlite(temp);
        try {
            db.exec(`BEGIN; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE concepts(id TEXT PRIMARY KEY,section TEXT,type TEXT,name TEXT,definition TEXT,search TEXT,record TEXT);
        CREATE TABLE terms(term TEXT,concept TEXT,kind TEXT,PRIMARY KEY(term,concept,kind)); CREATE INDEX term_lookup ON terms(term);
        CREATE TABLE sections(id TEXT PRIMARY KEY,name TEXT,record TEXT);
        CREATE TABLE profiles(id TEXT PRIMARY KEY,record TEXT);
        CREATE TABLE facets(concept TEXT,kind TEXT,value TEXT);
        CREATE TABLE edges(source TEXT,target TEXT,kind TEXT,PRIMARY KEY(source,target,kind)); CREATE INDEX edge_source ON edges(source);`);
            const term = db.prepare('INSERT OR IGNORE INTO terms VALUES (?,?,?)'), record = db.prepare('INSERT INTO concepts VALUES (?,?,?,?,?,?,?)');
            const facet = db.prepare('INSERT INTO facets VALUES (?,?,?)'), edge = db.prepare('INSERT OR IGNORE INTO edges VALUES (?,?,?)');
            for (const [id, p] of Object.entries(catalog.detection_profiles))
                db.prepare('INSERT INTO profiles VALUES (?,?)').run(id, JSON.stringify(p));
            for (const section of catalog.sections) {
                db.prepare('INSERT INTO sections VALUES (?,?,?)').run(section.id, section.name, JSON.stringify({ id: section.id, name: section.name, retrieval: section.retrieval }));
                for (const c of section.concepts) {
                    record.run(c.id, section.id, c.type, c.name, c.definition, normalizeConceptTerm([c.name, ...c.aliases, c.definition, section.name].join(' ')), JSON.stringify(c));
                    term.run(normalizeConceptTerm(c.name), c.id, 'canonical');
                    c.aliases.forEach(a => term.run(normalizeConceptTerm(a), c.id, 'alias'));
                    c.related.forEach(id => edge.run(c.id, id, 'related_to'));
                    if (c.parent)
                        edge.run(c.id, c.parent, 'parent');
                    for (const retrieval of [section.retrieval, c.retrieval])
                        for (const [kind, values] of Object.entries(retrieval ?? {}))
                            for (const v of values)
                                facet.run(c.id, kind, v);
                }
            }
            for (const [key, value] of Object.entries({ hash, version: catalog.metadata.version, indexVersion: '1' }))
                db.prepare('INSERT INTO metadata VALUES (?,?)').run(key, value);
            db.exec('COMMIT');
            if (Number(db.prepare('SELECT count(*) AS n FROM concepts').get()?.n) !== catalog.metadata.total_concepts)
                throw new Error('Ontology index probe failed');
            if (path === ':memory:')
                return new OntologyIndex(db, hash, catalog.metadata.version, true);
            db.close();
            if (existsSync(path))
                copyFileSync(path, `${path}.previous`);
            renameSync(temp, path);
            return new OntologyIndex(sqlite(path), hash, catalog.metadata.version, true);
        }
        catch (error) {
            try {
                db.close();
            }
            catch { }
            if (temp !== ':memory:' && existsSync(temp))
                unlinkSync(temp);
            throw error;
        }
    }
    close(): void { this.db.close(); }
    all(): ConceptCandidate[] {
        return this.db.prepare('SELECT c.record,c.section,s.name AS sectionName FROM concepts c JOIN sections s ON s.id=c.section').all().map(row => ({ ...JSON.parse(String(row.record)) as ConceptRecord, section: String(row.section), sectionName: String(row.sectionName), retrievalScore: 0, match: 'text' as const }));
    }
    summary() {
        return { version: this.version, hash: this.hash, concepts: Number(this.db.prepare('SELECT count(*) AS n FROM concepts').get()?.n), sections: this.db.prepare('SELECT id,name FROM sections ORDER BY name').all(), types: this.db.prepare('SELECT DISTINCT type FROM concepts ORDER BY type').all().map(r => String(r.type)), ambiguities: this.db.prepare('SELECT term, count(DISTINCT concept) AS candidates FROM terms GROUP BY term HAVING count(DISTINCT concept)>1').all() };
    }
    get(id: string): ConceptCandidate | undefined {
        const row = this.db.prepare('SELECT c.record,c.section,s.name AS sectionName FROM concepts c JOIN sections s ON s.id=c.section WHERE c.id=?').get(id);
        return row ? { ...JSON.parse(String(row.record)) as ConceptRecord, section: String(row.section), sectionName: String(row.sectionName), retrievalScore: 0, match: 'text' } : undefined;
    }
    lookup(query: string, options: {
        section?: string;
        type?: string;
        limit?: number;
    } = {}) {
        const limit = options.limit ?? 30;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new Error('Concept lookup limit must be 1–100');
        const normalized = normalizeConceptTerm(query);
        const exact = this.db.prepare('SELECT concept,kind FROM terms WHERE term=? ORDER BY kind DESC,concept').all(normalized);
        const exactCandidates = [...new Set(exact.map(r => String(r.concept)))].map(id => ({ ...this.get(id)!, retrievalScore: exact.some(r => r.concept === id && r.kind === 'canonical') ? 100 : 90, match: exact.some(r => r.concept === id && r.kind === 'canonical') ? 'canonical' as const : 'alias' as const }));
        const terms = normalized.split(/\s+/).filter(t => t.length > 1 && !['the', 'does', 'this', 'have', 'where', 'what', 'how', 'are', 'and', 'for', 'with', 'project', 'implement', 'using', 'is', 'in'].includes(t)).slice(0, 12);
        let candidates: ConceptCandidate[] = exactCandidates;
        if (!exact.length) {
            const escape = (s: string) => s.replace(/[\\%_]/g, '\\$&');
            const rows = this.db.prepare(`SELECT id,search FROM concepts WHERE ${terms.length ? terms.map(() => "search LIKE ? ESCAPE '\\'").join(' OR ') : '1'} ORDER BY id`).all(...terms.map(t => `%${escape(t)}%`));
            candidates = rows.map(row => ({ ...this.get(String(row.id))!, retrievalScore: terms.reduce((n, t) => n + (String(row.search).includes(t) ? 1 : 0), 0) }));
        }
        candidates = candidates.filter(c => (!options.section || c.section === options.section) && (!options.type || c.type === options.type)).sort((a, b) => b.retrievalScore - a.retrievalScore || a.name.localeCompare(b.name));
        return { query, exact: exact.length > 0, ambiguous: exactCandidates.length > 1, total: candidates.length, candidates: candidates.slice(0, limit), rankingNote: 'Scores rank vocabulary candidates; they are not evidence confidence.' };
    }
    terms(): {
        term: string;
        id: string;
    }[] { return this.db.prepare('SELECT DISTINCT term,concept FROM terms').all().map(r => ({ term: String(r.term), id: String(r.concept) })); }
    guidance(id: string): DetectionGuidance {
        const c = this.get(id);
        if (!c)
            throw new Error('Unknown concept');
        const p = JSON.parse(String(this.db.prepare('SELECT record FROM profiles WHERE id=?').get(c.detection.profile)?.record)) as DetectionGuidance;
        const merged: DetectionGuidance = { profile: c.detection.profile };
        for (const k of ['modes', 'evidence', 'signals', 'anti_signals', 'requirements'] as const)
            merged[k] = [...new Set([...(p[k] ?? []), ...(c.detection[k] ?? [])])];
        merged.limit = [p.limit, c.detection.limit].filter(Boolean).join(' ');
        return merged;
    }
    neighborhood(id: string, depth = 1, limit = 20) {
        if (!this.get(id))
            throw new Error('Unknown concept');
        if (!Number.isInteger(depth) || depth < 0 || depth > 2 || !Number.isInteger(limit) || limit < 1 || limit > 50)
            throw new Error('Neighborhood depth 0–2, limit 1–50');
        const seen = new Set([id]), edges: {
            source: string;
            target: string;
            kind: string;
        }[] = [];
        let frontier = [id];
        for (let d = 0; d < depth; d++) {
            const next: string[] = [];
            for (const source of frontier)
                for (const row of this.db.prepare('SELECT * FROM edges WHERE source=? ORDER BY kind,target').all(source)) {
                    const target = String(row.target);
                    if (!seen.has(target) && seen.size >= limit)
                        continue;
                    edges.push({ source, target, kind: String(row.kind) });
                    if (!seen.has(target)) {
                        seen.add(target);
                        next.push(target);
                    }
                }
            frontier = next;
        }
        return { nodes: [...seen].map(i => this.get(i)!), edges, note: 'Ontology relationships do not imply repository implementation.' };
    }
}
