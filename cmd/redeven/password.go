package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/floegence/redeven/internal/accessgate"
	"golang.org/x/term"
)

var (
	errPasswordPromptRequiresTTY = errors.New("password prompt requires an interactive tty")
	errPasswordPromptMismatch    = errors.New("password confirmation does not match")
)

type passwordPromptTTY struct {
	file        *os.File
	shouldClose bool
}

func newAccessGate(password string) *accessgate.Gate {
	if password == "" {
		return nil
	}
	return accessgate.New(accessgate.Options{Password: password})
}

func promptForLocalUIPassword() (string, error) {
	tty, err := openTTYForPasswordPrompt()
	if err != nil {
		return "", err
	}
	if tty.shouldClose {
		defer func() { _ = tty.file.Close() }()
	}

	_, _ = fmt.Fprint(tty.file, "Enter Local UI password: ")
	password, err := term.ReadPassword(int(tty.file.Fd()))
	_, _ = fmt.Fprintln(tty.file)
	if err != nil {
		return "", fmt.Errorf("read password: %w", err)
	}
	if len(password) == 0 {
		return "", errors.New("prompted password is empty")
	}

	_, _ = fmt.Fprint(tty.file, "Confirm Local UI password: ")
	confirmation, err := term.ReadPassword(int(tty.file.Fd()))
	_, _ = fmt.Fprintln(tty.file)
	if err != nil {
		return "", fmt.Errorf("read password confirmation: %w", err)
	}
	if string(password) != string(confirmation) {
		return "", errPasswordPromptMismatch
	}
	return string(password), nil
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
