package runtimeidentity

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const runtimeSuitesDirectory = ".redeven-runtime-suites"

var runtimeSuiteHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// CurrentExecutablePath returns the absolute, symlink-resolved identity of the
// executable backing the current process.
func CurrentExecutablePath() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve current executable: %w", err)
	}
	return CanonicalExecutablePath(path)
}

// CanonicalExecutablePath resolves path without retaining an unresolved alias.
func CanonicalExecutablePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("executable path is empty")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("make executable path absolute: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("resolve executable symlinks: %w", err)
	}
	resolved = filepath.Clean(strings.TrimSpace(resolved))
	if resolved == "" || !filepath.IsAbs(resolved) {
		return "", errors.New("resolved executable path is not absolute")
	}
	return resolved, nil
}

// RuntimeSuiteActivationRoot returns the installation root whose redeven
// activation link resolves to canonicalExecutablePath. Versioned suites use a
// closed directory shape so an upgrade cannot be nested inside the active
// suite. A regular root-level executable is accepted only as the explicit
// pre-suite migration shape.
func RuntimeSuiteActivationRoot(canonicalExecutablePath string) (string, error) {
	canonicalExecutablePath = filepath.Clean(strings.TrimSpace(canonicalExecutablePath))
	if canonicalExecutablePath == "" || !filepath.IsAbs(canonicalExecutablePath) {
		return "", errors.New("canonical executable path is unavailable")
	}
	if filepath.Base(canonicalExecutablePath) != "redeven" {
		return "", errors.New("canonical executable is not named redeven")
	}

	suiteDir := filepath.Dir(canonicalExecutablePath)
	suiteHash := filepath.Base(suiteDir)
	suiteParent := filepath.Dir(suiteDir)
	if filepath.Base(suiteParent) == runtimeSuitesDirectory && runtimeSuiteHashPattern.MatchString(suiteHash) {
		activationRoot := filepath.Dir(suiteParent)
		activationPath := filepath.Join(activationRoot, "redeven")
		resolvedActivation, err := CanonicalExecutablePath(activationPath)
		if err != nil {
			return "", fmt.Errorf("resolve runtime activation: %w", err)
		}
		if resolvedActivation != canonicalExecutablePath {
			return "", errors.New("runtime activation does not reference the current suite")
		}
		return activationRoot, nil
	}

	info, err := os.Lstat(canonicalExecutablePath)
	if err != nil {
		return "", fmt.Errorf("inspect root executable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("root executable is not a regular file")
	}
	return filepath.Dir(canonicalExecutablePath), nil
}
