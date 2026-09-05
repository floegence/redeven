//go:build darwin

package fs

import (
	"errors"
	"golang.org/x/sys/unix"
)

func renameNoReplace(source string, destination string) error {
	err := unix.RenamexNp(source, destination, unix.RENAME_EXCL)
	if errors.Is(err, unix.EEXIST) {
		return errArchiveDestinationExists
	}
	return err
}
