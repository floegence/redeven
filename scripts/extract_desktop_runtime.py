#!/usr/bin/env python3
"""Validate a native Linux package payload and extract only Redeven runtime files."""

from __future__ import annotations

import argparse
import io
import os
from pathlib import Path
import shutil
import stat
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True

from safe_extract_tar import (
    ArchiveValidationError,
    COPY_BUFFER_BYTES,
    atomic_publish_directory,
    normalized_member_path,
)


MAX_ENTRIES = 100_000
MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
MAX_NAME_BYTES = 16 * 1024
MAX_TRAILING_PADDING_BYTES = 1024 * 1024
TAR_BLOCK_BYTES = 512
RUNTIME_BASENAMES = (
    "redeven",
    "redeven-gateway",
    "redevplugin-runtime",
    ".redevplugin-release-artifacts-verified.json",
    "REDEVPLUGIN_THIRD_PARTY_NOTICES.md",
    "REDEVPLUGIN_RUNTIME.spdx.json",
    "redevplugin-runtime.provenance.json",
    "redevplugin-runtime.sig",
    "redevplugin-runtime.pem",
)
RUNTIME_ROOT = "opt/Redeven Desktop/resources/bin"
ELECTRON_SANDBOX_PATH = "opt/Redeven Desktop/chrome-sandbox"
EXECUTABLE_RUNTIME_BASENAMES = {"redeven", "redeven-gateway", "redevplugin-runtime"}


class RuntimePayloadExtractor:
    def __init__(self, staging: Path) -> None:
        self.staging = staging
        self.required = {f"{RUNTIME_ROOT}/{name}": name for name in RUNTIME_BASENAMES}
        self.entry_kinds: dict[str, str] = {}
        self.extracted: set[str] = set()
        self.entry_count = 0
        self.total_bytes = 0

    def inspect(
        self,
        name: str,
        mode: int,
        size: int,
        nlink: int,
        uid: int,
        gid: int,
    ) -> tuple[str, str | None]:
        if self.entry_count >= MAX_ENTRIES:
            raise ArchiveValidationError(f"package payload contains more than {MAX_ENTRIES} entries")
        canonical = normalized_member_path(name, directory=stat.S_ISDIR(mode)).as_posix()
        if canonical in self.entry_kinds:
            raise ArchiveValidationError(f"duplicate package payload path: {canonical}")
        parts = canonical.split("/")
        for index in range(1, len(parts)):
            ancestor = "/".join(parts[:index])
            if self.entry_kinds.get(ancestor) == "file":
                raise ArchiveValidationError(
                    f"package payload path descends from a regular file: {canonical}"
                )
        if stat.S_ISREG(mode):
            descendant_prefix = f"{canonical}/"
            if any(path.startswith(descendant_prefix) for path in self.entry_kinds):
                raise ArchiveValidationError(
                    f"package payload regular file conflicts with an existing path: {canonical}"
                )
            self.entry_kinds[canonical] = "file"
        else:
            self.entry_kinds[canonical] = "directory"
        self.entry_count += 1
        permissions = stat.S_IMODE(mode)
        privileged = permissions & 0o7000
        sandbox_mode_valid = (
            canonical == ELECTRON_SANDBOX_PATH
            and permissions == 0o4755
            and stat.S_ISREG(mode)
            and uid == 0
            and gid == 0
        )
        if privileged and not sandbox_mode_valid:
            raise ArchiveValidationError(f"package payload contains unexpected privileged mode bits: {canonical}")
        if stat.S_ISREG(mode):
            if nlink != 1:
                raise ArchiveValidationError(f"package payload contains a hard-linked file: {canonical}")
            if size < 0:
                raise ArchiveValidationError(f"package payload contains a negative file size: {canonical}")
            self.total_bytes += size
            if self.total_bytes > MAX_EXPANDED_BYTES:
                raise ArchiveValidationError(
                    f"package payload expands beyond {MAX_EXPANDED_BYTES} bytes"
                )
        elif not stat.S_ISDIR(mode):
            raise ArchiveValidationError(
                f"package payload entry must be a regular file or directory: {canonical}"
            )
        output_name = self.required.get(canonical)
        if output_name is not None and not stat.S_ISREG(mode):
            raise ArchiveValidationError(f"required runtime payload is not a regular file: {canonical}")
        if output_name is not None:
            expected_permissions = 0o755 if output_name in EXECUTABLE_RUNTIME_BASENAMES else 0o644
            if uid != 0 or gid != 0:
                raise ArchiveValidationError(
                    f"required runtime payload must be owned by root:root: {canonical}"
                )
            if permissions != expected_permissions:
                raise ArchiveValidationError(
                    f"required runtime payload has mode {permissions:04o}, want {expected_permissions:04o}: {canonical}"
                )
        return canonical, output_name

    def write_selected(self, output_name: str, source, size: int, mode: int) -> None:
        destination = self.staging / output_name
        descriptor = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            mode & 0o777 or 0o600,
        )
        written = 0
        try:
            with os.fdopen(descriptor, "wb", closefd=True) as target:
                while written < size:
                    chunk = source.read(min(COPY_BUFFER_BYTES, size - written))
                    if not chunk:
                        raise ArchiveValidationError(f"runtime payload is truncated: {output_name}")
                    target.write(chunk)
                    written += len(chunk)
                target.flush()
                os.fchmod(target.fileno(), stat.S_IMODE(mode))
                os.fsync(target.fileno())
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        self.extracted.add(output_name)

    def finish(self) -> None:
        if self.entry_count == 0:
            raise ArchiveValidationError("package payload is empty")
        expected = set(RUNTIME_BASENAMES)
        if self.extracted != expected:
            missing = sorted(expected - self.extracted)
            raise ArchiveValidationError(f"package payload is missing runtime files: {missing!r}")


