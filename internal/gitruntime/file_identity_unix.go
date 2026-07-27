//go:build linux || darwin

package gitruntime

import (
	"fmt"
	"os"
	"syscall"
)

func stableFileIdentity(info os.FileInfo) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return "", fmt.Errorf("filesystem identity unavailable")
	}
	return fmt.Sprintf("%d:%d", uint64(stat.Dev), uint64(stat.Ino)), nil
}
