package main

import (
	"errors"
	"strings"
	"testing"
)

type failingReader struct{}

func (failingReader) Read(_ []byte) (int, error) {
	return 0, errors.New("boom")
}

func TestResolveRunPassword(t *testing.T) {
	t.Run("reads password from stdin without trimming internal spaces", func(t *testing.T) {
		resolved, err := resolveRunPassword(runPasswordOptions{
			passwordStdin: true,
			stdin:         strings.NewReader("  secret value  \n"),
		})
		if err != nil {
			t.Fatalf("resolveRunPassword() error = %v", err)
		}
		if resolved.password != "  secret value  " {
			t.Fatalf("resolved.password = %q, want %q", resolved.password, "  secret value  ")
		}
		if resolved.requireStartupVerification {
			t.Fatalf("resolved.requireStartupVerification = true, want false")
		}
	})

	t.Run("rejects empty stdin password", func(t *testing.T) {
		_, err := resolveRunPassword(runPasswordOptions{
			passwordStdin: true,
			stdin:         strings.NewReader("\n"),
		})
		var optErr *passwordOptionError
		if !errors.As(err, &optErr) || optErr.kind != passwordOptionErrorStdinEmpty {
			t.Fatalf("resolveRunPassword() error = %v, want stdin empty error", err)
		}
	})

	t.Run("returns a dedicated read error when stdin fails", func(t *testing.T) {
		_, err := resolveRunPassword(runPasswordOptions{
			passwordStdin: true,
			stdin:         failingReader{},
		})
		var optErr *passwordOptionError
		if !errors.As(err, &optErr) || optErr.kind != passwordOptionErrorStdinRead {
			t.Fatalf("resolveRunPassword() error = %v, want stdin read error", err)
		}
	})
}
