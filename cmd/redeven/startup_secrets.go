package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	localUIPasswordEnvName       = "REDEVEN_LOCAL_UI_PASSWORD"
	bootstrapTicketEnvName       = "REDEVEN_BOOTSTRAP_TICKET"
	legacyDesktopTicketEnvName   = "REDEVEN_DESKTOP_BOOTSTRAP_TICKET"
	startupSecretsEnvelopeMaxLen = 64 << 10
)

type startupSecretSource string

const (
	startupSecretSourceNone            startupSecretSource = ""
	startupSecretSourcePrompt          startupSecretSource = "prompt"
	startupSecretSourceStdin           startupSecretSource = "stdin"
	startupSecretSourceFile            startupSecretSource = "file"
	startupSecretSourceEnvironment     startupSecretSource = "environment"
	startupSecretSourceDesktopEnvelope startupSecretSource = "desktop_envelope"
)

type resolvedStartupSecret struct {
	value  string
	source startupSecretSource
}

type resolvedStartupSecrets struct {
	localUIPassword resolvedStartupSecret
	bootstrapTicket resolvedStartupSecret
}

type startupSecretsOptions struct {
	passwordPrompt         bool
	passwordStdin          bool
	passwordFile           string
	bootstrapTicketStdin   bool
	bootstrapTicketFile    string
	startupSecretsStdin    bool
	stdin                  io.Reader
	environment            *startupSecretEnvironment
	promptPassword         func() (string, error)
	usePasswordEnv         bool
	useBootstrapTicketEnv  bool
	desktopEnvelopeAllowed bool
	terminalSecretReader   *terminalSecretReader
}

type startupSecretEnvironment struct {
	localUIPassword    string
	localUIPasswordSet bool
	bootstrapTicket    string
	bootstrapTicketSet bool
}

type startupSecretsEnvelope struct {
	Version         int     `json:"version"`
	LocalUIPassword *string `json:"local_ui_password,omitempty"`
	BootstrapTicket *string `json:"bootstrap_ticket,omitempty"`
}

type startupSecretErrorKind string

const (
	startupSecretErrorPasswordSources  startupSecretErrorKind = "password_sources"
	startupSecretErrorTicketSources    startupSecretErrorKind = "ticket_sources"
	startupSecretErrorStdinConflict    startupSecretErrorKind = "stdin_conflict"
	startupSecretErrorEnvelopeConflict startupSecretErrorKind = "envelope_conflict"
	startupSecretErrorEnvelopeMode     startupSecretErrorKind = "envelope_mode"
	startupSecretErrorRead             startupSecretErrorKind = "read"
	startupSecretErrorEmpty            startupSecretErrorKind = "empty"
	startupSecretErrorTooLarge         startupSecretErrorKind = "too_large"
	startupSecretErrorEnvelope         startupSecretErrorKind = "envelope"
	startupSecretErrorPrompt           startupSecretErrorKind = "prompt"
)

type startupSecretError struct {
	kind   startupSecretErrorKind
	source string
	path   string
	cause  error
}

func (e *startupSecretError) Error() string {
	if e == nil {
		return ""
	}
	switch e.kind {
	case startupSecretErrorPasswordSources:
		return "use only one of --password-prompt, --password-stdin, or --password-file"
	case startupSecretErrorTicketSources:
		return "use only one of --bootstrap-ticket-stdin or --bootstrap-ticket-file"
	case startupSecretErrorStdinConflict:
		return "password and bootstrap ticket cannot both read the same stdin stream"
	case startupSecretErrorEnvelopeConflict:
		return "--startup-secrets-stdin cannot be combined with another secret source"
	case startupSecretErrorEnvelopeMode:
		return "--startup-secrets-stdin is only available to Desktop-managed machine startup"
	case startupSecretErrorRead:
		if e.path != "" {
			return fmt.Sprintf("read %s file %q: %v", e.source, e.path, e.cause)
		}
		return fmt.Sprintf("read %s from stdin: %v", e.source, e.cause)
	case startupSecretErrorEmpty:
		return fmt.Sprintf("%s is empty", e.source)
	case startupSecretErrorTooLarge:
		return fmt.Sprintf("%s exceeds the 64 KiB startup secret limit", e.source)
	case startupSecretErrorEnvelope:
		return fmt.Sprintf("invalid startup secrets envelope: %v", e.cause)
	case startupSecretErrorPrompt:
		return fmt.Sprintf("read Local UI password from prompt: %v", e.cause)
	default:
		return "invalid startup secret options"
	}
}

