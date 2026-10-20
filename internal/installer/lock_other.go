//go:build !darwin && !linux

package installer

import "errors"

func lockInstallation(string) (func(), error) {
	return nil, errors.New("self-contained installation is supported on Linux and macOS only")
}
