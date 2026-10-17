#!/usr/bin/env python3
"""Read exact process identities for Desktop qualification; never signal processes."""
import ctypes
import json
import os
import subprocess
import sys
import socket
import re


def snapshot(selected_pid=None):
    if sys.platform == 'win32':
        command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
        records = json.loads(subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], text=True))
        if isinstance(records, dict):
            records = [records]
        return [dict(pid=row['ProcessId'], parent=row['ParentProcessId'], birth=str(row['CreationDate']), executable=row['ExecutablePath'], command=row['CommandLine'], group=None) for row in records if row['ExecutablePath'] and row['CreationDate']]
    lib = None
    if sys.platform == 'darwin':
        class BSDInfo(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint32) for name in ['flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid', 'rgid', 'svuid', 'svgid', 'rfu']] + [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)] + [(name, ctypes.c_uint32) for name in ['nfiles', 'pgid', 'pjobc', 'tdev', 'tpgid', 'nice']] + [('start_sec', ctypes.c_uint64), ('start_usec', ctypes.c_uint64)]
        lib = ctypes.CDLL('/usr/lib/libproc.dylib')
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,command='], text=True).splitlines()
    result = []
    for line in rows:
        fields = line.split(None, 4)
        if len(fields) != 5 or fields[3].startswith('Z'):
            continue
        pid, parent, group = map(int, fields[:3])
        if selected_pid is not None and pid != selected_pid:
            continue
        try:
            if lib:
                info, executable = BSDInfo(), ctypes.create_string_buffer(4096)
                if lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info):
                    continue
                if lib.proc_pidpath(pid, executable, len(executable)) <= 0:
                    continue
                birth = f'{info.start_sec}:{info.start_usec}'
                filename = executable.value.decode()
            else:
                with open(f'/proc/{pid}/stat', encoding='utf8') as handle:
                    birth = handle.read().rsplit(')', 1)[1].split()[19]
                filename = os.readlink(f'/proc/{pid}/exe')
            metadata = os.stat(filename)
            result.append(dict(pid=pid, parent=parent, group=group, birth=birth, executable=filename, device=metadata.st_dev, inode=metadata.st_ino, command=fields[4]))
        except (OSError, ValueError):
            continue
    return result


def listening_ports(pids):
    if sys.platform == 'win32':
        command = 'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess,LocalAddress,LocalPort | ConvertTo-Json -Compress'
        body = subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], text=True).strip()
        records = json.loads(body) if body else []
        if isinstance(records, dict):
            records = [records]
        return [dict(pid=row['OwningProcess'], host=row['LocalAddress'], port=row['LocalPort']) for row in records if row['OwningProcess'] in pids]
    if sys.platform == 'darwin':
        result = subprocess.run(['lsof', '-nP', '-a', '-p', ','.join(map(str, pids)), '-iTCP', '-sTCP:LISTEN', '-Fpn'], capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr)
        ports, pid = [], None
        for line in result.stdout.splitlines():
            if line.startswith('p'):
                pid = int(line[1:])
            elif line.startswith('n') and pid in pids:
                host, port = line[1:].rsplit(':', 1)
                ports.append(dict(pid=pid, host=host.strip('[]').replace('*', '127.0.0.1'), port=int(port)))
        return ports
    owners = {}
    for pid in pids:
        try:
            for fd in os.listdir(f'/proc/{pid}/fd'):
                try:
                    match = re.fullmatch(r'socket:\[(\d+)\]', os.readlink(f'/proc/{pid}/fd/{fd}'))
                    if match:
                        owners[match[1]] = pid
                except OSError:
                    continue
        except FileNotFoundError:
            continue
    ports = []
    for table, family in [('tcp', socket.AF_INET), ('tcp6', socket.AF_INET6)]:
        with open('/proc/net/' + table, encoding='ascii') as handle:
            for line in handle.readlines()[1:]:
                fields = line.split()
                if fields[3] != '0A' or fields[9] not in owners:
                    continue
                address, port = fields[1].split(':')
                raw = bytes.fromhex(address)
                raw = b''.join(raw[i:i+4][::-1] for i in range(0, len(raw), 4))
                ports.append(dict(pid=owners[fields[9]], host=socket.inet_ntop(family, raw), port=int(port, 16)))
    return ports


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == '--ports':
    print(json.dumps(listening_ports(list(map(int, sys.argv[2:])))))
elif __name__ == '__main__':
    records = snapshot(int(sys.argv[1]) if len(sys.argv) > 1 else None)
    print(json.dumps(records if len(sys.argv) == 1 else next((row for row in records if row['pid'] == int(sys.argv[1])), None)))
