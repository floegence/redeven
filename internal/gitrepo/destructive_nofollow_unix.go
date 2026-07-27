//go:build linux || darwin

package gitrepo

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func openRootDirectoryNoFollow(path string) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_DIRECTORY, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path), nil
}

func openDirectoryAtNoFollow(parent *os.File, name string) (*os.File, error) {
	return openAtNoFollow(parent, name, unix.O_DIRECTORY)
}

func openRegularAtNoFollow(parent *os.File, name string) (*os.File, error) {
	return openAtNoFollow(parent, name, 0)
}

func openAtNoFollow(parent *os.File, name string, extraFlags int) (*os.File, error) {
	if parent == nil || name == "" {
		return nil, errors.New("invalid no-follow open")
	}
	fd, err := unix.Openat(int(parent.Fd()), name, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|extraFlags, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), filepath.Join(parent.Name(), name)), nil
}

func readlinkAtNoFollow(parent *os.File, name string, limit int) (string, error) {
	if parent == nil || name == "" || limit <= 0 {
		return "", errors.New("invalid no-follow readlink")
	}
	buffer := make([]byte, limit+1)
	n, err := unix.Readlinkat(int(parent.Fd()), name, buffer)
	if err != nil {
		return "", err
	}
	if n > limit {
		return "", errDestructiveWorkspaceScanLimit
	}
	return string(buffer[:n]), nil
}
