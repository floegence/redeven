package managedwebservice

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func readManagedProcess(pid int) (managedProcessSnapshot, error) {
	if pid <= 0 {
		return managedProcessSnapshot{}, os.ErrNotExist
	}
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		if !managedProcessAlive(pid) {
			return managedProcessSnapshot{}, os.ErrNotExist
		}
		return managedProcessSnapshot{}, err
	}
	if info.Proc.P_pid != int32(pid) || info.Proc.P_stat == 5 {
		return managedProcessSnapshot{}, os.ErrNotExist
	}
	boot, err := unix.Sysctl("kern.bootsessionuuid")
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	if strings.TrimSpace(boot) == "" {
		return managedProcessSnapshot{}, fmt.Errorf("system boot-session identity is empty")
	}
	return managedProcessSnapshot{
		PID: pid, Group: int(info.Eproc.Pgid), BootID: strings.TrimSpace(boot),
		Birth:   fmt.Sprintf("%d.%06d", info.Proc.P_starttime.Sec, info.Proc.P_starttime.Usec),
		User:    strconv.FormatUint(uint64(info.Eproc.Ucred.Uid), 10),
		Command: unix.ByteSliceToString(info.Proc.P_comm[:]),
	}, nil
}