func (e *startupSecretError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func resolveStartupSecrets(opts startupSecretsOptions) (resolvedStartupSecrets, error) {
	environment := opts.environment
	if environment == nil {
		captured := captureAndUnsetStartupSecretEnvironment()
		environment = &captured
	}
	passwordEnv := environment.localUIPassword
	passwordEnvSet := environment.localUIPasswordSet
	ticketEnv := environment.bootstrapTicket
	ticketEnvSet := environment.bootstrapTicketSet

	passwordExplicitCount := countTrue(opts.passwordPrompt, opts.passwordStdin, strings.TrimSpace(opts.passwordFile) != "")
	ticketExplicitCount := countTrue(opts.bootstrapTicketStdin, strings.TrimSpace(opts.bootstrapTicketFile) != "")
	if passwordExplicitCount > 1 {
		return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorPasswordSources}
	}
	if ticketExplicitCount > 1 {
		return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorTicketSources}
	}
	if opts.passwordStdin && opts.bootstrapTicketStdin {
		return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorStdinConflict}
	}

	if opts.startupSecretsStdin {
		if !opts.desktopEnvelopeAllowed {
			return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEnvelopeMode}
		}
		if passwordExplicitCount > 0 || ticketExplicitCount > 0 || passwordEnvSet || ticketEnvSet {
			return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEnvelopeConflict}
		}
		return resolveStartupSecretsEnvelope(readerOrStdin(opts.stdin))
	}

	var resolved resolvedStartupSecrets
	var err error
	resolved.localUIPassword, err = resolveLocalUIPassword(opts, passwordEnv, passwordEnvSet)
	if err != nil {
		return resolvedStartupSecrets{}, err
	}
	resolved.bootstrapTicket, err = resolveBootstrapTicket(opts, ticketEnv, ticketEnvSet)
	if err != nil {
		return resolvedStartupSecrets{}, err
	}
	return resolved, nil
}

func captureAndUnsetStartupSecretEnvironment() startupSecretEnvironment {
	password, passwordSet := os.LookupEnv(localUIPasswordEnvName)
	ticket, ticketSet := os.LookupEnv(bootstrapTicketEnvName)
	for _, name := range []string{localUIPasswordEnvName, bootstrapTicketEnvName, legacyDesktopTicketEnvName} {
		_ = os.Unsetenv(name)
	}
	ticket = strings.TrimSpace(ticket)
	return startupSecretEnvironment{
		localUIPassword:    password,
		localUIPasswordSet: passwordSet && password != "",
		bootstrapTicket:    ticket,
		bootstrapTicketSet: ticketSet && ticket != "",
	}
}

func resolveLocalUIPassword(opts startupSecretsOptions, envValue string, envSet bool) (resolvedStartupSecret, error) {
	switch {
	case opts.passwordPrompt:
		prompt := opts.promptPassword
		if prompt == nil {
			prompt = promptForLocalUIPassword
		}
		value, err := prompt()
		if err != nil {
			return resolvedStartupSecret{}, &startupSecretError{kind: startupSecretErrorPrompt, source: "Local UI password", cause: err}
		}
		if value == "" {
			return resolvedStartupSecret{}, &startupSecretError{kind: startupSecretErrorEmpty, source: "prompted Local UI password"}
		}
		return resolvedStartupSecret{value: value, source: startupSecretSourcePrompt}, nil
	case opts.passwordStdin:
		value, err := readStartupSecret(readerOrStdin(opts.stdin), "Local UI password")
		if err != nil {
			return resolvedStartupSecret{}, err
		}
		value = strings.TrimRight(value, "\r\n")
		if value == "" {
			return resolvedStartupSecret{}, &startupSecretError{kind: startupSecretErrorEmpty, source: "stdin Local UI password"}
		}
		return resolvedStartupSecret{value: value, source: startupSecretSourceStdin}, nil
	case strings.TrimSpace(opts.passwordFile) != "":
		path := strings.TrimSpace(opts.passwordFile)
		value, err := readStartupSecretFile(path, "Local UI password")
		if err != nil {
			return resolvedStartupSecret{}, err
		}
		value = strings.TrimRight(value, "\r\n")
		if value == "" {
			return resolvedStartupSecret{}, &startupSecretError{kind: startupSecretErrorEmpty, source: "Local UI password file"}
		}
		return resolvedStartupSecret{value: value, source: startupSecretSourceFile}, nil
	case opts.usePasswordEnv && envSet:
		return resolvedStartupSecret{value: envValue, source: startupSecretSourceEnvironment}, nil
	default:
		return resolvedStartupSecret{}, nil
	}
}

