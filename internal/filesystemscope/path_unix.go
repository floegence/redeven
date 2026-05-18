//go:build !windows

package filesystemscope

import "path/filepath"

func computerRootPath() string {
	return string(filepath.Separator)
}
