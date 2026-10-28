//go:build darwin || linux

package environmentcenter

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// Protected state requires an owner-controlled parent chain. Sticky shared
// temporary directories are allowed because their entries remain owner-only.
func validateStateOwnership(dir string) error {
	for current := dir; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("Center state ancestors must be real directories")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != uint32(os.Geteuid()) && stat.Uid != 0 {
			return errors.New("Center state ancestor is not owned by service owner or root")
		}
		if info.Mode().Perm()&0022 != 0 && info.Mode()&os.ModeSticky == 0 {
			return errors.New("Center state ancestor is writable by another principal")
		}
		if filepath.Dir(current) == current {
			break
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		info, err := os.Lstat(filepath.Join(dir, entry.Name()))
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != uint32(os.Geteuid()) || info.Mode()&os.ModeSymlink != 0 || info.Mode().IsRegular() && stat.Nlink != 1 {
			return errors.New("Center state file ownership or link count is unsafe")
		}
	}
	return nil
}
