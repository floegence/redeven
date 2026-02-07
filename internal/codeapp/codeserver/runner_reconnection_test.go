package codeserver

import (
	"testing"
	"time"
)

func TestResolveReconnectionGraceDefault(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 30*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want 30s", got)
	}
}

func TestResolveReconnectionGraceFromEnv(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "45s")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 45*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want 45s", got)
	}
}

func TestResolveReconnectionGraceInvalidEnvFallsBack(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "bad-value")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 30*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want fallback 30s", got)
	}
}

func TestResolveReconnectionGraceNonPositiveEnvFallsBack(t *testing.T) {
	t.Setenv("REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME", "0s")

	r := &Runner{reconnectionGrace: 30 * time.Second}
	if got := r.resolveReconnectionGrace(); got != 30*time.Second {
		t.Fatalf("resolveReconnectionGrace() = %s, want fallback 30s", got)
	}
}

func TestFormatReconnectionGraceMilliseconds(t *testing.T) {
	if got := formatReconnectionGraceMilliseconds(1500 * time.Millisecond); got != "1500ms" {
		t.Fatalf("formatReconnectionGraceMilliseconds() = %q, want %q", got, "1500ms")
	}
	if got := formatReconnectionGraceMilliseconds(0); got != "" {
		t.Fatalf("formatReconnectionGraceMilliseconds() = %q, want empty", got)
	}
}

func TestFormatReconnectionGraceCLISeconds(t *testing.T) {
	if got := formatReconnectionGraceCLISeconds(30 * time.Second); got != "30" {
		t.Fatalf("formatReconnectionGraceCLISeconds() = %q, want %q", got, "30")
	}
	if got := formatReconnectionGraceCLISeconds(1500 * time.Millisecond); got != "1.5" {
		t.Fatalf("formatReconnectionGraceCLISeconds() = %q, want %q", got, "1.5")
	}
	if got := formatReconnectionGraceCLISeconds(10 * time.Millisecond); got != "0.01" {
		t.Fatalf("formatReconnectionGraceCLISeconds() = %q, want %q", got, "0.01")
	}
	if got := formatReconnectionGraceCLISeconds(0); got != "" {
		t.Fatalf("formatReconnectionGraceCLISeconds() = %q, want empty", got)
	}
}
