//go:build windows

package ai

import (
	"os"
	"os/exec"
)

func configureTerminalExecProcessGroup(cmd *exec.Cmd) {
	// Not supported in this simplified Windows implementation.
}

func terminateTerminalExecProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	p, err := os.FindProcess(cmd.Process.Pid)
	if err != nil {
		return nil
	}
	_ = p.Kill()
	return nil
}
