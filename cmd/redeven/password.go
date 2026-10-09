package main

import (
	"errors"
	"fmt"
	"io"
	"os"

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

type terminalSecretReader struct {
	isTerminal   func(int) bool
	readPassword func(int) ([]byte, error)
	promptWriter io.Writer
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

func readRuntimeLinkTicketFromStdin(reader io.Reader, terminalReader *terminalSecretReader) (string, error) {
	file, isFile := reader.(*os.File)
	if !isFile {
		return readStartupSecret(reader, "link ticket")
	}
	if terminalReader == nil {
		terminalReader = &terminalSecretReader{
			isTerminal:   term.IsTerminal,
			readPassword: term.ReadPassword,
			promptWriter: os.Stderr,
		}
	}
	if terminalReader.isTerminal == nil || !terminalReader.isTerminal(int(file.Fd())) {
		return readStartupSecret(reader, "link ticket")
	}
	if terminalReader.readPassword == nil {
		return "", &startupSecretError{kind: startupSecretErrorRead, source: "link ticket", cause: errors.New("terminal secret reader is unavailable")}
	}
	promptWriter := terminalReader.promptWriter
	if promptWriter == nil {
		promptWriter = io.Discard
	}

	_, _ = fmt.Fprint(promptWriter, "Enter link ticket: ")
	raw, err := terminalReader.readPassword(int(file.Fd()))
	_, _ = fmt.Fprintln(promptWriter)
	if err != nil {
		return "", &startupSecretError{kind: startupSecretErrorRead, source: "link ticket", cause: err}
	}
	if len(raw) > startupSecretsEnvelopeMaxLen {
		return "", &startupSecretError{kind: startupSecretErrorTooLarge, source: "link ticket"}
	}
	return string(raw), nil
}
