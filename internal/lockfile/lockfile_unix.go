//go:build !windows

package lockfile

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func lockFile(f *os.File) error {
	if f == nil {
		return errors.New("nil lock file")
	}

	// Best-effort: ensure the lock fd is not inherited across exec(2) restarts.
	// This is important for in-place self-upgrade where we restart via syscall.Exec.
	if flags, err := unix.FcntlInt(f.Fd(), unix.F_GETFD, 0); err == nil {
		_, _ = unix.FcntlInt(f.Fd(), unix.F_SETFD, flags|unix.FD_CLOEXEC)
	}

	// Non-blocking exclusive lock.
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		if errors.Is(err, unix.EWOULDBLOCK) {
			return ErrAlreadyLocked
		}
		return err
	}
	return nil
}

func unlockFile(f *os.File) error {
	if f == nil {
		return nil
	}
	return unix.Flock(int(f.Fd()), unix.LOCK_UN)
}
