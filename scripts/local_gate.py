#!/usr/bin/env python3
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time

SCHEMA = 1
FILE_HASHES = {}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def git(root, *args, env=None):
    return subprocess.check_output(["git", "-C", str(root), *args], env=env, text=True).strip()


def log(message):
    print("[local-gate] " + message, flush=True)


def actual_tree(root):
    with tempfile.TemporaryDirectory(prefix="local-gate-index-") as directory:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(directory) / "index"))
        has_head = subprocess.run(["git", "-C", str(root), "rev-parse", "--verify", "HEAD"], capture_output=True).returncode == 0
        subprocess.run(["git", "-C", str(root), "read-tree", "HEAD" if has_head else "--empty"], env=env, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "-C", str(root), "add", "--all", "--", "."], env=env, check=True, stdout=subprocess.DEVNULL)
        return git(root, "write-tree", env=env)


def source_tree(root, mode, tip=None):
    actual = actual_tree(root)
    if mode == "staged":
        expected = git(root, "write-tree")
        if expected != actual:
            raise RuntimeError("working source differs from the staged Git tree; stage or set aside the remaining changes before committing")
        return expected
    if mode == "committed":
        head = git(root, "rev-parse", "HEAD")
        if tip and git(root, "rev-parse", "--verify", tip + "^{commit}") != head:
            raise RuntimeError("the tested commit must be the checked-out HEAD")
        expected = git(root, "rev-parse", "HEAD^{tree}")
        if expected != actual or git(root, "status", "--porcelain"):
            raise RuntimeError("committed validation requires a clean worktree matching HEAD")
        return expected
    return actual


def hash_path(path, boundary=None):
    if boundary is None:
        path = path.resolve() if path.is_symlink() else path
        boundary = path
    if path.is_symlink():
        target = path.resolve()
        if not target.is_relative_to(boundary):
            raise RuntimeError("external dependency symlink is not a reproducible environment input: " + str(path))
        return digest(["link", str(target.relative_to(boundary))])
    if not path.exists():
        return "absent"
    if path.is_dir():
        return digest([(p.name, hash_path(p, boundary)) for p in sorted(path.iterdir()) if p.name not in (".cache", ".vite", ".vite-temp", "__pycache__")])
    stat = path.stat()
    key = (str(path), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_mode)
    if key in FILE_HASHES:
        return FILE_HASHES[key]
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    result = digest([stat.st_mode & 0o111, value.hexdigest()])
    FILE_HASHES[key] = result
    return result


def environment(root, definition, memo):
    ignored = {"PWD", "OLDPWD", "SHLVL", "_", "TERM", "TERM_SESSION_ID", "GIT_PREFIX", "GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE", "GIT_EDITOR", "GIT_EXEC_PATH"}
    values = {k: v for k, v in os.environ.items() if k not in ignored and not k.startswith(("CODEX_", "XPC_", "__CF", "LOCAL_GATE_"))}
    git_helpers = subprocess.check_output(["git", "--exec-path"], text=True).strip()
    values["PATH"] = os.pathsep.join(p for p in values.get("PATH", "").split(os.pathsep) if p != git_helpers)
    values.pop("CI", None)
    for name in definition.get("ignore_env", []):
        values.pop(name, None)
    probes = []
    for command in definition.get("probes", []):
        key = tuple(command)
        if key not in memo:
            result = subprocess.run(command, cwd=root, capture_output=True, timeout=60)
            if result.returncode:
                raise RuntimeError("environment probe failed: " + command[0])
            memo[key] = digest([result.stdout.hex(), result.stderr.hex()])
        probes.append([command, memo[key]])
    paths = [(name, hash_path(root / Path(name).expanduser())) for name in definition.get("paths", [])]
    return digest([platform.system(), platform.machine(), platform.release(), sys.version, values, probes, paths])


