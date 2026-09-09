package managedwebservice

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func directoryStableIdentity(path string, info os.FileInfo) (string, error) {
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW, unix.STATX_BASIC_STATS|unix.STATX_BTIME, &stat); err != nil {
		return "", err
	}
	original, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Mask&unix.STATX_BTIME == 0 || stat.Ino != original.Ino || stat.Mode&unix.S_IFMT != unix.S_IFDIR {
		return "", os.ErrInvalid
	}
	return fmt.Sprintf("%d:%d:%d:%d:%d", stat.Dev_major, stat.Dev_minor, stat.Ino, stat.Btime.Sec, stat.Btime.Nsec), nil
}
