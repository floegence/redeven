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

func terminateTerminalExecProcessGroup(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return errors.New("terminal process handle is unavailable")
	}
	// The PTY command owns this process group. Descendants that create a new
	// session or process group are outside the terminal execution contract.
	// The caller must retain the unreaped root PID until its final group signal.
	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	return terminalExecGroupSignalError(cmd.Process.Pid, err)
}

func terminalExecGroupSignalResult(err error) error {
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
