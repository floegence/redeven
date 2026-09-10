//go:build !windows

package ai

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func configureTerminalExecProcessGroup(cmd *exec.Cmd) {
	// creack/pty starts the command in a new session and process group. Adding
	// Setpgid here conflicts with that controlling-terminal setup on Unix.
}

func terminateTerminalExecProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return errors.New("terminal process handle is unavailable")
	}
	// Every PTY command owns this process group, including its descendants.
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return os.ErrProcessDone
	}
	return err
}

func terminalExecWasTerminated(err error) bool {
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		return false
	}
	status, ok := exit.Sys().(syscall.WaitStatus)
	return ok && status.Signaled() && status.Signal() == syscall.SIGKILL
}
