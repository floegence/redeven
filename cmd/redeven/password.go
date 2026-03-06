package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/floegence/redeven-agent/internal/accessgate"
	"golang.org/x/term"
)

type runPasswordOptions struct {
	password     string
	passwordEnv  string
	passwordFile string
}

type resolvedRunPassword struct {
	password                   string
	requireStartupVerification bool
}

type passwordPromptTTY struct {
	file        *os.File
	shouldClose bool
}

func resolveRunPassword(opts runPasswordOptions) (resolvedRunPassword, error) {
	sourceCount := 0
	if opts.password != "" {
		sourceCount++
	}
	if strings.TrimSpace(opts.passwordEnv) != "" {
		sourceCount++
	}
	if strings.TrimSpace(opts.passwordFile) != "" {
		sourceCount++
	}
	if sourceCount > 1 {
		return resolvedRunPassword{}, errors.New("use only one of --password, --password-env, or --password-file")
	}
	if sourceCount == 0 {
		return resolvedRunPassword{}, nil
	}
	if opts.password != "" {
		return resolvedRunPassword{password: opts.password}, nil
	}
	if name := strings.TrimSpace(opts.passwordEnv); name != "" {
		value, ok := os.LookupEnv(name)
		if !ok {
			return resolvedRunPassword{}, fmt.Errorf("password env var %q is not set", name)
		}
		if value == "" {
			return resolvedRunPassword{}, fmt.Errorf("password env var %q is empty", name)
		}
		return resolvedRunPassword{password: value, requireStartupVerification: true}, nil
	}
	path := strings.TrimSpace(opts.passwordFile)
	if path == "" {
		return resolvedRunPassword{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return resolvedRunPassword{}, fmt.Errorf("read password file: %w", err)
	}
	value := strings.TrimRight(string(data), "\r\n")
	if value == "" {
		return resolvedRunPassword{}, fmt.Errorf("password file %q is empty", path)
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
		return errors.New("access password verification failed")
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
	return nil, errors.New("password gate requires an interactive tty")
}
