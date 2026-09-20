//go:build unix

package hostapps

import (
	"context"
	"errors"
	"os/exec"
	"syscall"
	"time"
)

func configureProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func stopProcess(ctx context.Context, cmd *exec.Cmd, done <-chan struct{}) error {
	select {
	case <-done:
		return nil
	default:
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
	}
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}
