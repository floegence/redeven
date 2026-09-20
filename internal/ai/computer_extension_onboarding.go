package ai

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/floegence/redeven/internal/session"
)

// Only explicit UI commands open native applications. Neither model tools nor
// caller-provided paths, URLs or command arguments reach this boundary.
func (s *Service) OpenComputerExtension(ctx context.Context, meta *session.Meta, action string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	if action != "extensions" && action != "folder" && action != "connect" {
		return errors.New("invalid browser setup action")
	}
	setup, err := s.SetupComputerExtension(ctx, meta)
	if err != nil {
		return err
	}
	name, args, err := computerExtensionOpenCommand(runtime.GOOS, action, setup)
	if err != nil {
		return err
	}
	if runtime.GOOS == "linux" && action != "folder" {
		name, err = exec.LookPath(name)
		if err != nil {
			return errors.New("cannot open Google Chrome: browser is not installed")
		}
	}
	// Linux Chrome may remain attached when it starts a new process. Reap it
	// asynchronously; actual connection readiness comes only from Native Messaging.
	cmd := exec.Command(name, args...)
	if runtime.GOOS == "darwin" {
		return cmd.Run()
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func computerExtensionOpenCommand(platform, action string, setup ComputerExtensionSetup) (string, []string, error) {
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
		return "google-chrome", []string{destination}, nil
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
