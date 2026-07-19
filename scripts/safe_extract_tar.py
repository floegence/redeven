#!/usr/bin/env python3
"""Inspect and extract a gzip tar archive without trusting archive metadata."""

from __future__ import annotations

import argparse
import ctypes
import errno
import gzip
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import tempfile


DEFAULT_MAX_FILES = 4096
DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
COPY_BUFFER_BYTES = 1024 * 1024
MAX_TAR_METADATA_BYTES = 64 * 1024 * 1024


class ArchiveValidationError(ValueError):
    pass


class BoundedReader:
    def __init__(self, source: gzip.GzipFile, limit: int) -> None:
        self.source = source
        self.remaining = limit

    def read(self, size: int = -1) -> bytes:
        if self.remaining < 0:
            raise ArchiveValidationError("archive tar stream exceeds its byte limit")
        request = self.remaining + 1 if size < 0 else min(size, self.remaining + 1)
        data = self.source.read(request)
        self.remaining -= len(data)
        if self.remaining < 0:
            raise ArchiveValidationError("archive tar stream exceeds its byte limit")
        return data


def normalized_member_path(name: str, *, directory: bool = False) -> PurePosixPath:
    if name.startswith("./"):
        name = name[2:]
    if directory and name.endswith("/"):
        name = name[:-1]
    if not name or "\\" in name or "\x00" in name:
        raise ArchiveValidationError(f"unsafe archive path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ArchiveValidationError(f"unsafe archive path: {name!r}")
    if path.as_posix() != name:
        raise ArchiveValidationError(f"archive path is not canonical: {name!r}")
    return path


def extract_validated_members(
    archive: tarfile.TarFile,
    destination: Path,
    *,
    expected_root: str | None,
    allowed_files: frozenset[str],
    max_files: int,
    max_total_bytes: int,
) -> None:
    inspected_count = 0
    seen: set[str] = set()
    regular_files: set[str] = set()
    directories: set[str] = set()
    total_bytes = 0
    while True:
        member = archive.next()
        if member is None:
            break
        if inspected_count >= max_files:
            raise ArchiveValidationError(
                f"archive contains more than {max_files} entries"
            )
        path = normalized_member_path(member.name, directory=member.isdir())
        canonical = path.as_posix()
        if canonical in seen:
            raise ArchiveValidationError(f"duplicate archive path: {canonical}")
        seen.add(canonical)

        if expected_root is not None and path.parts[0] != expected_root:
            raise ArchiveValidationError(
                f"archive entry {canonical!r} is outside root {expected_root!r}"
            )
        if member.pax_headers:
            raise ArchiveValidationError(
                f"archive entry must not use PAX metadata: {canonical}"
            )
        if member.mode & 0o7000:
            raise ArchiveValidationError(
                f"archive entry has privileged mode bits: {canonical}"
            )
        strict_regular = (
            member.type in {tarfile.REGTYPE, tarfile.AREGTYPE}
            and not member.sparse
        )
        if not member.isdir() and not strict_regular:
            raise ArchiveValidationError(
                f"archive entry must be a regular file or directory: {canonical}"
            )
        if strict_regular:
            if member.size < 0:
                raise ArchiveValidationError(f"archive entry has a negative size: {canonical}")
            total_bytes += member.size
            if total_bytes > max_total_bytes:
                raise ArchiveValidationError(
                    f"archive expands beyond {max_total_bytes} bytes"
                )
            regular_files.add(canonical)
            extract_regular_member(archive, member, path, destination)
        else:
            directories.add(canonical)
            output = safe_output_path(destination, path)
            output.mkdir(mode=0o755, parents=True, exist_ok=True)
            if output.is_symlink() or not output.is_dir():
                raise ArchiveValidationError(f"unsafe extraction directory: {path}")
        inspected_count += 1

    if inspected_count == 0:
        raise ArchiveValidationError("archive is empty")
    for regular_file in regular_files:
        parts = PurePosixPath(regular_file).parts
        for index in range(1, len(parts)):
            prefix = "/".join(parts[:index])
            if prefix in regular_files:
                raise ArchiveValidationError(
                    f"archive file is also used as a directory: {prefix}"
                )
    if expected_root is not None:
        roots = {PurePosixPath(path).parts[0] for path in seen}
        if roots != {expected_root}:
            raise ArchiveValidationError(
                f"archive root must be exactly {expected_root!r}"
            )
    if allowed_files and regular_files != allowed_files:
        missing = sorted(allowed_files - regular_files)
        unexpected = sorted(regular_files - allowed_files)
        raise ArchiveValidationError(
            f"archive file inventory mismatch; missing={missing!r} unexpected={unexpected!r}"
        )
    if allowed_files:
        allowed_directories = {
            "/".join(parts[:index])
            for allowed in allowed_files
            for parts in [PurePosixPath(allowed).parts]
            for index in range(1, len(parts))
        }
        unexpected_directories = sorted(directories - allowed_directories)
        if unexpected_directories:
            raise ArchiveValidationError(
                f"archive contains unexpected directories: {unexpected_directories!r}"
            )
    return None


def safe_output_path(destination: Path, relative: PurePosixPath) -> Path:
    output = destination.joinpath(*relative.parts)
    if destination not in output.parents:
        raise ArchiveValidationError(f"archive path escapes destination: {relative}")
    return output


def extract_regular_member(
    archive: tarfile.TarFile,
    member: tarfile.TarInfo,
    path: PurePosixPath,
    destination: Path,
) -> None:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    output = safe_output_path(destination, path)
    output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    if output.parent.is_symlink():
        raise ArchiveValidationError(f"unsafe extraction parent: {path.parent}")
    source = archive.extractfile(member)
    if source is None:
        raise ArchiveValidationError(f"cannot read archive entry: {path}")
    mode = member.mode & 0o777
    descriptor = os.open(
        output,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow,
        mode or 0o600,
    )
    written = 0
    try:
        with source, os.fdopen(descriptor, "wb", closefd=True) as target:
            while True:
                chunk = source.read(COPY_BUFFER_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > member.size:
                    raise ArchiveValidationError(
                        f"archive entry exceeds declared size: {path}"
                    )
                target.write(chunk)
            target.flush()
        if written != member.size:
            raise ArchiveValidationError(
                f"archive entry size mismatch for {path}: got {written}, want {member.size}"
            )
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def atomic_directory_rename(source: Path, destination: Path, *, replace: bool) -> None:
    source = Path(os.path.abspath(source))
    destination_absolute = Path(os.path.abspath(destination))
    destination_parent = destination_absolute.parent.resolve(strict=True)
    destination = destination_parent / destination_absolute.name
    if source.is_symlink() or not source.is_dir():
        raise ArchiveValidationError(f"publish source must be a real directory: {source}")

    libc = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    result = -1
    destination_exists = os.path.lexists(destination)
    if replace and destination_exists:
        if destination.is_symlink() or not destination.is_dir():
            raise ArchiveValidationError(
                f"replace destination must be a real directory: {destination}"
            )
        flag = 0x00000002
    elif replace:
        flag = 0x00000004 if sys.platform == "darwin" else 0x00000001
    else:
        flag = 0x00000004 if sys.platform == "darwin" else 0x00000001

    if sys.platform == "darwin" and hasattr(libc, "renamex_np"):
        renamex_np = libc.renamex_np
        renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        renamex_np.restype = ctypes.c_int
        result = renamex_np(source_bytes, destination_bytes, flag)
    elif sys.platform.startswith("linux") and hasattr(libc, "renameat2"):
        renameat2 = libc.renameat2
        renameat2.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        renameat2.restype = ctypes.c_int
        linux_flag = 0x00000002 if replace and destination_exists else 0x00000001
        result = renameat2(-100, source_bytes, -100, destination_bytes, linux_flag)
    else:
        raise ArchiveValidationError(
            "atomic no-replace directory publication is unavailable on this platform"
        )
    if result != 0:
        error_number = ctypes.get_errno()
        if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
            raise ArchiveValidationError(f"destination already exists: {destination}")
        raise OSError(error_number, os.strerror(error_number), destination)
    if replace and destination_exists:
        shutil.rmtree(source)


def atomic_publish_directory(source: Path, destination: Path) -> None:
    atomic_directory_rename(source, destination, replace=False)


def atomic_replace_directory(source: Path, destination: Path) -> None:
    atomic_directory_rename(source, destination, replace=True)


def atomic_replace_file(source: Path, destination: Path) -> None:
    source = Path(os.path.abspath(source))
    destination_absolute = Path(os.path.abspath(destination))
    destination_parent = destination_absolute.parent.resolve(strict=True)
    destination = destination_parent / destination_absolute.name
    if source.is_symlink() or not source.is_file():
        raise ArchiveValidationError(f"publish source must be a regular file: {source}")
    if destination.is_symlink() or destination.is_dir():
        raise ArchiveValidationError(
            f"publish destination must be a regular file path: {destination}"
        )
    os.replace(source, destination)


def snapshot_regular_file(source: Path, destination: Path, *, max_bytes: int) -> None:
    source = Path(os.path.abspath(source))
    destination_absolute = Path(os.path.abspath(destination))
    destination_parent = destination_absolute.parent.resolve(strict=True)
    destination = destination_parent / destination_absolute.name
    if os.path.lexists(destination):
        raise ArchiveValidationError(f"snapshot destination already exists: {destination}")

    nofollow = getattr(os, "O_NOFOLLOW", 0)
    source_descriptor = os.open(source, os.O_RDONLY | nofollow)
    temporary_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.snapshot-",
        dir=destination_parent,
    )
    temporary = Path(temporary_name)
    try:
        before = os.fstat(source_descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ArchiveValidationError(f"snapshot source must be a single-link regular file: {source}")
        if before.st_size <= 0 or before.st_size > max_bytes:
            raise ArchiveValidationError(f"snapshot source is outside the {max_bytes} byte limit")
        copied = 0
        while True:
            chunk = os.read(source_descriptor, COPY_BUFFER_BYTES)
            if not chunk:
                break
            copied += len(chunk)
            if copied > max_bytes:
                raise ArchiveValidationError(f"snapshot source exceeds the {max_bytes} byte limit")
            view = memoryview(chunk)
            while view:
                written = os.write(temporary_descriptor, view)
                view = view[written:]
        os.fsync(temporary_descriptor)
        after = os.fstat(source_descriptor)
        current = os.stat(source, follow_symlinks=False)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_nlink)
        identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink)
        path_identity = (current.st_dev, current.st_ino)
        if identity_after != identity_before or path_identity != identity_before[:2] or copied != before.st_size:
            raise ArchiveValidationError("snapshot source changed while it was copied")
        os.close(temporary_descriptor)
        temporary_descriptor = -1
        os.chmod(temporary, 0o600)
        os.link(temporary, destination, follow_symlinks=False)
        temporary.unlink()
        fsync_directory(destination_parent)
    finally:
        os.close(source_descriptor)
        if temporary_descriptor >= 0:
            os.close(temporary_descriptor)
        temporary.unlink(missing_ok=True)


