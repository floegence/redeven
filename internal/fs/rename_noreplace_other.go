//go:build !linux && !darwin && !windows

package fs

import (
	"errors"
	"os"
)

func renameNoReplace(source string, destination string) error {
	if _, err := os.Lstat(destination); err == nil {
		return errArchiveDestinationExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(source, destination)
}
