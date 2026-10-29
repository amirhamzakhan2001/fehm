import { createHash } from "node:crypto";
import { estimateTokens } from "../src/compression.js";
import { SkillRegistry } from "../src/skill-registry.js";
import { tempDir, writeFile } from "./helpers.js";

export interface FixtureSkill {
  id: string;
  name?: string;
  description: string;
  kind?: string;
  body?: string;
  /** Skill ids (resolved to SKILL.md paths in the manifest, as the real catalog does). */
  dependsOn?: string[];
  intents?: string[];
  repository?: string;
  upstream?: Record<string, string>;
}

export const MIT = "MIT License\n\nCopyright (c) 2026 Fixture\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n";

/** A long body of distinct-ish prose so token estimates are realistic. */
export function prose(topic: string, tokens: number): string {
  const out: string[] = [`# ${topic}`, "", `Use this when working on ${topic}.`, "", "## Rules", "", `- Always keep ${topic} changes small.`, "", "## Workflow", ""];
  let i = 0;
  while (estimateTokens(out.join("\n")) < tokens) {
    out.push(`${i + 1}. Step ${i + 1} for ${topic}: inspect component${i} carefully, record evidence${i}, then continue with procedure${i}.`);
    i += 1;
  }
  return `${out.join("\n")}\n`;
}

/** Write a manifest-style catalog (the real catalog's format) and return its directory. */
export function makeCatalog(skills: FixtureSkill[], routing?: object, licenses: Record<string, string> = { fixture: MIT }): string {
  const dir = tempDir("fehm-catalog-");
  const pathOf = (id: string): string => `${id}/SKILL.md`;
  const manifest = {
    name: "fixture",
    version: "1.0.0",
    sources: [...new Set(skills.map((s) => s.repository ?? "fixture"))].map((repository) => ({ repository, url: `https://example.com/${repository}`, revision: "snapshot" })),
    skills: skills.map((s) => {
      const content = skillFile(s);
      return {
        id: s.id,
        name: s.name ?? s.id.split("/").at(-1),
        category: s.id.split("/").slice(0, -1).join("/") || "misc",
        path: pathOf(s.id),
        description: s.description,
        kind: s.kind ?? "skill",
        sources: [{ repository: s.repository ?? "fixture", original_path: `skills/${s.id}.md`, sha256: createHash("sha256").update(content).digest("hex") }],
        related_skills: [],
        principles: [],
        dependencies: [pathOf(s.id), ...(s.dependsOn ?? []).map(pathOf)],
        source_metadata: [{ repository: s.repository ?? "fixture", frontmatter: s.upstream ?? { name: s.name ?? s.id.split("/").at(-1)!, description: s.description } }],
      };
    }),
  };
  writeFile(dir, "manifest.json", JSON.stringify(manifest, null, 2));
  if (routing) writeFile(dir, "routing.json", JSON.stringify(routing));
  for (const [repo, text] of Object.entries(licenses)) writeFile(dir, `licenses/${repo}-LICENSE.txt`, text);
  for (const s of skills) writeFile(dir, pathOf(s.id), skillFile(s));
  return dir;
}

export function skillFile(s: FixtureSkill): string {
  const intents = s.intents?.length ? `intents:\n${s.intents.map((i) => `  - ${i}`).join("\n")}\n` : "";
  return `---\nname: ${s.name ?? s.id.split("/").at(-1)}\ndescription: ${JSON.stringify(s.description)}\ncategory: ${s.id.split("/")[0]}\n${intents}---\n\n> **Library use:** Apply the compatibility contract.\n\n${s.body ?? prose(s.name ?? s.id, 200)}`;
}

export function registryOf(dir: string): SkillRegistry {
  return SkillRegistry.fromSources([{ type: "catalog", dir }]);
}