def extract_tar_payload(source, extractor: RuntimePayloadExtractor) -> None:
    zero_blocks = 0
    while True:
        header = read_exact(source, TAR_BLOCK_BYTES)
        if header == bytes(TAR_BLOCK_BYTES):
            zero_blocks += 1
            if zero_blocks == 2:
                trailing_size = discard_zero_tail(source, MAX_TRAILING_PADDING_BYTES, "tar")
                if trailing_size % TAR_BLOCK_BYTES != 0:
                    raise ArchiveValidationError("tar trailing zero padding is not block-aligned")
                return
            continue
        if zero_blocks:
            raise ArchiveValidationError("package tar has a non-zero header after its end marker")
        validate_tar_header_checksum(header)
        if header[257:263] != b"ustar\0" or header[263:265] != b"00":
            raise ArchiveValidationError("package tar header is not canonical POSIX ustar")
        type_flag = header[156:157]
        if type_flag in {b"\0", b"0"}:
            file_type = stat.S_IFREG
            nlink = 1
        elif type_flag == b"5":
            file_type = stat.S_IFDIR
            nlink = 0
        else:
            raise ArchiveValidationError(
                f"package tar uses unsupported entry type {type_flag!r}"
            )
        name = tar_member_name(header)
        if parse_tar_text(header[157:257], "link name"):
            raise ArchiveValidationError(f"package tar entry has an unexpected link name: {name}")
        permissions = parse_tar_octal(header[100:108], "mode")
        uid = parse_tar_octal(header[108:116], "uid")
        gid = parse_tar_octal(header[116:124], "gid")
        size = parse_tar_octal(header[124:136], "size")
        if file_type == stat.S_IFDIR and size != 0:
            raise ArchiveValidationError(f"package tar directory has a payload: {name}")
        _, output_name = extractor.inspect(
            name,
            file_type | permissions,
            size,
            nlink,
            uid,
            gid,
        )
        member_source = BoundedMemberReader(source, size)
        if output_name is not None:
            extractor.write_selected(output_name, member_source, size, file_type | permissions)
        else:
            discard_exact(member_source, size)
        if member_source.remaining != 0:
            raise ArchiveValidationError(f"tar member was not consumed: {name}")
        discard_exact(source, (-size) % TAR_BLOCK_BYTES)


