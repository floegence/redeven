//go:build windows

package filesystemscope

import "path/filepath"

func computerRootPath() string {
	return filepath.VolumeName(filepath.Clean(`C:\`)) + string(filepath.Separator)
}
