#!/usr/bin/env python3
"""Make Go external-link objects relocatable for the Linux LGPL relink kit."""

import json
from pathlib import Path
import shlex
import shutil
import sys


def collect(directory, binary):
    root = Path(directory).resolve()
    if binary not in ("redeven", "redeven-gateway"):
        raise ValueError("unexpected runtime binary")
    lines = (root / "link.log").read_text().splitlines()
    commands = [shlex.split(line.removeprefix("host link: "))
                for line in lines if line.startswith("host link: ")]
    if len(commands) != 1:
        raise ValueError("expected exactly one external link command")
    command = commands[0]
    args = command[1:]
    output_index = args.index("-o") + 1
    args[output_index] = binary
    for i, arg in enumerate(args):
        if not Path(arg).is_absolute():
            continue
        source = Path(arg)
        if source.suffix not in (".o", ".a") or not source.is_file():
            raise ValueError(f"unrecorded absolute linker input: {arg}")
        destination = root / "objects" / source.name
        if source.resolve() != destination.resolve():
            if destination.exists():
                raise ValueError(f"duplicate linker input name: {source.name}")
            shutil.copyfile(source, destination)
        args[i] = "objects/" + source.name
    (root / "link-arguments.json").write_text(json.dumps(args, indent=2) + "\n")
    (root / "relink.py").write_text('''#!/usr/bin/env python3
"""Relink with the target GNU compiler. CC and extra arguments may select a modified libc/sysroot."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
root = Path(__file__).resolve().parent
args = json.loads((root / "link-arguments.json").read_text())
subprocess.run(shlex.split(os.environ.get("CC", "gcc")) + sys.argv[1:] + args, cwd=root, check=True)
''')
    (root / "relink.py").chmod(0o755)
    # The normalized manifest is the portable command; discard runner paths.
    (root / "link.log").unlink()


if __name__ == "__main__":
    collect(*sys.argv[1:])
