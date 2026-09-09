// The askpass process serves only the password inherited from its owning SSH
// process. It must never approve a host key or persist credentials.
package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

func answer(args []string, password string, output io.Writer) error {
	if len(args) != 1 {
		return fmt.Errorf("expected one SSH prompt")
	}
	prompt := strings.ToLower(strings.TrimSpace(args[0]))
	if !strings.Contains(prompt, "password:") && !strings.Contains(prompt, "passphrase") {
		return fmt.Errorf("unsupported SSH prompt")
	}
	if password == "" || strings.ContainsAny(password, "\r\n\x00") {
		return fmt.Errorf("password is unavailable")
	}
	_, err := fmt.Fprintln(output, password)
	return err
}

func main() {
	password := os.Getenv("REDEVEN_DESKTOP_SSH_PASSWORD")
	_ = os.Unsetenv("REDEVEN_DESKTOP_SSH_PASSWORD")
	if answer(os.Args[1:], password, os.Stdout) != nil {
		os.Exit(1)
	}
}
