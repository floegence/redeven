package runtimeidentity

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const executableIdentityHelperEnvironment = "REDEVEN_EXECUTABLE_IDENTITY_HELPER"

func TestCurrentExecutablePathFromActivationProcess(t *testing.T) {
	if os.Getenv(executableIdentityHelperEnvironment) == "1" {
		path, err := CurrentExecutablePath()
		if err != nil {
			_, _ = fmt.Fprint(os.Stderr, err)
			os.Exit(2)
		}
		_, _ = fmt.Fprintln(os.Stdout, "identity:"+path)
		return
	}

	root := t.TempDir()
	hash := strings.Repeat("c", 64)
	suite := filepath.Join(root, runtimeSuitesDirectory, hash)
	if err := os.MkdirAll(suite, 0o700); err != nil {
		t.Fatal(err)
	}
	currentTestExecutable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(suite, "redeven")
	copyExecutable(t, currentTestExecutable, executable)
	activation := filepath.Join(root, "redeven")
	if err := os.Symlink(filepath.Join(runtimeSuitesDirectory, hash, "redeven"), activation); err != nil {
		t.Fatal(err)
	}

	command := exec.Command(activation, "-test.run=^TestCurrentExecutablePathFromActivationProcess$")
	command.Env = append(os.Environ(), executableIdentityHelperEnvironment+"=1")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("activation helper failed: %v: %s", err, output)
	}
	want, err := CanonicalExecutablePath(executable)
	if err != nil {
		t.Fatal(err)
	}
	got := ""
	for _, line := range strings.Split(string(output), "\n") {
		if strings.HasPrefix(line, "identity:") {
			got = strings.TrimPrefix(line, "identity:")
			break
		}
	}
	if got != want {
		t.Fatalf("current executable path = %q, want %q", got, want)
	}
}

func TestCanonicalExecutablePathResolvesActivationSymlink(t *testing.T) {
	root, executable, activation := writeRuntimeSuiteActivation(t)

	got, err := CanonicalExecutablePath(activation)
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("canonical executable path = %q, want %q (root %q)", got, want, root)
	}
}

func TestCanonicalExecutablePathRejectsUnresolvedActivation(t *testing.T) {
	activation := filepath.Join(t.TempDir(), "redeven")
	if err := os.Symlink("missing", activation); err != nil {
		t.Fatal(err)
	}
	if _, err := CanonicalExecutablePath(activation); err == nil {
		t.Fatal("expected unresolved activation to fail")
	}
}

func TestRuntimeSuiteActivationRootRequiresExactActiveSuite(t *testing.T) {
	root, executable, _ := writeRuntimeSuiteActivation(t)
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := CanonicalExecutablePath(executable)
	if err != nil {
		t.Fatal(err)
	}
	got, err := RuntimeSuiteActivationRoot(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if got != canonicalRoot {
		t.Fatalf("activation root = %q, want %q", got, canonicalRoot)
	}

	otherHash := strings.Repeat("b", 64)
	otherSuite := filepath.Join(root, runtimeSuitesDirectory, otherHash)
	if err := os.Mkdir(otherSuite, 0o700); err != nil {
		t.Fatal(err)
	}
	otherExecutable := filepath.Join(otherSuite, "redeven")
	if err := os.WriteFile(otherExecutable, []byte("other"), 0o700); err != nil {
		t.Fatal(err)
	}
	otherCanonical, err := CanonicalExecutablePath(otherExecutable)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RuntimeSuiteActivationRoot(otherCanonical); err == nil {
		t.Fatal("expected inactive suite to be rejected")
	}
}

func TestRuntimeSuiteActivationRootAcceptsRegularMigrationExecutable(t *testing.T) {
	root := t.TempDir()
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(root, "redeven")
	if err := os.WriteFile(executable, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	canonical, err := CanonicalExecutablePath(executable)
	if err != nil {
		t.Fatal(err)
	}
	got, err := RuntimeSuiteActivationRoot(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if got != canonicalRoot {
		t.Fatalf("activation root = %q, want %q", got, canonicalRoot)
	}
}

func writeRuntimeSuiteActivation(t *testing.T) (string, string, string) {
	t.Helper()
	root := t.TempDir()
	hash := strings.Repeat("a", 64)
	suite := filepath.Join(root, runtimeSuitesDirectory, hash)
	if err := os.MkdirAll(suite, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(suite, "redeven")
	if err := os.WriteFile(executable, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	activation := filepath.Join(root, "redeven")
	if err := os.Symlink(filepath.Join(runtimeSuitesDirectory, hash, "redeven"), activation); err != nil {
		t.Fatal(err)
	}
	return root, executable, activation
}

func copyExecutable(t *testing.T, sourcePath string, destinationPath string) {
	t.Helper()
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = source.Close() }()
	destination, err := os.OpenFile(destinationPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o700)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(destination, source); err != nil {
		_ = destination.Close()
		t.Fatal(err)
	}
	if err := destination.Close(); err != nil {
		t.Fatal(err)
	}
}
