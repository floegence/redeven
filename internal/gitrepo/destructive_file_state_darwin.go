package gitrepo

import (
	"os"
	"syscall"
)

// Access time is deliberately excluded: a read must not invalidate consent.
// ctime detects same-size rewrites even when a writer restores the old mtime.
func destructiveFileState(info os.FileInfo) ([8]uint64, error) {
	if info == nil {
		return [8]uint64{}, errDestructiveWorkspaceScanLimit
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return [8]uint64{}, errDestructiveWorkspaceScanLimit
	}
	return [8]uint64{uint64(stat.Dev), stat.Ino, uint64(info.Mode()), uint64(info.Size()),
		uint64(stat.Mtimespec.Sec), uint64(stat.Mtimespec.Nsec),
		uint64(stat.Ctimespec.Sec), uint64(stat.Ctimespec.Nsec)}, nil
}
