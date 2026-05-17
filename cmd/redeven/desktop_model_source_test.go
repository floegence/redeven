package main

import "testing"

func TestResolveDesktopModelSourceRuntimeControlTokenFromLiteral(t *testing.T) {
	t.Parallel()

	token, err := resolveDesktopModelSourceRuntimeControlToken(" runtime-token ", "")
	if err != nil {
		t.Fatalf("resolve token: %v", err)
	}
	if token != "runtime-token" {
		t.Fatalf("token=%q", token)
	}
}

func TestResolveDesktopModelSourceRuntimeControlTokenFromEnv(t *testing.T) {
	t.Setenv("REDEVEN_TEST_RUNTIME_CONTROL_TOKEN", " env-token ")

	token, err := resolveDesktopModelSourceRuntimeControlToken("", "REDEVEN_TEST_RUNTIME_CONTROL_TOKEN")
	if err != nil {
		t.Fatalf("resolve token: %v", err)
	}
	if token != "env-token" {
		t.Fatalf("token=%q", token)
	}
}

func TestResolveDesktopModelSourceRuntimeControlTokenRejectsAmbiguousOrMissingInput(t *testing.T) {
	t.Parallel()

	if _, err := resolveDesktopModelSourceRuntimeControlToken("token", "TOKEN_ENV"); err == nil {
		t.Fatalf("expected ambiguous token error")
	}
	if _, err := resolveDesktopModelSourceRuntimeControlToken("", ""); err == nil {
		t.Fatalf("expected missing token error")
	}
}
