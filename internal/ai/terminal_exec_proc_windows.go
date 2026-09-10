//go:build windows

package ai

import (
	"errors"
	"os/exec"
)

func configureTerminalExecProcessGroup(cmd *exec.Cmd) {
	// Not supported in this simplified Windows implementation.
}

func terminateTerminalExecProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return errors.New("terminal process handle is unavailable")
	}
	return cmd.Process.Kill()
}

func terminalExecWasTerminated(err error) bool {
	// Process.Kill uses the same exit code as ordinary command failures.
	// Preserve the observed exit result instead of inventing signal evidence.
	return false
}