func resolveBootstrapTicket(opts startupSecretsOptions, envValue string, envSet bool) (resolvedStartupSecret, error) {
	var value string
	var source startupSecretSource
	switch {
	case opts.bootstrapTicketStdin:
		readValue, err := readBootstrapTicketFromStdin(readerOrStdin(opts.stdin), opts.terminalSecretReader)
		if err != nil {
			return resolvedStartupSecret{}, err
		}
		value, source = readValue, startupSecretSourceStdin
	case strings.TrimSpace(opts.bootstrapTicketFile) != "":
		path := strings.TrimSpace(opts.bootstrapTicketFile)
		readValue, err := readStartupSecretFile(path, "bootstrap ticket")
		if err != nil {
			return resolvedStartupSecret{}, err
		}
		value, source = readValue, startupSecretSourceFile
	case opts.useBootstrapTicketEnv && envSet:
		value, source = envValue, startupSecretSourceEnvironment
	default:
		return resolvedStartupSecret{}, nil
	}

	value = normalizeBootstrapTicket(value)
	if value == "" {
		return resolvedStartupSecret{}, &startupSecretError{kind: startupSecretErrorEmpty, source: "bootstrap ticket"}
	}
	return resolvedStartupSecret{value: value, source: source}, nil
}

func resolveStartupSecretsEnvelope(reader io.Reader) (resolvedStartupSecrets, error) {
	raw, err := readLimitedStartupSecret(reader)
	if err != nil {
		return resolvedStartupSecrets{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var envelope startupSecretsEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEnvelope, cause: err}
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEnvelope, cause: err}
	}
	if envelope.Version != 1 {
		return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEnvelope, cause: fmt.Errorf("unsupported version %d", envelope.Version)}
	}

	var resolved resolvedStartupSecrets
	if envelope.LocalUIPassword != nil {
		if *envelope.LocalUIPassword == "" {
			return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEmpty, source: "Desktop envelope Local UI password"}
		}
		resolved.localUIPassword = resolvedStartupSecret{value: *envelope.LocalUIPassword, source: startupSecretSourceDesktopEnvelope}
	}
	if envelope.BootstrapTicket != nil {
		ticket := normalizeBootstrapTicket(*envelope.BootstrapTicket)
		if ticket == "" {
			return resolvedStartupSecrets{}, &startupSecretError{kind: startupSecretErrorEmpty, source: "Desktop envelope bootstrap ticket"}
		}
		resolved.bootstrapTicket = resolvedStartupSecret{value: ticket, source: startupSecretSourceDesktopEnvelope}
	}
	return resolved, nil
}

func readStartupSecretFile(path string, label string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", &startupSecretError{kind: startupSecretErrorRead, source: label, path: path, cause: err}
	}
	defer f.Close()
	value, err := readStartupSecret(f, label)
	if secretErr := (*startupSecretError)(nil); errors.As(err, &secretErr) && secretErr.path == "" {
		secretErr.path = path
	}
	return value, err
}

func readStartupSecret(reader io.Reader, label string) (string, error) {
	raw, err := readLimitedStartupSecret(reader)
	if err != nil {
		var secretErr *startupSecretError
		if errors.As(err, &secretErr) && secretErr.source == "startup secrets envelope" {
			secretErr.source = label
		}
		return "", err
	}
	return string(raw), nil
}

func readLimitedStartupSecret(reader io.Reader) ([]byte, error) {
	limited := io.LimitReader(reader, startupSecretsEnvelopeMaxLen+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, &startupSecretError{kind: startupSecretErrorRead, source: "startup secrets envelope", cause: err}
	}
	if len(raw) > startupSecretsEnvelopeMaxLen {
		return nil, &startupSecretError{kind: startupSecretErrorTooLarge, source: "startup secrets envelope"}
	}
	return raw, nil
}

func readerOrStdin(reader io.Reader) io.Reader {
	if reader != nil {
		return reader
	}
	return os.Stdin
}

func normalizeBootstrapTicket(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= len("Bearer ") && strings.EqualFold(value[:len("Bearer ")], "Bearer ") {
		value = strings.TrimSpace(value[len("Bearer "):])
	}
	return value
}

func countTrue(values ...bool) int {
	count := 0
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}
