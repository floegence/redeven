//go:build windows

package gitruntime

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

// A future Flowersec transport release does not remove the need for child-tree
// containment. Until a Windows Job Object owner is available, Git execution
// fails closed rather than claiming direct-child Kill contains hooks/helpers.
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
