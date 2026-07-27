//go:build linux

package gitruntime

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

type processExitObserver struct {
	pid int
}

func newProcessExitObserver(process *os.Process) (*processExitObserver, error) {
	if process == nil || process.Pid <= 0 {
		return nil, errors.New("invalid process")
	}
	return &processExitObserver{pid: process.Pid}, nil
}

func (o *processExitObserver) exited() (bool, error) {
	var info unix.Siginfo
	if err := unix.Waitid(unix.P_PID, o.pid, &info, unix.WEXITED|unix.WNOHANG|unix.WNOWAIT, nil); err != nil {
		return false, err
	}
	return info.Signo != 0, nil
}

func (o *processExitObserver) close() error { return nil }
