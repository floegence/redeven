//go:build linux

package browserinstall

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/floe-native-apps/artifactcache"
	"golang.org/x/sys/unix"
)

const systemBrowserRoot = "/opt/redeven/browser"
const systemBrowserPolicyDirectory = "/etc/apparmor.d"

func systemBrowserPolicy(pkg Package, executable string) []byte {
	return []byte(fmt.Sprintf("# Managed by Redeven for a verified, root-owned browser package.\nabi <abi/4.0>,\ninclude <tunables/global>\nprofile redeven-browser-%s %s flags=(unconfined) {\n  userns,\n}\n", pkg.SHA256, executable))
}

func trustedSystemPath(path string) bool {
	for {
		info, err := os.Lstat(path)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
			return false
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return false
		}
		parent := filepath.Dir(path)
		if parent == path {
			return true
		}
		path = parent
	}
}

func requiresSystemBrowser(pkg Package) bool {
	restriction, err := os.ReadFile("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
	return pkg.Platform == "linux" && err == nil && strings.TrimSpace(string(restriction)) == "1"
}

func systemBrowserExecutable(pkg Package, directory string) (string, error) {
	if !requiresSystemBrowser(pkg) {
		return filepath.Join(directory, pkg.Executable), nil
	}
	executable := filepath.Join(systemBrowserRoot, pkg.SHA256, pkg.Executable)
	marker := filepath.Join(systemBrowserRoot, pkg.SHA256, ".ready")
	policy := filepath.Join(systemBrowserPolicyDirectory, "redeven-browser-"+pkg.SHA256)
	body, err := os.ReadFile(marker)
	if err != nil || string(body) != pkg.SHA256 || !trustedSystemPath(marker) || !trustedSystemPath(executable) || !trustedSystemPath(policy) {
		return "", ErrSystemPreparationRequired
	}
	rules, err := os.ReadFile(policy)
	if err != nil || string(rules) != string(systemBrowserPolicy(pkg, executable)) {
		return "", ErrSystemPreparationRequired
	}
	info, err := os.Stat(executable)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		return "", ErrSystemPreparationRequired
	}
	return executable, nil
}

// --version loads the browser's actual shared libraries without opening a
// profile or a page. Only recognized loader errors become dependency failures.
func systemBrowserDependencies(pkg Package, executable string) error {
	if pkg.Platform != "linux" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, executable, "--version").CombinedOutput()
	if err == nil {
		return nil
	}
	message := string(output)
	if strings.Contains(message, "error while loading shared libraries:") || strings.Contains(message, "cannot open shared object file") {
		return ErrDependenciesMissing
	}
	return ErrLaunchUnavailable
}

// InstallSystemBrowser is a short-lived privileged boundary. Its only selector
// is a package in this Runtime's compiled catalog; archive bytes are untrusted
// until the published verifier accepts them. No caller supplies paths or rules.
func InstallSystemBrowser(ctx context.Context, id string, input io.Reader, output io.Writer) error {
	if os.Geteuid() != 0 {
		return errors.New("system authorization required")
	}
	pkg, err := NativePackage()
	if err != nil || id != pkg.ID {
		return errors.New("unknown system browser package")
	}
	return installSystemBrowser(ctx, pkg, input, output, systemBrowserRoot, systemBrowserPolicyDirectory, func(ctx context.Context, remove bool, path string) error {
		action := "-r"
		if remove {
			action = "-R"
		}
		return exec.CommandContext(ctx, "/sbin/apparmor_parser", action, "-W", path).Run()
	})
}

