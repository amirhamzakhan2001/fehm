"""Launch the private Node runtime without npm or a system Node installation."""
import os
from pathlib import Path
import subprocess
import sys


def main():
    import nodejs_wheel

    runtime = Path(nodejs_wheel.__file__).resolve().parent
    node = runtime / ("node.exe" if os.name == "nt" else "bin/node")
    cli = Path(__file__).resolve().parent / "runtime/dist/cli.js"
    if not node.is_file() or not cli.is_file():
        print("Fehm installation is incomplete. Reinstall the Fehm wheel with uv tool install --reinstall.", file=sys.stderr)
        return 1
    args = [str(node), str(cli), *sys.argv[1:]]
    # POSIX exec preserves stdin/stdout, the exit code, and SIGTERM/SIGINT for
    # long-running MCP and cockpit processes without leaving a wrapper behind.
    if os.name != "nt":
        os.execv(str(node), args)
    try:
        return subprocess.call(args)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
