package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/diagnostics"
)

type failingReader struct{}

func (failingReader) Read(_ []byte) (int, error) {
	return 0, errors.New("boom")
}

func TestRecordStartupSecretSourcesDoesNotPersistSecretMaterial(t *testing.T) {
	stateDir := t.TempDir()
	recordStartupSecretSources(stateDir, resolvedStartupSecrets{
		localUIPassword: resolvedStartupSecret{value: "password-secret", source: startupSecretSourceEnvironment},
		bootstrapTicket: resolvedStartupSecret{value: "ticket-secret", source: startupSecretSourceStdin},
	})
	events, err := diagnostics.ListSource(stateDir, diagnostics.SourceAgent, 10)
	if err != nil {
		t.Fatalf("ListSource() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %#v", events)
	}
	if events[0].Detail["local_ui_access_source"] != "environment" || events[0].Detail["provider_bootstrap_source"] != "stdin" {
		t.Fatalf("detail = %#v", events[0].Detail)
	}
	body, err := os.ReadFile(filepath.Join(stateDir, "diagnostics", "agent-events.jsonl"))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.Contains(string(body), "password-secret") || strings.Contains(string(body), "ticket-secret") {
		t.Fatalf("diagnostics leaked secret material: %s", body)
	}
}

func TestResolveStartupSecrets(t *testing.T) {
	clearStartupSecretEnvironment(t)

	t.Run("reads password from stdin without trimming spaces", func(t *testing.T) {
		resolved, err := resolveStartupSecrets(startupSecretsOptions{
			passwordStdin: true,
			stdin:         strings.NewReader("  secret value  \n"),
		})
		if err != nil {
			t.Fatalf("resolveStartupSecrets() error = %v", err)
		}
		if resolved.localUIPassword.value != "  secret value  " || resolved.localUIPassword.source != startupSecretSourceStdin {
			t.Fatalf("localUIPassword = %#v", resolved.localUIPassword)
		}
	})

	t.Run("explicit password source overrides and unsets fixed environment", func(t *testing.T) {
		t.Setenv(localUIPasswordEnvName, "environment-secret")
		t.Setenv(bootstrapTicketEnvName, "environment-ticket")
		resolved, err := resolveStartupSecrets(startupSecretsOptions{
			passwordFile:   writeStartupSecretTestFile(t, "file-secret\n"),
			usePasswordEnv: true,
		})
		if err != nil {
			t.Fatalf("resolveStartupSecrets() error = %v", err)
		}
		if resolved.localUIPassword.value != "file-secret" || resolved.localUIPassword.source != startupSecretSourceFile {
			t.Fatalf("localUIPassword = %#v", resolved.localUIPassword)
		}
		assertStartupSecretEnvironmentUnset(t)
	})

	t.Run("uses fixed environment fallbacks and preserves raw password", func(t *testing.T) {
		t.Setenv(localUIPasswordEnvName, "  raw password  ")
		t.Setenv(bootstrapTicketEnvName, "  Bearer ticket-value  ")
		resolved, err := resolveStartupSecrets(startupSecretsOptions{
			usePasswordEnv:        true,
			useBootstrapTicketEnv: true,
		})
		if err != nil {
			t.Fatalf("resolveStartupSecrets() error = %v", err)
		}
		if resolved.localUIPassword.value != "  raw password  " || resolved.localUIPassword.source != startupSecretSourceEnvironment {
			t.Fatalf("localUIPassword = %#v", resolved.localUIPassword)
		}
		if resolved.bootstrapTicket.value != "ticket-value" || resolved.bootstrapTicket.source != startupSecretSourceEnvironment {
			t.Fatalf("bootstrapTicket = %#v", resolved.bootstrapTicket)
		}
		assertStartupSecretEnvironmentUnset(t)
	})

	t.Run("treats empty fixed environment values as unset", func(t *testing.T) {
		t.Setenv(localUIPasswordEnvName, "")
		t.Setenv(bootstrapTicketEnvName, "  ")
		resolved, err := resolveStartupSecrets(startupSecretsOptions{
			usePasswordEnv:        true,
			useBootstrapTicketEnv: true,
		})
		if err != nil {
			t.Fatalf("resolveStartupSecrets() error = %v", err)
		}
		if resolved.localUIPassword.source != startupSecretSourceNone || resolved.bootstrapTicket.source != startupSecretSourceNone {
			t.Fatalf("resolved = %#v", resolved)
		}
	})

	t.Run("rejects password and ticket sharing stdin", func(t *testing.T) {
		_, err := resolveStartupSecrets(startupSecretsOptions{
			passwordStdin:        true,
			bootstrapTicketStdin: true,
			stdin:                strings.NewReader("secret"),
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorStdinConflict)
	})

	t.Run("returns a dedicated read error", func(t *testing.T) {
		_, err := resolveStartupSecrets(startupSecretsOptions{
			passwordStdin: true,
			stdin:         failingReader{},
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorRead)
	})

	t.Run("uses the hidden prompt source", func(t *testing.T) {
		resolved, err := resolveStartupSecrets(startupSecretsOptions{
			passwordPrompt: true,
			promptPassword: func() (string, error) { return "prompt-secret", nil },
		})
		if err != nil {
			t.Fatalf("resolveStartupSecrets() error = %v", err)
		}
		if resolved.localUIPassword.value != "prompt-secret" || resolved.localUIPassword.source != startupSecretSourcePrompt {
			t.Fatalf("localUIPassword = %#v", resolved.localUIPassword)
		}
	})
}

func TestReadBootstrapTicketFromStdin(t *testing.T) {
	t.Run("keeps pipe and redirect input prompt free", func(t *testing.T) {
		value, err := readBootstrapTicketFromStdin(strings.NewReader("Bearer piped-ticket\n"), nil)
		if err != nil {
			t.Fatalf("readBootstrapTicketFromStdin() error = %v", err)
		}
		if value != "Bearer piped-ticket\n" {
			t.Fatalf("value = %q", value)
		}
	})

	t.Run("hides interactive terminal input and writes a prompt", func(t *testing.T) {
		terminal, err := os.CreateTemp(t.TempDir(), "terminal")
		if err != nil {
			t.Fatalf("CreateTemp() error = %v", err)
		}
		defer terminal.Close()

		var prompt bytes.Buffer
		value, err := readBootstrapTicketFromStdin(terminal, &terminalSecretReader{
			isTerminal: func(int) bool { return true },
			readPassword: func(int) ([]byte, error) {
				return []byte("Bearer interactive-ticket"), nil
			},
			promptWriter: &prompt,
		})
		if err != nil {
			t.Fatalf("readBootstrapTicketFromStdin() error = %v", err)
		}
		if value != "Bearer interactive-ticket" {
			t.Fatalf("value = %q", value)
		}
		if prompt.String() != "Enter bootstrap ticket: \n" {
			t.Fatalf("prompt = %q", prompt.String())
		}
		if strings.Contains(prompt.String(), "interactive-ticket") {
			t.Fatalf("prompt leaked the ticket: %q", prompt.String())
		}
	})

	t.Run("enforces the size limit for interactive input", func(t *testing.T) {
		terminal, err := os.CreateTemp(t.TempDir(), "terminal")
		if err != nil {
			t.Fatalf("CreateTemp() error = %v", err)
		}
		defer terminal.Close()
		_, err = readBootstrapTicketFromStdin(terminal, &terminalSecretReader{
			isTerminal: func(int) bool { return true },
			readPassword: func(int) ([]byte, error) {
				return []byte(strings.Repeat("x", startupSecretsEnvelopeMaxLen+1)), nil
			},
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorTooLarge)
	})

	t.Run("maps interactive read failures to a bootstrap ticket error", func(t *testing.T) {
		terminal, err := os.CreateTemp(t.TempDir(), "terminal")
		if err != nil {
			t.Fatalf("CreateTemp() error = %v", err)
		}
		defer terminal.Close()
		_, err = readBootstrapTicketFromStdin(terminal, &terminalSecretReader{
			isTerminal: func(int) bool { return true },
			readPassword: func(int) ([]byte, error) {
				return nil, errors.New("boom")
			},
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorRead)
	})
}

func TestResolveStartupSecretsEnvelope(t *testing.T) {
	clearStartupSecretEnvironment(t)

	t.Run("reads both Desktop secrets from one versioned envelope", func(t *testing.T) {
		resolved, err := resolveStartupSecrets(startupSecretsOptions{
			startupSecretsStdin:    true,
			desktopEnvelopeAllowed: true,
			stdin:                  strings.NewReader(`{"version":1,"local_ui_password":" raw password ","bootstrap_ticket":"Bearer ticket-value"}`),
		})
		if err != nil {
			t.Fatalf("resolveStartupSecrets() error = %v", err)
		}
		if resolved.localUIPassword.value != " raw password " || resolved.localUIPassword.source != startupSecretSourceDesktopEnvelope {
			t.Fatalf("localUIPassword = %#v", resolved.localUIPassword)
		}
		if resolved.bootstrapTicket.value != "ticket-value" || resolved.bootstrapTicket.source != startupSecretSourceDesktopEnvelope {
			t.Fatalf("bootstrapTicket = %#v", resolved.bootstrapTicket)
		}
	})

	t.Run("rejects fixed environment conflicts", func(t *testing.T) {
		t.Setenv(localUIPasswordEnvName, "environment-secret")
		_, err := resolveStartupSecrets(startupSecretsOptions{
			startupSecretsStdin:    true,
			desktopEnvelopeAllowed: true,
			stdin:                  strings.NewReader(`{"version":1}`),
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorEnvelopeConflict)
		assertStartupSecretEnvironmentUnset(t)
	})

	t.Run("rejects non Desktop use", func(t *testing.T) {
		_, err := resolveStartupSecrets(startupSecretsOptions{
			startupSecretsStdin: true,
			stdin:               strings.NewReader(`{"version":1}`),
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorEnvelopeMode)
	})

	t.Run("rejects unknown fields and unsupported versions", func(t *testing.T) {
		for _, raw := range []string{
			`{"version":1,"unexpected":"value"}`,
			`{"version":2}`,
		} {
			_, err := resolveStartupSecrets(startupSecretsOptions{
				startupSecretsStdin:    true,
				desktopEnvelopeAllowed: true,
				stdin:                  strings.NewReader(raw),
			})
			assertStartupSecretErrorKind(t, err, startupSecretErrorEnvelope)
		}
	})

	t.Run("rejects envelopes larger than 64 KiB", func(t *testing.T) {
		_, err := resolveStartupSecrets(startupSecretsOptions{
			startupSecretsStdin:    true,
			desktopEnvelopeAllowed: true,
			stdin:                  strings.NewReader(strings.Repeat("x", startupSecretsEnvelopeMaxLen+1)),
		})
		assertStartupSecretErrorKind(t, err, startupSecretErrorTooLarge)
	})
}

func writeStartupSecretTestFile(t *testing.T, value string) string {
	t.Helper()
	path := t.TempDir() + "/secret"
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}

func clearStartupSecretEnvironment(t *testing.T) {
	t.Helper()
	for _, name := range []string{localUIPasswordEnvName, bootstrapTicketEnvName, legacyDesktopTicketEnvName} {
		t.Setenv(name, "")
		_ = os.Unsetenv(name)
	}
}

func assertStartupSecretEnvironmentUnset(t *testing.T) {
	t.Helper()
	for _, name := range []string{localUIPasswordEnvName, bootstrapTicketEnvName, legacyDesktopTicketEnvName} {
		if _, ok := os.LookupEnv(name); ok {
			t.Fatalf("%s remains set", name)
		}
	}
}

func assertStartupSecretErrorKind(t *testing.T, err error, kind startupSecretErrorKind) {
	t.Helper()
	var secretErr *startupSecretError
	if !errors.As(err, &secretErr) || secretErr.kind != kind {
		t.Fatalf("error = %v, want startup secret error %q", err, kind)
	}
}
