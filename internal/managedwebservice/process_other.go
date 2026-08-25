//go:build !darwin && !linux

package managedwebservice

import "os/exec"

func configureManagedProcess(_ *exec.Cmd) {}
func terminateManagedProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
func killManagedProcess(cmd *exec.Cmd) error { return terminateManagedProcess(cmd) }
func managedProcessAlive(_ int) bool         { return false }
