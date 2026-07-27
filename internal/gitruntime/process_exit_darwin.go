//go:build darwin

package gitruntime

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

type processExitObserver struct {
	fd              int
	exitedBeforeAdd bool
}

func newProcessExitObserver(process *os.Process) (*processExitObserver, error) {
	if process == nil || process.Pid <= 0 {
		return nil, errors.New("invalid process")
	}
	fd, err := unix.Kqueue()
	if err != nil {
		return nil, err
	}
	event := unix.Kevent_t{
		Ident:  uint64(process.Pid),
		Filter: unix.EVFILT_PROC,
		Flags:  unix.EV_ADD | unix.EV_ENABLE,
		Fflags: unix.NOTE_EXIT,
	}
	if _, err := unix.Kevent(fd, []unix.Kevent_t{event}, nil, nil); err != nil {
		_ = unix.Close(fd)
		if errors.Is(err, unix.ESRCH) {
			return &processExitObserver{fd: -1, exitedBeforeAdd: true}, nil
		}
		return nil, err
	}
	return &processExitObserver{fd: fd}, nil
}

func (o *processExitObserver) exited() (bool, error) {
	if o.exitedBeforeAdd {
		return true, nil
	}
	events := make([]unix.Kevent_t, 1)
	timeout := unix.Timespec{}
	n, err := unix.Kevent(o.fd, nil, events, &timeout)
	if errors.Is(err, unix.EINTR) {
		return false, nil
	}
	return n > 0, err
}

func (o *processExitObserver) close() error {
	if o == nil || o.fd < 0 {
		return nil
	}
	err := unix.Close(o.fd)
	o.fd = -1
	return err
}
