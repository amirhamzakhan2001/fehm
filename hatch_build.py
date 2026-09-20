"""Reject incomplete packages; building an sdist never downloads or builds JS."""
import json
import hashlib
import platform
import sys
from packaging.tags import sys_tags
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        runtime = Path(self.root) / "build/fehm-runtime"
        required = ["dist/cli.js", "package.json", "public/index.html",
                    "integrations/fehm/SKILL.md", "node_modules/typescript/lib/typescript.js",
                    "node_modules/typescript/LICENSE.txt"]
        for name in required:
            if not (runtime / name).is_file():
                raise RuntimeError("Missing bundled engine. Run npm ci && npm run package:python before uv build.")
        if json.loads((runtime / "package.json").read_text())["version"] != self.metadata.version:
            raise RuntimeError("Python and engine versions differ; update pyproject.toml and rebuild the runtime.")

        for component in ["ecc", "gstack", "agency", "memory", "graft"]:
            for item in ["LICENSE", "manifest.json"]:
                if not (runtime / "third_party" / component / item).is_file():
                    raise RuntimeError("Missing third-party attribution: " + component + "/" + item)

        vendor = runtime / "third_party/open-code-review"
        for notice in ["LICENSE", "VIEWER_NOTICE", "licenses/index.json", "licenses/GO_LICENSE", "licenses/ANT_DESIGN_ICONS_LICENSE"]:
            if not (vendor / notice).is_file():
                raise RuntimeError("Missing Open Code Review attribution: " + notice)
        manifest = json.loads((vendor / "manifest.json").read_text())
        bundled_platform = json.loads((vendor / "platform.json").read_text())["platform"]
        arch = {"aarch64": "arm64", "arm64": "arm64", "amd64": "x64", "x86_64": "x64"}.get(platform.machine().lower())
        expected = f"{sys.platform}-{arch}"
        if bundled_platform != expected:
            raise RuntimeError("Build the review engine on the target wheel platform; cross-platform retagging is unsupported.")
        binary = vendor / "bin" / expected / ("ocr.exe" if sys.platform == "win32" else "ocr")
        if hashlib.sha256(binary.read_bytes()).hexdigest() != manifest["assets"][expected]["sha256"]:
            raise RuntimeError("Bundled review engine checksum mismatch")
        if self.target_name == "wheel":
            build_data["pure_python"] = False
            build_data["tag"] = f"py3-none-{next(sys_tags()).platform}"
