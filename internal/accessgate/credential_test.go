package accessgate

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestStoredPasswordSurvivesIndependentRuntimeRestart(t *testing.T) {
	dir := t.TempDir()
	hash, err := HashPassword("shared environment password")
	if err != nil {
		t.Fatal(err)
	}
	if err := WritePasswordHash(dir, hash); err != nil {
		t.Fatal(err)
	}
	stored, err := ReadPasswordHash(dir)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := NewWithPasswordHash(stored)
	if err != nil {
		t.Fatal(err)
	}
	if !gate.Enabled() || !gate.VerifyPassword("shared environment password") || gate.VerifyPassword("wrong") {
		t.Fatal("restored gate must accept only the configured password")
	}
	if strings.Contains(string(stored), "shared environment password") {
		t.Fatal("plaintext password persisted")
	}
	if err := WritePasswordHash(dir, nil); err != nil {
		t.Fatal(err)
	}
	stored, err = ReadPasswordHash(dir)
	if err != nil || len(stored) != 0 {
		t.Fatalf("explicit clear: hash=%v error=%v", len(stored), err)
	}
}

func TestStoredPasswordRejectsDamageAndUnsafeFiles(t *testing.T) {
	for _, kind := range []string{"corrupt", "empty", "public", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			if runtime.GOOS == "windows" && (kind == "public" || kind == "symlink") {
				t.Skip("Unix permissions")
			}
			dir := t.TempDir()
			path := filepath.Join(dir, credentialFileName)
			hash, err := HashPassword("secret")
			if err != nil {
				t.Fatal(err)
			}
			if kind == "corrupt" {
				hash = []byte("not a password hash")
			}
			if kind == "empty" {
				hash = nil
			}
			if err := os.WriteFile(path, hash, 0600); err != nil {
				t.Fatal(err)
			}
			if kind == "public" {
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "symlink" {
				if err := os.Rename(path, path+".target"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(path+".target", path); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := ReadPasswordHash(dir); err == nil {
				t.Fatal("unsafe credential accepted")
			}
		})
	}
}

func TestOversizedPasswordNeverDisablesAuthentication(t *testing.T) {
	password := strings.Repeat("a", 73)
	if _, err := HashPassword(password); err == nil {
		t.Fatal("oversized password accepted")
	}
	gate := New(Options{Password: password})
	if !gate.Enabled() || gate.VerifyPassword("") || gate.VerifyPassword(password) {
		t.Fatal("invalid password must fail closed")
	}
}
