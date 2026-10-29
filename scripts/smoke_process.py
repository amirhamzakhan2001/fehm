"""Stop installed CLI processes, including Windows console-wrapper children."""
import os
from pathlib import Path
import subprocess
import sys


def stop_process(process):
    if process.poll() is None:
        if sys.platform == 'win32':
            # The smoke runtime PATH deliberately excludes system utilities.
            taskkill = Path(os.environ['SystemRoot']) / 'System32/taskkill.exe'
            result = subprocess.run(
                [str(taskkill), '/PID', str(process.pid), '/T', '/F'],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
            )
            if result.returncode and process.poll() is None:
                raise RuntimeError(f'Cannot stop CLI process tree: {result.stderr!r}')
        else:
            process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def run_cli(args, **kwargs):
    """Keep the wrapper alive until tree cleanup when a command times out."""
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=60)
        return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
    finally:
        stop_process(process)
        process.stdout.close()
        process.stderr.close()