func installSystemBrowser(ctx context.Context, pkg Package, input io.Reader, output io.Writer, root, policyDirectory string, loadPolicy func(context.Context, bool, string) error) (failure error) {
	emit := func(phase string) error { return json.NewEncoder(output).Encode(map[string]string{"phase": phase}) }
	if err := ensureTrustedSystemDirectory(root); err != nil {
		return err
	}
	if !trustedSystemPath(root) || !trustedSystemPath(policyDirectory) {
		return errors.New("untrusted system browser directory")
	}
	lock, err := os.OpenFile(filepath.Join(root, ".prepare.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return errors.New("system browser preparation is already active")
	}
	defer unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	staging, err := os.MkdirTemp(root, ".prepare-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	archive, err := os.CreateTemp(staging, ".archive-")
	if err != nil {
		return err
	}
	defer archive.Close()
	if err = emit("verifying_system"); err != nil {
		return err
	}
	if _, err = io.CopyN(archive, input, pkg.SizeBytes); err != nil {
		return err
	}
	if err = archive.Sync(); err != nil {
		return err
	}
	if err = artifactcache.Verify(ctx, archive.Name(), ArchiveSpec(pkg)); err != nil {
		return errors.New("system browser archive verification failed")
	}
	// After the fixed-size archive, EOF means the Runtime cancelled or exited.
	// The connection stays open until publication and acknowledgement finish.
	lifetime, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() { var byte [1]byte; _, _ = input.Read(byte[:]); cancel() }()
	extracted := filepath.Join(staging, "package")
	if err = os.Mkdir(extracted, 0755); err != nil {
		return err
	}
	if err = emit("preparing_system"); err != nil {
		return err
	}
	if err = extract(lifetime, archive, pkg.SizeBytes, extracted, pkg.InstalledBytes); err != nil {
		return err
	}
	if err = filepath.WalkDir(extracted, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err = lifetime.Err(); err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		mode := fs.FileMode(0644) | info.Mode().Perm()&0111
		if entry.IsDir() {
			mode = 0755
		}
		return os.Chmod(name, mode)
	}); err != nil {
		return err
	}
	final := filepath.Join(root, pkg.SHA256)
	executable := filepath.Join(final, pkg.Executable)
	policyPath := filepath.Join(policyDirectory, "redeven-browser-"+pkg.SHA256)
	// Only this verified package can occupy its version directory. A prior
	// interrupted publication may finish its exact policy; it cannot replace
	// another version or accept a directory without a root-owned receipt.
	if err = os.WriteFile(filepath.Join(extracted, ".redeven-package"), []byte(pkg.SHA256), 0644); err != nil {
		return err
	}
	fresh := true
	if _, err = os.Lstat(final); err == nil {
		receipt := filepath.Join(final, ".redeven-package")
		body, readErr := os.ReadFile(receipt)
		if readErr != nil || string(body) != pkg.SHA256 || !trustedSystemPath(receipt) || !trustedSystemPath(executable) {
			return errors.New("system browser package identity changed")
		}
		fresh = false
	} else if !os.IsNotExist(err) {
		return err
	}
	hadPolicy := false
	if existing, readErr := os.ReadFile(policyPath); readErr == nil {
		if !trustedSystemPath(policyPath) || string(existing) != string(systemBrowserPolicy(pkg, executable)) {
			return errors.New("system browser policy identity changed")
		}
		hadPolicy = true
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	policy, err := os.CreateTemp(policyDirectory, ".redeven-browser-")
	if err != nil {
		return err
	}
	defer os.Remove(policy.Name())
	if _, err = policy.Write(systemBrowserPolicy(pkg, executable)); err != nil {
		policy.Close()
		return err
	}
	if err = policy.Chmod(0644); err != nil {
		policy.Close()
		return err
	}
	if err = policy.Sync(); err != nil {
		policy.Close()
		return err
	}
	if err = policy.Close(); err != nil {
		return err
	}
	if err = lifetime.Err(); err != nil {
		return err
	}
	if fresh {
		if err = os.Rename(extracted, final); err != nil {
			return err
		}
	}
	loaded, published := false, false
	cleanupPolicy := policy.Name()
	defer func() {
		if !published {
			if loaded && !hadPolicy {
				_ = loadPolicy(context.Background(), true, cleanupPolicy)
			}
			if fresh {
				_ = os.RemoveAll(final)
			}
			if cleanupPolicy == policyPath && !hadPolicy {
				_ = os.Remove(policyPath)
			}
		}
	}()
	if err = loadPolicy(lifetime, false, policy.Name()); err != nil {
		return errors.New("system browser policy could not be loaded")
	}
	loaded = true
	if err = lifetime.Err(); err != nil {
		return err
	}
	// The marker is the last commit record. Runtime will not launch partial state.
	if err = os.Rename(policy.Name(), policyPath); err != nil {
		return err
	}
	cleanupPolicy = policyPath
	if err = os.WriteFile(filepath.Join(final, ".ready"), []byte(pkg.SHA256), 0644); err != nil {
		return err
	}
	published = true
	return emit("ready")
}

// Check each existing parent before creating its child. Never follow a writable
// or redirected parent while running with system privileges.
func ensureTrustedSystemDirectory(path string) error {
	if path == "/" {
		return nil
	}
	if err := ensureTrustedSystemDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	if err := os.Mkdir(path, 0755); err != nil && !os.IsExist(err) {
		return err
	}
	if !trustedSystemPath(path) {
		return errors.New("untrusted system browser directory")
	}
	return nil
}
