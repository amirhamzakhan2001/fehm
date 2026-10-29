"""Verify the prebuilt, portable JS runtime without network or compilation."""
import hashlib
import json
from pathlib import Path
from hatchling.builders.hooks.plugin.interface import BuildHookInterface

class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        runtime = Path(self.root) / "build/fehm-runtime"
        manifest = runtime / "runtime-manifest.json"
        if not manifest.is_file():
            raise RuntimeError("Run npm ci && npm run package:python before uv build")
        data = json.loads(manifest.read_text())
        if data["version"] != self.metadata.version:
            raise RuntimeError("Python and runtime versions differ")
        for name, expected in data["files"].items():
            file = runtime / name
            if file.is_symlink() or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
                raise RuntimeError("Runtime integrity mismatch: " + name)
        actual = {p.relative_to(runtime).as_posix() for p in runtime.rglob("*") if p.is_file()}
        if actual != set(data["files"]) | {"runtime-manifest.json"}:
            raise RuntimeError("Unexpected runtime files")
        for name in ["dist/cli.js", "package.json", "skills/manifest.json", "assets/ontology/fehm_engineering_ontology.json", "integrations/fehm/SKILL.md", "THIRD_PARTY_NOTICES.md"]:
            if name not in data["files"]:
                raise RuntimeError("Missing runtime asset: " + name)
        # No native binary in this wheel. Node is a separately platform-tagged dependency.