def validate_tar_header_checksum(header: bytes) -> None:
    expected = parse_tar_octal(header[148:156], "checksum")
    checksum_header = bytearray(header)
    checksum_header[148:156] = b" " * 8
    if sum(checksum_header) != expected:
        raise ArchiveValidationError("package tar header checksum mismatch")


def tar_member_name(header: bytes) -> str:
    name = parse_tar_text(header[0:100], "name")
    prefix = parse_tar_text(header[345:500], "prefix")
    combined = f"{prefix}/{name}" if prefix else name
    if not combined or len(combined.encode("utf-8")) > MAX_NAME_BYTES:
        raise ArchiveValidationError("tar entry name length is outside the closed limit")
    return combined


def parse_tar_text(field: bytes, label: str) -> str:
    value, separator, padding = field.partition(b"\0")
    if separator and any(padding):
        raise ArchiveValidationError(f"package tar {label} has non-zero NUL padding")
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ArchiveValidationError(f"package tar {label} is not UTF-8") from error


def parse_tar_octal(field: bytes, label: str) -> int:
    if field and field[0] & 0x80:
        raise ArchiveValidationError(f"package tar {label} uses base-256 encoding")
    value = field.strip(b"\0 ")
    if not value or any(byte not in b"01234567" for byte in value):
        raise ArchiveValidationError(f"package tar {label} is not canonical octal")
    return int(value, 8)


def extract_cpio_payload(source, extractor: RuntimePayloadExtractor) -> None:
    source = CountingReader(source)
    archive_magic: bytes | None = None
    while True:
        header = read_exact(source, 110)
        magic = header[:6]
        if magic not in {b"070701", b"070702"}:
            raise ArchiveValidationError("RPM payload is not canonical newc CPIO")
        if archive_magic is None:
            archive_magic = magic
        elif magic != archive_magic:
            raise ArchiveValidationError("CPIO payload mixes newc and CRC entry formats")
        if any(byte not in b"0123456789abcdef" for byte in header[6:]):
            raise ArchiveValidationError("CPIO header contains a non-hex field")
        try:
            fields = [int(header[offset:offset + 8], 16) for offset in range(6, 110, 8)]
        except ValueError as error:
            raise ArchiveValidationError("CPIO header contains a non-hex field") from error
        inode = fields[0]
        mode = fields[1]
        uid = fields[2]
        gid = fields[3]
        nlink = fields[4]
        size = fields[6]
        device_fields = fields[7:11]
        name_size = fields[11]
        checksum = fields[12]
        if magic == b"070701" and checksum != 0:
            raise ArchiveValidationError("newc CPIO entry has a non-zero checksum")
        if name_size <= 1 or name_size > MAX_NAME_BYTES:
            raise ArchiveValidationError("CPIO entry name length is outside the closed limit")
        raw_name = read_exact(source, name_size)
        if raw_name[-1:] != b"\0" or b"\0" in raw_name[:-1]:
            raise ArchiveValidationError("CPIO entry name is not canonical NUL-terminated text")
        try:
            name = raw_name[:-1].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ArchiveValidationError("CPIO entry name is not UTF-8") from error
        discard_exact(source, padding_for(110 + name_size))
        if name == "TRAILER!!!":
            if (
                inode != 0
                or mode != 0
                or uid != 0
                or gid != 0
                or nlink != 1
                or size != 0
                or any(device_fields)
                or checksum != 0
            ):
                raise ArchiveValidationError("CPIO trailer fields are not canonical")
            trailer_padding = (-source.count) % TAR_BLOCK_BYTES
            padding = read_exact(source, trailer_padding)
            if any(padding):
                raise ArchiveValidationError("CPIO trailer padding is not zero")
            if source.read(1):
                raise ArchiveValidationError("CPIO payload contains trailing data")
            return
        _, output_name = extractor.inspect(name, mode, size, nlink, uid, gid)
        member_source = CPIOMemberReader(source, size, with_crc=magic == b"070702")
        if output_name is not None:
            extractor.write_selected(output_name, member_source, size, mode)
        else:
            discard_exact(member_source, size)
        if member_source.remaining != 0:
            raise ArchiveValidationError(f"CPIO member was not consumed: {name}")
        if magic == b"070702" and member_source.crc != checksum:
            raise ArchiveValidationError(f"CPIO checksum mismatch: {name}")
        discard_exact(source, padding_for(size))


