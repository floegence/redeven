package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRunPassword(t *testing.T) {
	t.Run("raw password skips startup verification", func(t *testing.T) {
		resolved, err := resolveRunPassword(runPasswordOptions{password: "secret"})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if resolved.password != "secret" {
			t.Fatalf("password = %q, want %q", resolved.password, "secret")
		}
		if resolved.requireStartupVerification {
			t.Fatalf("requireStartupVerification = true, want false")
		}
	})

	t.Run("env password keeps startup verification", func(t *testing.T) {
		const envName = "REDEVEN_TEST_PASSWORD"
		if err := os.Setenv(envName, "from-env"); err != nil {
			t.Fatalf("Setenv() error = %v", err)
		}
		defer os.Unsetenv(envName)

		resolved, err := resolveRunPassword(runPasswordOptions{passwordEnv: envName})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if resolved.password != "from-env" {
			t.Fatalf("password = %q, want %q", resolved.password, "from-env")
		}
		if !resolved.requireStartupVerification {
			t.Fatalf("requireStartupVerification = false, want true")
		}
	})

	t.Run("file password trims trailing newline and keeps startup verification", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "password.txt")
		if err := os.WriteFile(path, []byte("from-file\n"), 0o600); err != nil {
			t.Fatalf("WriteFile() error = %v", err)
		}

		resolved, err := resolveRunPassword(runPasswordOptions{passwordFile: path})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if resolved.password != "from-file" {
			t.Fatalf("password = %q, want %q", resolved.password, "from-file")
		}
		if !resolved.requireStartupVerification {
			t.Fatalf("requireStartupVerification = false, want true")
		}
	})

	t.Run("reject multiple sources", func(t *testing.T) {
		if _, err := resolveRunPassword(runPasswordOptions{password: "a", passwordEnv: "B"}); err == nil {
			t.Fatalf("expected multiple sources error")
		}
	})
}