def atomic_write(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="state-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.chmod(name, 0o600)
            json.dump(state, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(name)


@contextlib.contextmanager
def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        os.chmod(path, 0o600)
        try:
            if os.name == "nt":
                import msvcrt
                stream.seek(0)
                stream.write(b"0")
                stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("another local gate holds this repository lock; no state was overwritten") from error
        try:
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def load_state(path):
    try:
        state = json.loads(path.read_text())
        if state.get("schema") != SCHEMA or not all(isinstance(state.get(k), dict) for k in ("groups", "cursors", "commits", "rounds")):
            raise ValueError("invalid state")
        return state
    except FileNotFoundError:
        pass
    except (ValueError, TypeError, AttributeError):
        log("INVALIDATE all: unreadable or obsolete state; no cached pass is trusted")
    return {"schema": SCHEMA, "groups": {}, "cursors": {}, "commits": {}, "rounds": {}}


class Interrupted(Exception):
    pass


def execute(root, command, extra_env):
    env = dict(os.environ, **extra_env)
    for name in git(root, "rev-parse", "--local-env-vars").splitlines():
        env.pop(name, None)
    process = subprocess.Popen(command, cwd=root, env=env, start_new_session=os.name != "nt")
    try:
        return process.wait()
    except Interrupted:
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        raise


def components(root, group, manifest, tree, args, memo):
    inputs = dict(manifest.get("environment", {}))
    for name in ("paths", "probes", "ignore_env"):
        inputs[name] = inputs.get(name, []) + group.get("environment", {}).get(name, [])
    context = {}
    if group.get("staged_diff"):
        context["staged_diff"] = digest(git(root, "diff", "--cached", "--binary"))
    for name in group.get("context", []):
        value = getattr(args, name)
        if not value:
            raise RuntimeError("group " + group["id"] + " requires --" + name)
        context[name] = git(root, "rev-parse", "--verify", value + "^{commit}")
    return {"source": tree, "environment": environment(root, inputs, memo), "definition": digest([group, manifest.get("environment", {}), Path(__file__).read_bytes().hex()]), "context": digest(context)}


def run(root, manifest, state, state_path, args):
    groups = manifest["groups"]
    ids = [g["id"] for g in groups]
    if len(set(ids)) != len(ids):
        raise RuntimeError("duplicate group IDs")
    selected_ids = manifest["profiles"][args.profile] if not args.group else args.group
    if not set(selected_ids) <= set(ids) or not selected_ids:
        raise RuntimeError("unknown or empty group selection")
    selected = [g for g in groups if g["id"] in selected_ids]
    profile = args.profile if not args.group else "groups:" + ",".join(g["id"] for g in selected)
    tree = source_tree(root, args.mode, args.tip)
    force = args.force or bool(os.environ.get("CI"))
    cursor = state.get("cursor") or state["cursors"].get(profile, selected[0]["id"])
    if force or cursor not in selected_ids:
        cursor = selected[0]["id"]
    offset = next(i for i, g in enumerate(selected) if g["id"] == cursor)
    ordered = selected[offset:] + selected[:offset]
    if force:
        for group in selected:
            state["groups"].pop(group["id"], None)
        state["rounds"].pop(profile, None)
        atomic_write(state_path, state)
    log("tree=" + tree + " profile=" + profile + " cursor=" + cursor + (" FORCE full rerun" if force else ""))
    extra_env = {"LOCAL_GATE_ACTIVE": "1", "LOCAL_GATE_TREE": tree, "LOCAL_GATE_BASE": args.base or "", "LOCAL_GATE_TIP": args.tip or ""}
    for group in ordered:
        name = group["id"]
        if source_tree(root, args.mode, args.tip) != tree:
            raise RuntimeError("source changed during validation; the round cannot pass")
        current = components(root, group, manifest, tree, args, {})
        previous = state["groups"].get(name, {})
        if not force and previous.get("status") == "passed" and previous.get("inputs") == current:
            log("SKIP " + name + ": matching passed tree, test inputs and environment; cursor=" + cursor)
            continue
        reasons = [k for k in current if previous.get("inputs", {}).get(k) != current[k]]
        if previous.get("status") in ("running", "interrupted"):
            reasons.append("interrupted attempt")
        elif previous.get("status") == "failed":
            reasons.append("failed attempt")
        log("INVALIDATE " + name + ": " + (", ".join(reasons) or "no passed result"))
        state["cursors"][profile] = name
        state["cursor"] = name
        state["rounds"].pop(profile, None)
        state["groups"][name] = {"status": "running", "inputs": current, "started_at": time.time()}
        atomic_write(state_path, state)
        started = time.monotonic()
        result = 1
        after = current
        interrupted = False
        try:
            if group.get("prepare"):
                log("PREPARE " + name)
                result = execute(root, group["prepare"], extra_env)
                if result:
                    raise RuntimeError("group initialization failed")
                if source_tree(root, args.mode, args.tip) != tree:
                    raise RuntimeError("initialization changed the tested source")
                current = components(root, group, manifest, tree, args, {})
                state["groups"][name]["inputs"] = current
                atomic_write(state_path, state)
            log("EXECUTE " + name + "; cursor=" + name)
            result = execute(root, group["command"], extra_env)
            if source_tree(root, args.mode, args.tip) != tree:
                log("FAIL " + name + ": tested source changed")
                result = 1
            after = components(root, group, manifest, tree, args, {})
            if after != current:
                log("FAIL " + name + ": environment changed while testing")
                result = 1
        except Interrupted:
            interrupted = True
            log("INTERRUPTED " + name + "; resume cursor=" + name)
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
            result = 1
            log("FAIL " + name + ": " + str(error))
        finally:
            record = state["groups"][name]
            record["status"] = "interrupted" if interrupted else "passed" if result == 0 else "failed"
            record["duration_seconds"] = round(time.monotonic() - started, 3)
            if result == 0 and not interrupted:
                record["inputs"] = after
            atomic_write(state_path, state)
        if interrupted:
            return 130
        if result:
            log("FAIL " + name + "; resume cursor=" + name)
            return result if 0 < result < 126 else 1
        log("PASS " + name)
    keys = {}
    for group in selected:
        expected = components(root, group, manifest, tree, args, {})
        record = state["groups"].get(group["id"], {})
        if record.get("status") != "passed" or record.get("inputs") != expected:
            state["cursors"][profile] = group["id"]
            state["cursor"] = group["id"]
            atomic_write(state_path, state)
            log("INCOMPLETE: " + group["id"] + " invalidated before round completion; resume cursor=" + group["id"])
            return 1
        keys[group["id"]] = digest(expected)
    if source_tree(root, args.mode, args.tip) != tree:
        raise RuntimeError("source changed before round completion")
    state["rounds"][profile] = {"tree": tree, "groups": keys, "completed_at": time.time()}
    state["cursors"][profile] = selected[0]["id"]
    if state.get("cursor") in selected_ids:
        state.pop("cursor", None)
    atomic_write(state_path, state)
    log("COMPLETE profile=" + profile + " tree=" + tree + " groups=" + str(len(selected)))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Local tree-based validation with resumable groups; CI remains independent.")
    parser.add_argument("action", nargs="?", choices=("run", "associate"), default="run")
    parser.add_argument("--manifest", default="scripts/local_gate_groups.json")
    parser.add_argument("--profile", default="full")
    parser.add_argument("--group", action="append")
    parser.add_argument("--mode", choices=("worktree", "staged", "committed"), default="worktree")
    parser.add_argument("--base")
    parser.add_argument("--tip")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel"))
    common = Path(git(root, "rev-parse", "--git-common-dir"))
    common = common if common.is_absolute() else root / common
    directory = common.resolve() / "local-gate"
    state_path = directory / "state.json"
    def stop(_signal, _frame):
        raise Interrupted()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, stop)
    try:
        with locked(directory / "lock"):
            state = load_state(state_path)
            if args.action == "associate":
                commit = git(root, "rev-parse", "HEAD")
                tree = git(root, "rev-parse", "HEAD^{tree}")
                passed = [name for name, value in state["groups"].items() if value.get("status") == "passed" and value.get("inputs", {}).get("source") == tree]
                state["commits"][commit] = {"tree": tree, "passed_groups": passed}
                state["commits"] = dict(list(state["commits"].items())[-128:])
                atomic_write(state_path, state)
                log("ASSOCIATE commit=" + commit + " tree=" + tree + " passed_groups=" + str(len(passed)))
                return 0
            manifest = json.loads((root / args.manifest).read_text())
            return run(root, manifest, state, state_path, args)
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        log("ERROR " + str(error))
        return 1
    except Interrupted:
        log("INTERRUPTED before a group could complete; no pass recorded")
        return 130


if __name__ == "__main__":
    sys.exit(main())
