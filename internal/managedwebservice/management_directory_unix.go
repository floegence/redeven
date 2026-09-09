//go:build darwin || linux

package managedwebservice

import (
	"os"
	"syscall"
)

func directoryGeneration(info os.FileInfo) int64 {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return int64(uint64(stat.Dev)*1099511628211 ^ uint64(stat.Ino))
	}
	return 0
}
