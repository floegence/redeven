package installer

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func ripgrepFixture(t *testing.T, script string, mode os.FileMode) (string, string) {
	t.Helper()
	name := filepath.Join(t.TempDir(), "rg")
	data := []byte("#!/bin/sh\n" + script + "\n")
	if err := os.WriteFile(name, data, mode); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return name, fmt.Sprintf("%x", digest)
}

func TestPinnedRipgrepExecution(t *testing.T) {
	for _, test := range []struct {
		name   string
		script string
		mode   os.FileMode
		valid  bool
	}{
		{"required version", "[ \"$1\" = '--version' ] || exit 2\nprintf 'ripgrep " + ripgrepVersion + " (fixture)\\n'", 0755, true},
		{"wrong version", "printf 'ripgrep 0.0.0\\n'", 0755, false},
		{"version prefix", "printf 'ripgrep " + ripgrepVersion + ".1\\n'", 0755, false},
		{"wrong program", "printf 'other " + ripgrepVersion + "\\n'", 0755, false},
		{"missing loader", "printf 'missing required shared library\\n' >&2\nexit 127", 0755, false},
		{"not executable", "printf 'ripgrep " + ripgrepVersion + "\\n'", 0644, false},
		{"oversized output", "printf '" + strings.Repeat("x", 65<<10) + "'", 0755, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			name, _ := ripgrepFixture(t, test.script, test.mode)
			if err := verifyRipgrep(t.Context(), name); (err == nil) != test.valid {
				t.Fatalf("execution acceptance = %v, want %v: %v", err == nil, test.valid, err)
			}
		})
	}
	t.Run("cancellation", func(t *testing.T) {
		name, _ := ripgrepFixture(t, "while :; do :; done", 0755)
		ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
		defer cancel()
		if err := verifyRipgrep(ctx, name); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal("execution did not retain the deadline:", err)
		}
	})
}

func TestPublishRipgrepChecksNewAndReusedExecutables(t *testing.T) {
	for _, reused := range []bool{false, true} {
		for _, valid := range []bool{false, true} {
			t.Run(fmt.Sprintf("reused=%v/valid=%v", reused, valid), func(t *testing.T) {
				home := t.TempDir()
				old := filepath.Join(home, "previous-rg")
				if err := os.WriteFile(old, []byte("prior tool bytes"), 0755); err != nil {
					t.Fatal(err)
				}
				if err := linkRipgrep(home, old); err != nil {
					t.Fatal(err)
				}
				version := "0.0.0"
				if valid {
					version = ripgrepVersion
				}
				source, digest := ripgrepFixture(t, "printf 'ripgrep "+version+"\\n'", 0755)
				target := filepath.Join(home, ".redeven", "tools", "rg", ripgrepVersion, "fixture", "rg")
				if reused {
					data, err := os.ReadFile(source)
					if err != nil {
						t.Fatal(err)
					}
					if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(target, data, 0755); err != nil {
						t.Fatal(err)
					}
					// An authenticated reusable tool needs no second source copy,
					// but it still must pass execution on this host.
					if err := os.Remove(source); err != nil {
						t.Fatal(err)
					}
				}
				err := publishRipgrep(t.Context(), home, "fixture", source, digest)
				if (err == nil) != valid {
					t.Fatalf("publication acceptance = %v, want %v: %v", err == nil, valid, err)
				}
				link, err := os.Readlink(filepath.Join(home, ".redeven", "bin", "rg"))
				want := old
				if valid {
					want = target
				}
				if err != nil || link != want {
					t.Fatal("tool activation changed before successful execution:", link, err)
				}
				if !valid && !reused {
					if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
						t.Fatal("failed candidate was published:", err)
					}
				}
			})
		}
	}
}

func TestRequiredRipgrepFailureKeepsRuntimeActivation(t *testing.T) {
	archive, digest := tarFixture(t, runtimeFixture("v1.2.3"))
	download, source, _ := fixtureServer(t, archive, digest)
	config, err := (Config{Home: t.TempDir(), Version: "v1.2.3", InstallerVersion: "v1.2.3", Mode: "upgrade", Output: io.Discard}).normalized()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(config.InstallDir, 0755); err != nil {
		t.Fatal(err)
	}
	previous := runtimeFixture("v1.2.2")["redeven"]
	activation := filepath.Join(config.InstallDir, "redeven")
	if err := os.WriteFile(activation, previous, 0755); err != nil {
		t.Fatal(err)
	}
	tool, toolDigest := ripgrepFixture(t, "exit 127", 0755)
	err = run(t.Context(), config, runDependencies{
		source: source, client: download,
		// This is a controller fixture, not signature-verification evidence.
		verify: func(context.Context, []byte, []byte, []byte, string) error { return nil },
		prepare: func(ctx context.Context, _ *downloader, c Config, _, _ string) error {
			return publishRipgrep(ctx, c.Home, "fixture", tool, toolDigest)
		},
	})
	if err == nil || !strings.Contains(err.Error(), "runtime activation was not changed") {
		t.Fatal("non-executable required tool did not stop installation:", err)
	}
	actual, err := os.ReadFile(activation)
	if err != nil || string(actual) != string(previous) {
		t.Fatal("required tool failure replaced the previous runtime:", err)
	}
}

func TestPublishedRipgrepArchives(t *testing.T) {
	root := os.Getenv("REDEVEN_INSTALLER_RIPGREP_FIXTURE_DIR")
	if root == "" {
		t.Skip("set REDEVEN_INSTALLER_RIPGREP_FIXTURE_DIR to the original official release archives")
	}
	host, err := hostPlatform()
	if err != nil {
		t.Fatal(err)
	}
	for platform, pin := range ripgrepPlatforms {
		t.Run(platform, func(t *testing.T) {
			if strings.HasPrefix(platform, "linux_") && !strings.HasSuffix(pin.target, "-musl") {
				t.Fatal("minimal Linux hosts require the reviewed musl target")
			}
			name := "ripgrep-" + ripgrepVersion + "-" + pin.target
			archive := filepath.Join(root, name+".tar.gz")
			actual, err := fileDigest(t.Context(), archive)
			if err != nil || actual != pin.digest {
				t.Fatal("official archive does not match the reviewed pin:", err)
			}
			staging := t.TempDir()
			if _, err := extractArchive(t.Context(), archive, pin.digest, staging, name+"/rg"); err != nil {
				t.Fatal(err)
			}
			if platform == host {
				if err := verifyRipgrep(t.Context(), filepath.Join(staging, "rg")); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
