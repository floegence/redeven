package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/accessgate"
	"golang.org/x/term"
)

var (
	errAccessPasswordVerificationFailed = errors.New("access password verification failed")
	errPasswordPromptRequiresTTY        = errors.New("password gate requires an interactive tty")
)

type runPasswordOptions struct {
	password      string
	passwordStdin bool
	passwordEnv   string
	passwordFile  string
	stdin         io.Reader
}

type resolvedRunPassword struct {
	password                   string
	requireStartupVerification bool
}

type passwordPromptTTY struct {
	file        *os.File
	shouldClose bool
}

type passwordOptionErrorKind string

const (
	passwordOptionErrorMultipleSources passwordOptionErrorKind = "multiple_sources"
	passwordOptionErrorStdinRead       passwordOptionErrorKind = "stdin_read"
	passwordOptionErrorStdinEmpty      passwordOptionErrorKind = "stdin_empty"
	passwordOptionErrorEnvNotSet       passwordOptionErrorKind = "env_not_set"
	passwordOptionErrorEnvEmpty        passwordOptionErrorKind = "env_empty"
	passwordOptionErrorFileRead        passwordOptionErrorKind = "file_read"
	passwordOptionErrorFileEmpty       passwordOptionErrorKind = "file_empty"
)

type passwordOptionError struct {
	kind    passwordOptionErrorKind
	envName string
	path    string
	cause   error
}

func (e *passwordOptionError) Error() string {
	if e == nil {
		return ""
	}
	switch e.kind {
	case passwordOptionErrorMultipleSources:
		return "use only one of --password, --password-stdin, --password-env, or --password-file"
	case passwordOptionErrorStdinRead:
		return fmt.Sprintf("read password from stdin: %v", e.cause)
	case passwordOptionErrorStdinEmpty:
		return "stdin password is empty"
	case passwordOptionErrorEnvNotSet:
		return fmt.Sprintf("password env var %q is not set", e.envName)
	case passwordOptionErrorEnvEmpty:
		return fmt.Sprintf("password env var %q is empty", e.envName)
	case passwordOptionErrorFileRead:
		return fmt.Sprintf("read password file %q: %v", e.path, e.cause)
	case passwordOptionErrorFileEmpty:
		return fmt.Sprintf("password file %q is empty", e.path)
	default:
		if e.cause != nil {
			return e.cause.Error()
		}
		return "invalid password flags"
	}
}

func (e *passwordOptionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func resolveRunPassword(opts runPasswordOptions) (resolvedRunPassword, error) {
	sourceCount := 0
	if opts.password != "" {
		sourceCount++
	}
	if opts.passwordStdin {
		sourceCount++
	}
	if strings.TrimSpace(opts.passwordEnv) != "" {
		sourceCount++
	}
	if strings.TrimSpace(opts.passwordFile) != "" {
		sourceCount++
	}
	if sourceCount > 1 {
		return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorMultipleSources}
	}
	if sourceCount == 0 {
		return resolvedRunPassword{}, nil
	}
	if opts.password != "" {
		return resolvedRunPassword{password: opts.password}, nil
	}
	if opts.passwordStdin {
		reader := opts.stdin
		if reader == nil {
			reader = os.Stdin
		}
		data, err := io.ReadAll(reader)
		if err != nil {
			return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorStdinRead, cause: err}
		}
		value := strings.TrimRight(string(data), "\r\n")
		if value == "" {
			return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorStdinEmpty}
		}
		return resolvedRunPassword{password: value}, nil
	}
	if name := strings.TrimSpace(opts.passwordEnv); name != "" {
		value, ok := os.LookupEnv(name)
		if !ok {
			return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorEnvNotSet, envName: name}
		}
		if value == "" {
			return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorEnvEmpty, envName: name}
		}
		return resolvedRunPassword{password: value, requireStartupVerification: true}, nil
	}
	path := strings.TrimSpace(opts.passwordFile)
	if path == "" {
		return resolvedRunPassword{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorFileRead, path: path, cause: err}
	}
	value := strings.TrimRight(string(data), "\r\n")
	if value == "" {
		return resolvedRunPassword{}, &passwordOptionError{kind: passwordOptionErrorFileEmpty, path: path}
	}
	return resolvedRunPassword{password: value, requireStartupVerification: true}, nil
}

func newAccessGate(password string) *accessgate.Gate {
	if password == "" {
		return nil
	}
	return accessgate.New(accessgate.Options{Password: password})
}

func verifyStartupAccessPassword(gate *accessgate.Gate, requireVerification bool) error {
	if gate == nil || !gate.Enabled() || !requireVerification {
		return nil
	}

	tty, err := openTTYForPasswordPrompt()
	if err != nil {
		return err
	}
	if tty.shouldClose {
		defer func() { _ = tty.file.Close() }()
	}

	_, _ = fmt.Fprintln(tty.file, "Access password protection is enabled.")
	_, _ = fmt.Fprint(tty.file, "Enter access password: ")
	input, err := term.ReadPassword(int(tty.file.Fd()))
	_, _ = fmt.Fprintln(tty.file)
	if err != nil {
		return fmt.Errorf("read password: %w", err)
	}
	if !gate.VerifyPassword(string(input)) {
		return errAccessPasswordVerificationFailed
	}
	return nil
}

func openTTYForPasswordPrompt() (*passwordPromptTTY, error) {
	if term.IsTerminal(int(os.Stdin.Fd())) {
		return &passwordPromptTTY{file: os.Stdin}, nil
	}
	f, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err == nil {
		return &passwordPromptTTY{file: f, shouldClose: true}, nil
	}
	return nil, errPasswordPromptRequiresTTY
}
