//go:build linux

package fs

import (
	"errors"
	"golang.org/x/sys/unix"
)

func renameNoReplace(source string, destination string) error {
	err := unix.Renameat2(unix.AT_FDCWD, source, unix.AT_FDCWD, destination, unix.RENAME_NOREPLACE)
	if errors.Is(err, unix.EEXIST) {
		return errArchiveDestinationExists
	}
	return err
}
