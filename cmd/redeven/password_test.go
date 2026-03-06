package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRunPassword(t *testing.T) {
	t.Run("raw password", func(t *testing.T) {
		password, err := resolveRunPassword(runPasswordOptions{password: "secret"})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if password != "secret" {
			t.Fatalf("password = %q, want %q", password, "secret")
		}
	})

	t.Run("env password", func(t *testing.T) {
		const envName = "REDEVEN_TEST_PASSWORD"
		if err := os.Setenv(envName, "from-env"); err != nil {
			t.Fatalf("Setenv() error = %v", err)
		}
		defer os.Unsetenv(envName)

		password, err := resolveRunPassword(runPasswordOptions{passwordEnv: envName})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if password != "from-env" {
			t.Fatalf("password = %q, want %q", password, "from-env")
		}
	})

	t.Run("file password trims trailing newline", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "password.txt")
		if err := os.WriteFile(path, []byte("from-file\n"), 0o600); err != nil {
			t.Fatalf("WriteFile() error = %v", err)
		}

		password, err := resolveRunPassword(runPasswordOptions{passwordFile: path})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if password != "from-file" {
			t.Fatalf("password = %q, want %q", password, "from-file")
		}
	})

	t.Run("reject multiple sources", func(t *testing.T) {
		if _, err := resolveRunPassword(runPasswordOptions{password: "a", passwordEnv: "B"}); err == nil {
			t.Fatalf("expected multiple sources error")
		}
	})
}
