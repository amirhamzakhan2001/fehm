"""Launch the private Node runtime without npm or a system Node installation."""
import os
from pathlib import Path
import subprocess
import sys


def main():
    try:
        import nodejs_wheel
    except ImportError:
        print("Fehm's private Node runtime is missing. Reinstall the wheel with dependencies.", file=sys.stderr)
        return 1

    runtime = Path(nodejs_wheel.__file__).resolve().parent
    node = runtime / ("node.exe" if os.name == "nt" else "bin/node")
    cli = Path(__file__).resolve().parent / "runtime/dist/cli.js"
    if not node.is_file() or not cli.is_file():
        print("Fehm installation is incomplete. Reinstall the Fehm wheel with uv tool install --reinstall.", file=sys.stderr)
        return 1
    os.environ["FEHM_LAUNCHER"] = str(Path(sys.argv[0]).absolute())
    args = [str(node), str(cli), *sys.argv[1:]]
    # POSIX exec preserves stdin/stdout, the exit code, and SIGTERM/SIGINT for
    # long-running MCP and cockpit processes without leaving a wrapper behind.
    if os.name != "nt":
        try:
            os.execv(str(node), args)
        except OSError as error:
            print(f"Cannot launch Fehm's private Node runtime: {error}. Reinstall the wheel.", file=sys.stderr)
            return 1
    try:
        return subprocess.call(args)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
