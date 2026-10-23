//go:build !darwin && !linux

package ai

import "os/exec"

// Process-group settlement is supported on the Runtime's Darwin/Linux targets.
func terminalExecExitWaiter(_ *exec.Cmd) func() error { return nil }
func terminalExecGroupRunning(_ int) (bool, error)    { return false, nil }
