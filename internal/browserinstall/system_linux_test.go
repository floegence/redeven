//go:build linux

package browserinstall

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSystemBrowserPolicyMatchesOnlyTheVersionedExecutable(t *testing.T) {
	pkg, err := NativePackage()
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(systemBrowserRoot, pkg.SHA256, pkg.Executable)
	policy := string(systemBrowserPolicy(pkg, executable))
	if strings.Count(policy, executable) != 1 || strings.ContainsAny(policy, "*?") || !strings.Contains(policy, "userns,") || strings.Contains(policy, "no-sandbox") {
		t.Fatalf("unexpected policy: %s", policy)
	}
}
func TestSystemBrowserRejectsWritableAncestorsAndSymlinks(t *testing.T) {
	root := t.TempDir()
	if trustedSystemPath(root) {
		t.Fatal("accepted a user-writable ancestor")
	}
	linked := filepath.Join(root, "redirect")
	if err := os.Symlink("/opt", linked); err != nil {
		t.Fatal(err)
	}
	if trustedSystemPath(linked) {
		t.Fatal("accepted a redirected system directory")
	}
	if err := ensureTrustedSystemDirectory(filepath.Join(linked, "must-not-create")); err == nil {
		t.Fatal("created through an untrusted path")
	}
}

func TestSystemBrowserDependencyFailuresAreClassifiedWithoutLeakingOutput(t *testing.T) {
	for _, tc := range []struct {
		name, script string
		want         error
	}{
		{"ready", "exit 0", nil},
		{"missing_library", "echo 'chrome: error while loading shared libraries: private.so: cannot open shared object file' >&2; exit 127", ErrDependenciesMissing},
		{"unknown_failure", "echo 'private diagnostic text' >&2; exit 2", ErrLaunchUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			executable := filepath.Join(t.TempDir(), "chrome")
			if err := os.WriteFile(executable, []byte("#!/bin/sh\n"+tc.script+"\n"), 0700); err != nil {
				t.Fatal(err)
			}
			if got := systemBrowserDependencies(Package{Platform: "linux"}, executable); got != tc.want {
				t.Fatalf("classification %v; want %v", got, tc.want)
			}
		})
	}
}
