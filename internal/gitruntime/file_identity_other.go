//go:build !linux && !darwin

package gitruntime

import (
	"errors"
	"os"
)

func stableFileIdentity(_ os.FileInfo) (string, error) {
	return "", errors.New("stable filesystem identity unavailable")
}
