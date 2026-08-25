package localui

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// InstallLocalUIDeviceCAForCurrentUser is invoked only by the explicit CLI
// install operation. It never elevates privileges or modifies system-wide
// trust. Linux distributions expose incompatible user trust stores, so Linux
// returns a manual-install result instead of guessing or invoking sudo.
func InstallLocalUIDeviceCAForCurrentUser(stateDir string) error {
	if _, err := loadLocalUIDeviceCA(stateDir); err != nil {
		return err
	}
	certificatePath := localUIDeviceCACertificatePath(stateDir)
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return fmt.Errorf("resolve current-user keychain: %w", err)
		}
		keychain := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
		command = exec.Command("security", "add-trusted-cert", "-r", "trustRoot", "-k", keychain, certificatePath)
	case "windows":
		command = exec.Command("certutil.exe", "-user", "-addstore", "Root", certificatePath)
	default:
		return ErrLocalUIDeviceCAManual
	}
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("install Local UI device CA for current user: %w (%s)", err, sanitizedCommandOutput(output))
	}
	return nil
}

func sanitizedCommandOutput(output []byte) string {
	const limit = 512
	if len(output) > limit {
		output = output[:limit]
	}
	return string(output)
}
