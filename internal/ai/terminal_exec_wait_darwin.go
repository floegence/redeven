package ai

import (
	"errors"
	"os"
	"os/exec"

	"golang.org/x/sys/unix"
)

func terminalExecGroupSignalError(pid int, err error) error {
	if errors.Is(err, unix.EPERM) {
		// Darwin skips zombies when delivering a group signal and returns EPERM
		// if no live member remains. Do not hide a denial for a live process.
		alive, inspectErr := terminalExecGroupRunning(pid)
		if inspectErr != nil {
			return errors.Join(err, inspectErr)
		}
		if alive {
			return err
		}
		return os.ErrProcessDone
	}
	return terminalExecGroupSignalResult(err)
}

func terminalExecGroupRunning(pid int) (bool, error) {
	members, err := unix.SysctlKinfoProcSlice("kern.proc.pgrp", pid)
	if err != nil {
		return false, err
	}
	for _, member := range members {
		if member.Proc.P_stat != 5 { // SZOMB
			return true, nil
		}
	}
	return false, nil
}

func terminalExecExitWaiter(cmd *exec.Cmd) func() error {
	return func() error {
		fd, err := unix.Kqueue()
		if err != nil {
			return err
		}
		defer unix.Close(fd)
		unix.CloseOnExec(fd)
		event := unix.Kevent_t{Ident: uint64(cmd.Process.Pid), Filter: unix.EVFILT_PROC, Flags: unix.EV_ADD | unix.EV_ONESHOT, Fflags: unix.NOTE_EXIT}
		if _, err := unix.Kevent(fd, []unix.Kevent_t{event}, nil, nil); err != nil {
			// No other owner calls Wait: even an already-exited child retains its
			// PID until this worker finishes group cleanup and calls cmd.Wait.
			if errors.Is(err, unix.ESRCH) {
				return nil
			}
			return err
		}
		events := make([]unix.Kevent_t, 1)
		for {
			n, err := unix.Kevent(fd, nil, events, nil)
			if errors.Is(err, unix.EINTR) {
				continue
			}
			if err != nil {
				return err
			}
			if n > 0 {
				if events[0].Flags&unix.EV_ERROR != 0 {
					return unix.Errno(events[0].Data)
				}
				return nil
			}
		}
	}
}
