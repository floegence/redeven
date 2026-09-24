package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floe-native-apps/artifactcache"
)

func TestHostApplicationPackageRejectsUntrustedInputs(t *testing.T) {
	root := t.TempDir()
	output := filepath.Join(root, "components.zip")
	cases := [][]string{
		{"--arch", "arm64", "--cache", "relative", "--output", output},
		{"--arch", "amd64", "--cache", root, "--output", "relative"},
		{"--arch", "riscv64", "--cache", root, "--output", output},
		{"--arch", "arm64", "--cache", root, "--output", output, "--url", "https://example.test/untrusted.zip"},
	}
	for _, args := range cases {
		code, _, _ := runCLITest(t, append([]string{"host-application-package"}, args...)...)
		if code == 0 {
			t.Fatalf("invalid package request accepted: %v", args)
		}
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("invalid request created output: %v", err)
	}
}

func TestHostApplicationPackageRejectsMismatchedTransferPlan(t *testing.T) {
	root := t.TempDir()
	output := filepath.Join(root, "components.zip")
	code, _, _ := runCLITest(t, "host-application-package", "--arch", "amd64", "--cache", root, "--output", output, "--plan", `{"package_digest":"unknown","architecture":"amd64","missing_artifacts":[],"missing_bytes":0}`)
	if code != 3 {
		t.Fatalf("target mismatch exit=%d", code)
	}
	if entries, err := os.ReadDir(root); err != nil || len(entries) != 0 {
		t.Fatal("mismatched plan performed filesystem acquisition", entries, err)
	}
}

func TestHostApplicationCacheMaintenancePrunesExpiredArchivesAndSkipsActiveReaders(t *testing.T) {
	root := t.TempDir()
	archives := filepath.Join(root, "archives")
	if err := os.Mkdir(archives, 0700); err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(archives, strings.Repeat("a", 64))
	if err := os.WriteFile(name, []byte("old cache"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(name, old, old); err != nil {
		t.Fatal(err)
	}
	lease, err := artifactcache.OpenSession(t.Context(), archives, artifactcache.SessionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	code, _, _ := runCLITest(t, "host-application-package", "--cache", root, "--maintenance")
	if code != 0 {
		t.Fatal(code)
	}
	if _, err := os.Stat(name); err != nil {
		t.Fatal("active cache was pruned", err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	code, _, _ = runCLITest(t, "host-application-package", "--cache", root, "--maintenance")
	if code != 0 {
		t.Fatal(code)
	}
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("expired archive remains", err)
	}
}

func TestHostApplicationCacheMaintenanceRejectsAcquisitionArguments(t *testing.T) {
	root := t.TempDir()
	code, _, _ := runCLITest(t, "host-application-package", "--maintenance", "--cache", root, "--arch", "arm64")
	if code != 2 {
		t.Fatal(code)
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 0 {
		t.Fatal("invalid maintenance request changed cache", files, err)
	}
}
