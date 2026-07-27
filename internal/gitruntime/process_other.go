//go:build !linux && !darwin && !windows

package gitruntime

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

func prepareProcessGroup(_ *exec.Cmd) error            { return ErrContainmentUnavailable }
func signalProcessGroup(_ int, _ syscall.Signal) error { return ErrContainmentUnavailable }
func processGroupAlive(_ int) bool                     { return false }
func reapProcessExit(_ *os.Process) (bool, int, error) {
	return true, -1, errors.New("process containment unavailable")
}

type processExitObserver struct{}

func newProcessExitObserver(_ *os.Process) (*processExitObserver, error) {
	return nil, ErrContainmentUnavailable
}
func (*processExitObserver) exited() (bool, error) { return false, ErrContainmentUnavailable }
func (*processExitObserver) close() error          { return nil }
