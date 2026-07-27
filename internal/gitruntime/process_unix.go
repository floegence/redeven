//go:build linux || darwin

package gitruntime

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func prepareProcessGroup(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return nil
}

func signalProcessGroup(pid int, signal syscall.Signal) error {
	if pid <= 0 {
		return errors.New("invalid process group")
	}
	err := syscall.Kill(-pid, signal)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func processGroupAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(-pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func reapProcessExit(process *os.Process) (bool, int, error) {
	if process == nil || process.Pid <= 0 {
		return true, -1, errors.New("invalid process")
	}
	var status syscall.WaitStatus
	pid, err := syscall.Wait4(process.Pid, &status, syscall.WNOHANG, nil)
	if err != nil {
		return true, -1, err
	}
	if pid == 0 {
		return false, -1, nil
	}
	_ = process.Release()
	switch {
	case status.Exited():
		return true, status.ExitStatus(), nil
	case status.Signaled():
		return true, 128 + int(status.Signal()), nil
	default:
		return true, -1, errors.New("process exited without a terminal status")
	}
}