def fsync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        try:
            os.fsync(descriptor)
        except OSError as error:
            if error.errno not in {errno.EINVAL, errno.ENOTSUP, errno.EPERM}:
                raise
    finally:
        os.close(descriptor)


def safe_extract(
    archive_path: Path,
    destination: Path,
    *,
    expected_root: str | None,
    allowed_files: frozenset[str],
    max_files: int,
    max_total_bytes: int,
    expected_sha256: str | None,
    expected_size: int | None,
) -> None:
    archive_input = Path(os.path.abspath(archive_path))
    if expected_root is not None:
        normalized_root = normalized_member_path(expected_root).as_posix()
        if "/" in normalized_root:
            raise ArchiveValidationError("expected root must be a single path segment")
        expected_root = normalized_root
    for allowed in allowed_files:
        normalized = normalized_member_path(allowed).as_posix()
        if normalized != allowed:
            raise ArchiveValidationError(f"allowed path is not canonical: {allowed!r}")

    destination_absolute = Path(os.path.abspath(destination))
    destination_parent = destination_absolute.parent.resolve(strict=True)
    final_destination = destination_parent / destination_absolute.name
    if os.path.lexists(final_destination):
        raise ArchiveValidationError(
            f"destination must not already exist: {final_destination}"
        )

    nofollow = getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(archive_input, os.O_RDONLY | nofollow)
    staging = Path(
        tempfile.mkdtemp(
            prefix=f".{final_destination.name}.extract-",
            dir=destination_parent,
        )
    )
    try:
        archive_stat = os.fstat(descriptor)
        if not stat.S_ISREG(archive_stat.st_mode):
            raise ArchiveValidationError(f"archive must be a regular file: {archive_input}")
        if archive_stat.st_size > max_total_bytes:
            raise ArchiveValidationError(
                f"compressed archive exceeds {max_total_bytes} bytes"
            )
        if expected_size is not None and archive_stat.st_size != expected_size:
            raise ArchiveValidationError(
                f"archive size mismatch: got {archive_stat.st_size}, want {expected_size}"
            )
        if expected_sha256 is not None:
            digest = hashlib.sha256()
            while True:
                chunk = os.read(descriptor, COPY_BUFFER_BYTES)
                if not chunk:
                    break
                digest.update(chunk)
            if digest.hexdigest() != expected_sha256:
                raise ArchiveValidationError("archive checksum does not match the expected SHA-256")
            os.lseek(descriptor, 0, os.SEEK_SET)
        with os.fdopen(descriptor, "rb", closefd=True) as archive_file:
            descriptor = -1
            with gzip.GzipFile(fileobj=archive_file, mode="rb") as gzip_stream:
                bounded_stream = BoundedReader(
                    gzip_stream,
                    max_total_bytes + MAX_TAR_METADATA_BYTES,
                )
                with tarfile.open(fileobj=bounded_stream, mode="r|") as archive:
                    extract_validated_members(
                        archive,
                        staging,
                        expected_root=expected_root,
                        allowed_files=allowed_files,
                        max_files=max_files,
                        max_total_bytes=max_total_bytes,
                    )
        atomic_publish_directory(staging, final_destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def create_fixture(path: Path, entries: list[tuple[str, bytes]], *, link_type: bytes | None = None) -> None:
    with tarfile.open(path, mode="w:gz") as archive:
        for name, content in entries:
            info = tarfile.TarInfo(name)
            if link_type is not None:
                info.type = link_type
                info.linkname = "/tmp/forbidden" if link_type == tarfile.SYMTYPE else "bundle/bin/runtime"
                archive.addfile(info)
                continue
            info.size = len(content)
            archive.addfile(info, fileobj=io.BytesIO(content))


def run_self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="redeven-safe-tar-") as root_value:
        root = Path(root_value)
        valid = root / "valid.tar.gz"
        create_fixture(valid, [("bundle/bin/runtime", b"runtime")])
        safe_extract(
            valid,
            root / "valid-output",
            expected_root="bundle",
            allowed_files=frozenset({"bundle/bin/runtime"}),
            max_files=8,
            max_total_bytes=2048,
            expected_sha256=None,
            expected_size=None,
        )
        if (root / "valid-output/bundle/bin/runtime").read_bytes() != b"runtime":
            raise AssertionError("valid archive extraction mismatch")

        publish_source = root / "publish-source"
        publish_destination = root / "publish-destination"
        publish_source.mkdir()
        publish_destination.mkdir()
        try:
            atomic_publish_directory(publish_source, publish_destination)
        except ArchiveValidationError:
            pass
        else:
            raise AssertionError("atomic publication replaced an existing destination")
        if not publish_source.is_dir() or not publish_destination.is_dir():
            raise AssertionError("failed atomic publication changed source or destination")

        replace_source = root / "replace-source"
        replace_destination = root / "replace-destination"
        replace_source.mkdir()
        replace_destination.mkdir()
        (replace_source / "value").write_text("new", encoding="utf-8")
        (replace_destination / "value").write_text("old", encoding="utf-8")
        atomic_replace_directory(replace_source, replace_destination)
        if (replace_destination / "value").read_text(encoding="utf-8") != "new":
            raise AssertionError("atomic directory replacement did not publish new content")
        if replace_source.exists():
            raise AssertionError("atomic directory replacement did not clean the old content")

        replace_file_source = root / "replace-file-source"
        replace_file_destination = root / "replace-file-destination"
        replace_file_source.write_text("new", encoding="utf-8")
        replace_file_destination.write_text("old", encoding="utf-8")
        atomic_replace_file(replace_file_source, replace_file_destination)
        if replace_file_destination.read_text(encoding="utf-8") != "new":
            raise AssertionError("atomic file replacement did not publish new content")

        snapshot_source = root / "snapshot-source"
        snapshot_destination = root / "snapshot-destination"
        snapshot_source.write_text("snapshot", encoding="utf-8")
        snapshot_regular_file(snapshot_source, snapshot_destination, max_bytes=1024)
        if snapshot_destination.read_text(encoding="utf-8") != "snapshot":
            raise AssertionError("regular-file snapshot content mismatch")

        invalid_cases = [
            ("traversal", [("../escape", b"x")], None),
            ("absolute", [("/escape", b"x")], None),
            ("symlink", [("bundle/link", b"")], tarfile.SYMTYPE),
            ("hardlink", [("bundle/link", b"")], tarfile.LNKTYPE),
            ("inventory", [("bundle/unexpected", b"x")], None),
            ("size", [("bundle/bin/runtime", b"x" * 2049)], None),
        ]
        for name, entries, link_type in invalid_cases:
            archive = root / f"{name}.tar.gz"
            create_fixture(archive, entries, link_type=link_type)
            try:
                safe_extract(
                    archive,
                    root / f"{name}-output",
                    expected_root="bundle",
                    allowed_files=frozenset({"bundle/bin/runtime"}),
                    max_files=8,
                    max_total_bytes=2048,
                    expected_sha256=None,
                    expected_size=None,
                )
            except ArchiveValidationError:
                continue
            raise AssertionError(f"unsafe {name} archive was accepted")
    print("safe tar extraction self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--dest", type=Path)
    parser.add_argument("--expected-root")
    parser.add_argument("--allow-file", action="append", default=[])
    parser.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    parser.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--expected-size", type=int)
    parser.add_argument("--publish-dir", type=Path)
    parser.add_argument("--replace-dir", type=Path)
    parser.add_argument("--replace-file", type=Path)
    parser.add_argument("--snapshot-file", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        if args.archive is not None or args.dest is not None or args.expected_root or args.allow_file or args.publish_dir or args.replace_dir or args.replace_file or args.snapshot_file:
            parser.error("--self-test cannot be combined with extraction arguments")
        return args
    publication_modes = [args.publish_dir, args.replace_dir, args.replace_file, args.snapshot_file]
    if any(value is not None for value in publication_modes):
        if sum(value is not None for value in publication_modes) != 1:
            parser.error("publication modes are mutually exclusive")
        if args.dest is None or args.archive is not None or args.expected_root or args.allow_file or args.expected_sha256 or args.expected_size is not None:
            parser.error("directory publication requires only --dest")
        return args
    if args.archive is None or args.dest is None:
        parser.error("--archive and --dest are required")
    if args.max_files <= 0 or args.max_total_bytes <= 0:
        parser.error("archive limits must be positive")
    if (args.expected_sha256 is None) != (args.expected_size is None):
        parser.error("--expected-sha256 and --expected-size must be provided together")
    if args.expected_sha256 is not None and (
        len(args.expected_sha256) != 64
        or not all(character in "0123456789abcdef" for character in args.expected_sha256)
    ):
        parser.error("--expected-sha256 must be lowercase SHA-256 hex")
    if args.expected_size is not None and args.expected_size <= 0:
        parser.error("--expected-size must be positive")
    return args


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    try:
        if args.publish_dir is not None:
            atomic_publish_directory(args.publish_dir, args.dest)
            return
        if args.replace_dir is not None:
            atomic_replace_directory(args.replace_dir, args.dest)
            return
        if args.replace_file is not None:
            atomic_replace_file(args.replace_file, args.dest)
            return
        if args.snapshot_file is not None:
            snapshot_regular_file(args.snapshot_file, args.dest, max_bytes=args.max_total_bytes)
            return
        safe_extract(
            args.archive,
            args.dest,
            expected_root=args.expected_root,
            allowed_files=frozenset(args.allow_file),
            max_files=args.max_files,
            max_total_bytes=args.max_total_bytes,
            expected_sha256=args.expected_sha256,
            expected_size=args.expected_size,
        )
    except (ArchiveValidationError, OSError, tarfile.TarError) as error:
        raise SystemExit(f"[safe-tar] {error}") from error


if __name__ == "__main__":
    main()
