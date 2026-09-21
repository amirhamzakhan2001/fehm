"""Install a release wheel with uv, then exercise it without system Node/npm.

Usage: python3 scripts/python-smoke.py python-dist/fehm-1.4.0-py3-none-PLATFORM.whl
All installations and repository changes stay inside a temporary directory.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request


def main():
    source_root = Path(__file__).resolve().parent.parent
    version = json.loads((source_root / "package.json").read_text())["version"]
    wheel = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else max((source_root / "python-dist").glob(f"fehm-{version}-py3-none-*.whl"), key=lambda p: p.stat().st_mtime)
    uv = shutil.which("uv")
    if not uv or not wheel.is_file():
        raise SystemExit("Provide a built wheel and install uv first.")
    with tempfile.TemporaryDirectory(prefix="fehm-uv-smoke-") as directory:
        root = Path(directory)
        env = dict(os.environ, UV_TOOL_DIR=str(root / "tools"), UV_TOOL_BIN_DIR=str(root / "bin"))
        subprocess.run([uv, "tool", "install", str(wheel)], env=env, check=True)
        fehm = root / "bin" / ("fehm.exe" if os.name == "nt" else "fehm")
        # Fehm must launch its dependency by absolute path, not a global node/npm.
        empty_path = root / "empty-path"
        empty_path.mkdir()
        env["PATH"] = str(empty_path)
        env["NODE_PATH"] = ""
        repo = root / "sample repository"
        repo.mkdir()
        (repo / "auth.ts").write_text("export function authenticate(token: string) { return token.length > 0; }\n")

        def run(*args):
            result = subprocess.run([str(fehm), *args], cwd=repo, env=env, text=True, capture_output=True, timeout=60)
            if result.returncode:
                raise AssertionError(f"{args}: {result.stdout}\n{result.stderr}")
            return result.stdout

        print("Fehm version:", run("--version").strip())
        assert "1.12.7" in run("review", "engine-version")
        run("scan", ".")
        graph = json.loads((repo / ".fehm/graph.json").read_text())
        # Windows short names (RUNNER~1), casing and symlink resolution can
        # differ between Node and Python while naming the same directory.
        indexed_root = Path(graph["repository"]["root"])
        assert indexed_root.is_absolute(), f"Graph root is not absolute: {indexed_root}"
        assert indexed_root.samefile(repo), (
            f"Graph indexed the wrong directory: {indexed_root}; expected {repo.resolve()}"
        )
        assert "authenticate" in run("query", "authenticate")
        run("practices", "audit", "--json")
        for platform in ["claude", "cursor", "codex", "gemini", "copilot", "vscode", "generic"]:
            run("install", "--project", "--platform", platform)
            status = json.loads(run("integrations", "--project", "--platform", platform, "--json"))
            assert status[0]["state"] == "current"
            run("uninstall", "--project", "--platform", platform)
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        ]
        mcp = subprocess.run([str(fehm), "mcp"], input="\n".join(map(json.dumps, messages)) + "\n",
                             cwd=repo, env=env, text=True, capture_output=True, timeout=30, check=True)
        responses = [json.loads(line) for line in mcp.stdout.splitlines()]
        assert any(r.get("id") == 2 and "tools" in r.get("result", {}) for r in responses), mcp.stdout
        # Check bundled cockpit assets and process shutdown, including a path with spaces.
        with (root / "server.log").open("w+") as log:
            server = subprocess.Popen([str(fehm), "serve", ".fehm/graph.json", "--port", "0"], cwd=repo, env=env, stdout=log, stderr=log)
            try:
                import re
                url = None
                for _ in range(100):
                    log.seek(0)
                    output = log.read()
                    match = re.search(r"http://127\.0\.0\.1:\d+", output)
                    if match:
                        url = match.group(0)
                        break
                    if server.poll() is not None:
                        raise AssertionError(output)
                    time.sleep(0.1)
                assert url, "Cockpit did not announce a listening address"
                with urllib.request.urlopen(url, timeout=10) as response:
                    assert response.status == 200 and b"<html" in response.read().lower()
            finally:
                if os.name == "nt":
                    # Windows TerminateProcess has no POSIX signal propagation;
                    # stop the console wrapper and its Node child as one tree.
                    subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"], check=True, capture_output=True)
                else:
                    server.terminate()
                server.wait(timeout=10)
        failed = subprocess.run([str(fehm), "stats", "missing.json"], cwd=repo, env=env, capture_output=True)
        assert failed.returncode != 0
        print("PASS: isolated uv install, no system Node/npm, scan, query, practices, all integrations, MCP, cockpit, exit codes")


if __name__ == "__main__":
    main()
