package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	"golang.org/x/term"
)

const securityHelp = "Usage: redeven security setup|recover --state-root <path> [--recovery-file <new-private-file>]\nStop this Runtime before using host security commands. Setup uses the attached terminal; secrets are never accepted as command arguments.\n"

func (c *cli) securityCmd(args []string) int {
	const usage = securityHelp
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, usage)
		return 0
	}
	if args[0] != "setup" && args[0] != "recover" {
		writeText(c.stderr, usage)
		return 2
	}
	flags := newCLIFlagSet("security " + args[0])
	root := flags.String("state-root", "", "Exact environment state root")
	output := flags.String("recovery-file", "", "New recovery code file (0600)")
	if err := parseCommandFlags(flags, args[1:]); err != nil || strings.TrimSpace(*root) == "" {
		writeText(c.stderr, usage)
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*root)
	if err != nil {
		writeText(c.stderr, err.Error()+"\n")
		return 1
	}
	if err = os.MkdirAll(layout.StateDir, 0o700); err != nil {
		writeText(c.stderr, err.Error()+"\n")
		return 1
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			writeText(c.stderr, "Stop this Runtime before host recovery or setup.\n")
		} else {
			writeText(c.stderr, "Cannot access the environment state: "+err.Error()+"\n")
		}
		return 1
	}
	defer func() { _ = lock.Release() }()
	gate, err := accessgate.OpenPersistent(layout.StateDir)
	if err != nil {
		writeText(c.stderr, err.Error()+"\n")
		return 1
	}
	defer gate.Close()
	tty, err := openTTYForPasswordPrompt()
	if err != nil {
		writeText(c.stderr, "Security setup and recovery require an interactive owner terminal.\n")
		return 1
	}
	if tty.shouldClose {
		defer tty.file.Close()
	}
	read := func(label string) (string, error) {
		_, _ = fmt.Fprint(tty.file, label+": ")
		raw, e := term.ReadPassword(int(tty.file.Fd()))
		_, _ = fmt.Fprintln(tty.file)
		return string(raw), e
	}
	fail := func(e error) int { writeText(c.stderr, e.Error()+"\n"); return 1 }
	if args[0] == "recover" {
		answer, e := read("Type RECOVER to revoke browser and direct URL access")
		if e != nil {
			return fail(e)
		}
		if answer != "RECOVER" {
			return fail(errors.New("recovery canceled"))
		}
		if _, err = gate.Manage("host-owner", "Environment", accessgate.SecurityRequest{Action: "recover"}); err != nil {
			return fail(err)
		}
		writeText(c.stdout, "Browser and direct URL access is locked. Run security setup to set a new environment password and authenticator.\n")
		return 0
	}
	if *output == "" {
		return fail(errors.New("--recovery-file is required; choose a new private file"))
	}
	access, err := config.ReadEnvironmentCatalogAccess(layout)
	if err != nil {
		return fail(err)
	}
	if access == nil || access.LocalUIProtocol != config.LocalUIProtocolHTTPS {
		return fail(errors.New("configure HTTPS for this environment before enabling two-factor authentication"))
	}
	state := gate.SecurityStatus()
	request := accessgate.SecurityRequest{Action: "setup"}
	if !state.PasswordConfigured || state.RecoveryPending {
		request.Password, err = read("New environment password")
		if err != nil {
			return fail(err)
		}
		confirmation, e := read("Confirm environment password")
		if e != nil {
			return fail(e)
		}
		if confirmation != request.Password {
			return fail(errors.New("passwords do not match"))
		}
	} else if state.Enabled {
		request.Action = "replace"
		request.Password, err = read("Environment password")
		if err != nil {
			return fail(err)
		}
		request.Code, err = read("Current authenticator code")
		if err != nil {
			return fail(err)
		}
	}
	setup, err := gate.Manage("host-owner", "Environment", request)
	if err != nil {
		return fail(err)
	}
	// Secrets go only to the attached owner terminal, never redirected stdout.
	_, _ = fmt.Fprintln(tty.file, "Add a time-based account in your authenticator. Issuer: Redeven")
	_, _ = fmt.Fprintln(tty.file, "Setup key: "+setup.Secret)
	code, err := read("Authenticator code")
	if err != nil {
		return fail(err)
	}
	verified, err := gate.Manage("host-owner", "Environment", accessgate.SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code})
	if err != nil {
		return fail(err)
	}
	file, err := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fail(err)
	}
	_, err = file.WriteString(strings.Join(verified.RecoveryCodes, "\n") + "\n")
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return fail(err)
	}
	answer, err := read("Recovery codes saved. Type ENABLE to activate two-factor authentication")
	if err != nil {
		return fail(err)
	}
	if answer != "ENABLE" {
		return fail(errors.New("setup canceled; existing authentication is unchanged"))
	}
	if _, err = gate.Manage("host-owner", "Environment", accessgate.SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
		return fail(err)
	}
	writeText(c.stdout, "Two-factor authentication enabled. Start Runtime to accept HTTPS connections.\n")
	return 0
}
