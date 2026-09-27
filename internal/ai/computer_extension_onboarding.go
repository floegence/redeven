package ai

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
	"github.com/floegence/redeven/internal/session"
)

// Only explicit UI commands open native applications. Neither model tools nor
// caller-provided paths, URLs or command arguments reach this boundary.
func (s *Service) OpenComputerExtension(ctx context.Context, meta *session.Meta, action, installationID string) error {
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return errors.New("computer runtime unavailable")
	}
	return host.OpenBrowserExtension(ctx, meta, action, installationID)
}

func (host *ComputerUseRuntime) OpenBrowserExtension(ctx context.Context, meta *session.Meta, action, installationID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	if action != "extensions" && action != "folder" && action != "connect" {
		return errors.New("invalid browser setup action")
	}
	setup, err := host.BrowserExtensionSetup(ctx, meta, installationID)
	if err != nil {
		return err
	}
	installation, err := browserbridge.ResolveInstallation(installationID)
	if err != nil {
		return extensionFailure("open", "browser_not_installed", err)
	}
	name, args, err := computerExtensionOpenCommand(runtime.GOOS, action, setup, installation)
	if err != nil {
		return err
	}
	if err := checkComputerExtensionOpen(runtime.GOOS, action, installation, os.Getenv, exec.LookPath); err != nil {
		return err
	}
	host.mu.RLock()
	hub := host.extension
	host.mu.RUnlock()
	hub.mu.Lock()
	registration := hub.registrations[installationID]
	registration.launchGeneration++
	generation := registration.launchGeneration
	hub.mu.Unlock()
	reason := "browser_start_failed"
	if action == "folder" {
		reason = "folder_open_failed"
	}
	return startComputerExtensionCommand(exec.Command(name, args...), reason, func(err error) {
		diagnostic := ComputerExtensionDiagnosticForError(err, "open")
		hub.mu.Lock()
		defer hub.mu.Unlock()
		if !hub.closed && registration.launchGeneration == generation && !hub.installationConnected(installationID) {
			registration.diagnostic = &diagnostic
		}
	})
}

// Starting an application is not proof that it opened. Observe early exits and
// retain later failures in the existing hub; the handshake alone means connected.
func startComputerExtensionCommand(cmd *exec.Cmd, reason string, failed func(error)) error {
	if err := cmd.Start(); err != nil {
		return extensionFailure("open", reason, err)
	}
	done := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		if err != nil {
			err = extensionFailure("open", reason, err)
			diagnostic := ComputerExtensionDiagnosticForError(err, "open")
			slog.Warn("browser application launch failed", "reason", diagnostic.Reason, "diagnostic_id", diagnostic.DiagnosticID, "exit", cmd.ProcessState.ExitCode())
			failed(err)
		}
		done <- err
	}()
	timer := time.NewTimer(300 * time.Millisecond)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		return nil
	}
}

func computerExtensionOpenCommand(platform, action string, setup ComputerExtensionSetup, installation browserbridge.Installation) (string, []string, error) {
	var destination string
	switch action {
	case "extensions":
		destination = "chrome://extensions/"
	case "folder":
		destination = setup.ExtensionPath
	case "connect":
		destination = "chrome-extension://" + setup.ExtensionID + "/popup.html#" + setup.NativeHost
	default:
		return "", nil, errors.New("invalid browser setup action")
	}
	switch platform {
	case "darwin":
		if action == "folder" {
			return "/usr/bin/open", []string{"-R", destination}, nil
		}
		return "/usr/bin/open", []string{"-b", "com.google.Chrome", destination}, nil
	case "linux":
		if action == "folder" {
			return "xdg-open", []string{filepath.Dir(destination)}, nil
		}
		if !installation.Installed || installation.Executable == "" {
			return "", nil, extensionFailure("open", "browser_not_installed", nil)
		}
		return installation.Executable, []string{destination}, nil
	default:
		return "", nil, errors.New("browser extension platform unavailable")
	}
}

// Chrome retains this path across Runtime builds. Stage the complete packaged
// extension first, so a missing or invalid bundle cannot erase an installation.
func stageComputerExtension(source, destination string) error {
	if err := filepath.WalkDir(source, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && !entry.Type().IsRegular() {
			return errors.New("invalid packaged extension asset")
		}
		return nil
	}); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	// Installation is visible in the user's home. A pre-existing shortcut must
	// not redirect package writes into an unrelated directory.
	for _, path := range []string{filepath.Dir(destination), destination} {
		info, err := os.Lstat(path)
		if os.IsNotExist(err) && path == destination {
			continue
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("invalid browser extension installation directory")
		}
	}
	staged, err := os.MkdirTemp(filepath.Dir(destination), ".extension-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staged)
	if err := os.CopyFS(staged, os.DirFS(source)); err != nil {
		return err
	}
	if err := os.RemoveAll(destination); err != nil {
		return err
	}
	return os.Rename(staged, destination)
}
