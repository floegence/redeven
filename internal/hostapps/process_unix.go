//go:build unix

package hostapps

import (
	"os"
	"os/exec"
	"syscall"
)

func configureProcess(cmd *exec.Cmd)            { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func configureIndependentProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
func lockApplicationStore(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
func killProcess(cmd *exec.Cmd) error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
