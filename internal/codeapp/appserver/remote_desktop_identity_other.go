//go:build !linux

package appserver

import "os"

func desktopRuntimeIdentity() (map[string]any, error) {
	return map[string]any{"runtime_pid": os.Getpid()}, nil
}
