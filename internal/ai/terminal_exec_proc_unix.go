//go:build !windows

package ai

import (
	"os/exec"
	"syscall"
)

func configureTerminalExecProcessGroup(cmd *exec.Cmd) {
	// creack/pty starts the command in a new session and process group. Adding
	// Setpgid here conflicts with that controlling-terminal setup on Unix.
}

func terminateTerminalExecProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	pid := cmd.Process.Pid
	if pid <= 0 {
		return nil
	}
	// Best effort: kill the full process group first, then the direct process.
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = syscall.Kill(pid, syscall.SIGKILL)
	return nil
}
