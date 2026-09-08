package managedwebservice

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func readManagedProcess(pid int) (managedProcessSnapshot, error) {
	if pid <= 0 {
		return managedProcessSnapshot{}, os.ErrNotExist
	}
	root := fmt.Sprintf("/proc/%d", pid)
	raw, err := os.ReadFile(root + "/stat")
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	end := strings.LastIndex(string(raw), ")")
	begin := strings.IndexByte(string(raw), '(')
	if begin < 0 || end <= begin {
		return managedProcessSnapshot{}, errors.New("managed process stat is invalid")
	}
	fields := strings.Fields(string(raw[end+1:]))
	if len(fields) <= 19 {
		return managedProcessSnapshot{}, errors.New("managed process stat is incomplete")
	}
	if fields[0] == "Z" || fields[0] == "X" {
		return managedProcessSnapshot{}, os.ErrNotExist
	}
	group, err := strconv.Atoi(fields[2])
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return managedProcessSnapshot{}, errors.New("managed process user is unavailable")
	}
	namespace, err := os.Readlink(root + "/ns/pid")
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	userNamespace, err := os.Readlink(root + "/ns/user")
	if err != nil {
		return managedProcessSnapshot{}, err
	}
	if strings.TrimSpace(string(boot)) == "" {
		return managedProcessSnapshot{}, errors.New("system boot identity is empty")
	}
	return managedProcessSnapshot{PID: pid, Group: group, BootID: strings.TrimSpace(string(boot)), Birth: fields[19], User: strconv.FormatUint(uint64(stat.Uid), 10), Namespace: namespace + "/" + userNamespace, Command: string(raw[begin+1 : end])}, nil
}