def read_exact(source, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = source.read(size - len(data))
        if not chunk:
            raise ArchiveValidationError("package payload ended unexpectedly")
        data.extend(chunk)
    return bytes(data)


class BoundedMemberReader:
    def __init__(self, source, size: int) -> None:
        self.source = source
        self.remaining = size

    def read(self, size: int = -1) -> bytes:
        if self.remaining == 0:
            return b""
        requested = self.remaining if size < 0 else min(size, self.remaining)
        chunk = read_exact(self.source, requested)
        self.remaining -= len(chunk)
        return chunk


class CPIOMemberReader(BoundedMemberReader):
    def __init__(self, source, size: int, *, with_crc: bool) -> None:
        super().__init__(source, size)
        self.with_crc = with_crc
        self.crc = 0

    def read(self, size: int = -1) -> bytes:
        chunk = super().read(size)
        if self.with_crc:
            self.crc = (self.crc + sum(chunk)) & 0xFFFFFFFF
        return chunk


class CountingReader:
    def __init__(self, source) -> None:
        self.source = source
        self.count = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self.source.read(size)
        self.count += len(chunk)
        return chunk


def discard_exact(source, size: int) -> None:
    remaining = size
    while remaining:
        chunk = source.read(min(COPY_BUFFER_BYTES, remaining))
        if not chunk:
            raise ArchiveValidationError("package payload padding is truncated")
        remaining -= len(chunk)


def discard_zero_tail(source, limit: int, label: str) -> int:
    consumed = 0
    while True:
        chunk = source.read(min(COPY_BUFFER_BYTES, limit - consumed + 1))
        if not chunk:
            return consumed
        consumed += len(chunk)
        if consumed > limit:
            raise ArchiveValidationError(f"{label} trailing zero padding exceeds the closed limit")
        if any(chunk):
            raise ArchiveValidationError(f"{label} payload contains trailing non-zero data")


def padding_for(size: int) -> int:
    return (-size) % 4


def extract_from_stdin(payload_format: str, destination: Path) -> None:
    destination = Path(os.path.abspath(destination))
    parent = destination.parent.resolve(strict=True)
    destination = parent / destination.name
    if os.path.lexists(destination):
        raise ArchiveValidationError(f"runtime extraction destination already exists: {destination}")
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.extract-", dir=parent))
    try:
        extractor = RuntimePayloadExtractor(staging)
        if payload_format == "tar":
            extract_tar_payload(sys.stdin.buffer, extractor)
        elif payload_format == "cpio":
            extract_cpio_payload(sys.stdin.buffer, extractor)
        else:
            raise ArchiveValidationError(f"unsupported package payload format: {payload_format}")
        extractor.finish()
        atomic_publish_directory(staging, destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def cpio_entry(
    name: str,
    data: bytes,
    mode: int,
    inode: int,
    *,
    uid: int = 0,
    gid: int = 0,
    nlink: int = 1,
    magic: bytes = b"070701",
    checksum: int | None = None,
) -> bytes:
    encoded_name = name.encode("utf-8") + b"\0"
    if checksum is None:
        checksum = sum(data) & 0xFFFFFFFF if magic == b"070702" else 0
    fields = [inode, mode, uid, gid, nlink, 0, len(data), 0, 0, 0, 0, len(encoded_name), checksum]
    header = magic + b"".join(f"{value:08x}".encode("ascii") for value in fields)
    return header + encoded_name + (b"\0" * padding_for(len(header) + len(encoded_name))) + data + (b"\0" * padding_for(len(data)))


def cpio_archive(entries: list[bytes]) -> bytes:
    body = b"".join(entries) + cpio_entry("TRAILER!!!", b"", 0, 0)
    return body + (b"\0" * ((-len(body)) % TAR_BLOCK_BYTES))


def tar_archive(entries: list[dict[str, object]], *, archive_format: int = tarfile.USTAR_FORMAT) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=archive_format) as archive:
        for entry in entries:
            name = str(entry["name"])
            data = bytes(entry.get("data", b""))
            info = tarfile.TarInfo(name)
            info.mode = int(entry.get("mode", 0o644))
            info.uid = int(entry.get("uid", 0))
            info.gid = int(entry.get("gid", 0))
            info.type = bytes(entry.get("type", tarfile.REGTYPE))
            info.linkname = str(entry.get("linkname", ""))
            info.size = len(data) if info.type in {tarfile.REGTYPE, tarfile.AREGTYPE} else 0
            archive.addfile(info, io.BytesIO(data) if info.size else None)
    return output.getvalue()


def run_self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="redeven-desktop-runtime-extract-") as root_value:
        root = Path(root_value)
        entries = [(f"{RUNTIME_ROOT}/{name}", name.encode("utf-8")) for name in RUNTIME_BASENAMES]
        tar_entries = [
            {
                "name": name,
                "data": data,
                "mode": 0o755 if Path(name).name in EXECUTABLE_RUNTIME_BASENAMES else 0o644,
            }
            for name, data in entries
        ]
        cpio_entries = [
            cpio_entry(
                name,
                data,
                stat.S_IFREG | (0o755 if Path(name).name in EXECUTABLE_RUNTIME_BASENAMES else 0o644),
                index + 1,
            )
            for index, (name, data) in enumerate(entries)
        ]

        scenario = 0

        def validate(payload_format: str, payload: bytes) -> None:
            nonlocal scenario
            scenario += 1
            staging = root / f"valid-{scenario}"
            staging.mkdir()
            extractor = RuntimePayloadExtractor(staging)
            if payload_format == "tar":
                extract_tar_payload(io.BytesIO(payload), extractor)
            else:
                extract_cpio_payload(io.BytesIO(payload), extractor)
            extractor.finish()

        def reject(payload_format: str, payload: bytes, label: str) -> None:
            nonlocal scenario
            scenario += 1
            staging = root / f"invalid-{scenario}"
            staging.mkdir()
            extractor = RuntimePayloadExtractor(staging)
            try:
                if payload_format == "tar":
                    extract_tar_payload(io.BytesIO(payload), extractor)
                else:
                    extract_cpio_payload(io.BytesIO(payload), extractor)
                extractor.finish()
            except ArchiveValidationError:
                return
            raise AssertionError(f"desktop package extractor accepted {label}")

        valid_tar = tar_archive(tar_entries)
        valid_cpio = cpio_archive(cpio_entries)
        validate("tar", valid_tar)
        validate("cpio", valid_cpio)

        reject("tar", valid_tar + b"non-zero-tail", "non-zero tar trailing data")
        reject("cpio", valid_cpio + b"non-zero-tail", "non-zero CPIO trailing data")
        reject("cpio", valid_cpio + valid_cpio, "a second CPIO archive")

        invalid_hex = bytearray(valid_cpio)
        invalid_hex[6] = ord("z")
        reject("cpio", bytes(invalid_hex), "a non-hex CPIO field")

        crc_entry = cpio_entry(
            entries[0][0],
            entries[0][1],
            stat.S_IFREG | 0o755,
            1,
            magic=b"070702",
            checksum=1,
        )
        reject("cpio", cpio_archive([crc_entry]), "a CPIO CRC mismatch")

        reject(
            "tar",
            tar_archive(tar_entries + [{"name": "../escape", "data": b"escape"}]),
            "a traversal path",
        )
        reject(
            "tar",
            tar_archive(tar_entries + [dict(tar_entries[0])]),
            "a duplicate path",
        )
        reject(
            "tar",
            tar_archive(
                [{"name": "opt/Redeven Desktop/resources", "data": b"conflict"}] + tar_entries
            ),
            "a regular-file path prefix conflict",
        )
        reject(
            "tar",
            tar_archive(
                tar_entries
                + [{
                    "name": f"{RUNTIME_ROOT}/hardlink",
                    "type": tarfile.LNKTYPE,
                    "linkname": tar_entries[0]["name"],
                }]
            ),
            "a hard link",
        )
        reject(
            "tar",
            tar_archive(
                tar_entries
                + [{"name": f"{RUNTIME_ROOT}/device", "type": tarfile.CHRTYPE}]
            ),
            "a device",
        )
        reject(
            "tar",
            tar_archive(
                tar_entries
                + [{"name": f"{RUNTIME_ROOT}/privileged", "data": b"x", "mode": 0o4755}]
            ),
            "an unexpected privileged file",
        )

        wrong_owner = [dict(entry) for entry in tar_entries]
        wrong_owner[0]["uid"] = 1000
        reject("tar", tar_archive(wrong_owner), "a non-root runtime owner")
        wrong_mode = [dict(entry) for entry in tar_entries]
        wrong_mode[0]["mode"] = 0o700
        reject("tar", tar_archive(wrong_mode), "an unusable runtime mode")

        reject("tar", tar_archive(tar_entries[:-1]), "a missing runtime payload")
        reject(
            "tar",
            tar_archive(
                tar_entries
                + [{"name": "x" * (MAX_NAME_BYTES + 1), "data": b"x"}],
                archive_format=tarfile.GNU_FORMAT,
            ),
            "GNU longname metadata",
        )
        reject(
            "tar",
            tar_archive(
                tar_entries + [{"name": "pax-file", "data": b"x", "uid": 1 << 24}],
                archive_format=tarfile.PAX_FORMAT,
            ),
            "PAX extended metadata",
        )

        cpio_hardlink = cpio_entries + [
            cpio_entry(f"{RUNTIME_ROOT}/hardlink", b"x", stat.S_IFREG | 0o644, 100, nlink=2)
        ]
        reject("cpio", cpio_archive(cpio_hardlink), "a CPIO hard link")
        cpio_device = cpio_entries + [
            cpio_entry(f"{RUNTIME_ROOT}/device", b"", stat.S_IFCHR | 0o600, 101)
        ]
        reject("cpio", cpio_archive(cpio_device), "a CPIO device")
        nonzero_newc_checksum = bytearray(valid_cpio)
        nonzero_newc_checksum[102:110] = b"00000001"
        reject("cpio", bytes(nonzero_newc_checksum), "a non-zero newc checksum")
    print("desktop runtime package extraction self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=("tar", "cpio"))
    parser.add_argument("--dest", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        if args.format is not None or args.dest is not None:
            parser.error("--self-test cannot be combined with extraction arguments")
        return args
    if args.format is None or args.dest is None:
        parser.error("--format and --dest are required")
    return args


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    try:
        extract_from_stdin(args.format, args.dest)
    except (ArchiveValidationError, OSError) as error:
        raise SystemExit(f"[desktop-runtime-extract] {error}") from error


if __name__ == "__main__":
    main()
