//go:build !darwin && !linux

package managedwebservice

import (
	"errors"
	"os/exec"
)

func configureManagedProcess(_ *exec.Cmd) {}
func terminateManagedProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
func killManagedProcess(cmd *exec.Cmd) error { return terminateManagedProcess(cmd) }
func managedProcessAlive(_ int) bool         { return false }
func managedProcessRunning(_ int) bool       { return false }
func managedProcessDetails(_ int) (string, int, string, error) {
	return "", 0, "", errors.New("managed process recovery is unsupported on this platform")
}
func terminateManagedProcessPID(_ int) error {
	return errors.New("managed process recovery is unsupported on this platform")
}
func killManagedProcessPID(_ int) error {
	return errors.New("managed process recovery is unsupported on this platform")
}
