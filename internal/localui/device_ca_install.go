package localui

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var (
	ErrLocalUIDeviceCAInstallFailed   = errors.New("current-user certificate trust installation failed")
	ErrLocalUIDeviceCAInstallCanceled = errors.New("current-user certificate trust installation was canceled")
)

// InstallLocalUIDeviceCAForCurrentUser is invoked only by the explicit CLI
// install operation. It never elevates privileges or modifies system-wide
// trust. Linux distributions expose incompatible user trust stores, so Linux
// returns a manual-install result instead of guessing or invoking sudo.
func InstallLocalUIDeviceCAForCurrentUser(stateDir string) error {
	return withDeviceIdentityLock(stateDir, false, func() error { return installLocalUIDeviceCAUnlocked(stateDir) })
}

func installLocalUIDeviceCAUnlocked(stateDir string) error {
	ca, err := loadLocalUIDeviceCAUnlocked(stateDir)
	if err != nil {
		return err
	}
	if ca.serverCertificate != nil {
		return ErrLocalUIDeviceCAManual
	}
	certificatePath := localUIDeviceCACertificatePath(stateDir)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return fmt.Errorf("resolve current-user keychain: %w", err)
		}
		keychain := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
		command = exec.CommandContext(ctx, "security", "add-trusted-cert", "-r", "trustRoot", "-k", keychain, certificatePath)
	case "windows":
		command = exec.CommandContext(ctx, "certutil.exe", "-user", "-addstore", "Root", certificatePath)
	default:
		return ErrLocalUIDeviceCAManual
	}
	if output, err := command.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return deviceCATrustInstallError(runtime.GOOS, output, err)
	}
	return nil
}

func deviceCATrustInstallError(platform string, output []byte, err error) error {
	// Prefer platform codes. macOS security also emits this specific cancellation
	// diagnostic without an OSStatus number when the authorization sheet is closed.
	text := strings.ToLower(string(output))
	if (platform == "darwin" && (strings.Contains(text, "(-128)") || strings.Contains(text, "(-60006)") ||
		strings.Contains(text, "sectrustsettingssettrustsettings: the authorization was canceled by the user."))) ||
		(platform == "windows" && strings.Contains(text, "0x800704c7")) {
		return ErrLocalUIDeviceCAInstallCanceled
	}
	return fmt.Errorf("%w: %v (%s)", ErrLocalUIDeviceCAInstallFailed, err, sanitizedCommandOutput(output))
}

func sanitizedCommandOutput(output []byte) string {
	const limit = 512
	if len(output) > limit {
		output = output[:limit]
	}
	return string(output)
}
