package redevpluginruntime

import (
	"debug/elf"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestInstallAtCreatesAdmissionFixtureOnlyOnLinux(t *testing.T) {
	root := t.TempDir()
	cleanup, err := InstallAt(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cleanup(); err != nil {
			t.Error(err)
		}
	})

	path := filepath.Join(root, binaryName)
	if runtime.GOOS != "linux" {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("non-Linux fixture stat error = %v, want not exist", err)
		}
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o500 {
		t.Fatalf("fixture mode = %o, want 500", info.Mode().Perm())
	}
	file, err := elf.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if file.Type != elf.ET_DYN {
		t.Fatalf("fixture ELF type = %v, want ET_DYN", file.Type)
	}
	wantMachine := elf.EM_X86_64
	if runtime.GOARCH == "arm64" {
		wantMachine = elf.EM_AARCH64
	}
	if file.Machine != wantMachine {
		t.Fatalf("fixture ELF machine = %v, want %v", file.Machine, wantMachine)
	}
}

func TestInstallAtPreservesMatchingFixture(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux runtime admission fixture")
	}
	root := t.TempDir()
	firstCleanup, err := InstallAt(root)
	if err != nil {
		t.Fatal(err)
	}
	secondCleanup, err := InstallAt(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := secondCleanup(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, binaryName)); err != nil {
		t.Fatalf("second cleanup removed first fixture: %v", err)
	}
	if err := firstCleanup(); err != nil {
		t.Fatal(err)
	}
}

func TestInstallAtRejectsDifferentExistingFileWithoutReplacingIt(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux runtime admission fixture")
	}
	root := t.TempDir()
	path := filepath.Join(root, binaryName)
	want := []byte("existing runtime")
	if err := os.WriteFile(path, want, 0o500); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallAt(root); err == nil {
		t.Fatal("InstallAt replaced a different existing runtime")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("existing runtime content = %q, want %q", got, want)
	}
}
