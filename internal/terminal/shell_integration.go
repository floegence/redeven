package terminal

import (
	"os"
	"path/filepath"
	"strings"
)

const redevenShellInitFolder = "redeven-terminal-shell-init"

func defaultRedevenShellInitBaseDir() string {
	if dir, err := os.UserCacheDir(); err == nil && strings.TrimSpace(dir) != "" {
		return filepath.Join(dir, "redeven", redevenShellInitFolder)
	}
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".redeven", redevenShellInitFolder)
	}
	return filepath.Join(os.TempDir(), redevenShellInitFolder)
}
