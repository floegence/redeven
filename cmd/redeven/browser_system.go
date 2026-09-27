package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/browserinstall"
)

// The terminal belongs to the user. sudo reads authorization from its controlling
// terminal; no password is accepted by the API, command flags or Runtime logs.
func (c *cli) browserSystemAuthorizeCmd(args []string) int {
	if runtime.GOOS != "linux" || len(args) != 1 || !filepath.IsAbs(args[0]) || filepath.Base(args[0]) != "authorize" {
		return 2
	}
	info, err := os.Lstat(filepath.Dir(args[0]))
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return 2
	}
	conn, err := net.DialTimeout("unix", args[0], 5*time.Second)
	if err != nil {
		fmt.Fprintln(c.stderr, "Browser setup request is no longer active. Start system preparation again.")
		return 1
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	// Read only the bounded header; archive bytes must remain on the original
	// socket FD inherited by the one-shot privileged command.
	var header []byte
	for len(header) < 1024 {
		var b [1]byte
		if _, err = io.ReadFull(conn, b[:]); err != nil {
			return 1
		}
		if b[0] == '\n' {
			break
		}
		header = append(header, b[0])
	}
	var request struct {
		PackageID string `json:"package_id"`
	}
	pkg, err := browserinstall.NativePackage()
	if err != nil || json.Unmarshal(header, &request) != nil || request.PackageID != pkg.ID {
		return 1
	}
	_ = conn.SetReadDeadline(time.Time{})
	file, err := conn.(*net.UnixConn).File()
	if err != nil {
		return 1
	}
	defer file.Close()
	executable, err := os.Executable()
	if err != nil {
		return 1
	}
	fmt.Fprintln(c.stdout, "Authorize preparation of the built-in browser for this device. Website data will be preserved.")
	command := exec.Command("sudo", "--", executable, "browser-system-install", pkg.ID)
	command.Stdin, command.Stdout, command.Stderr = file, file, c.stderr
	if err = command.Run(); err != nil {
		fmt.Fprintln(c.stderr, "Browser system preparation was cancelled or failed. Check its status in Redeven.")
		return 1
	}
	fmt.Fprintln(c.stdout, "Browser system preparation completed.")
	return 0
}

func (c *cli) browserSystemInstallCmd(args []string) int {
	if len(args) != 1 {
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	ctx, timeout := context.WithTimeout(ctx, 15*time.Minute)
	defer timeout()
	if input, ok := c.stdin.(io.Closer); ok {
		stop := context.AfterFunc(ctx, func() { _ = input.Close() })
		defer stop()
	}
	if err := browserinstall.InstallSystemBrowser(ctx, args[0], c.stdin, c.stdout); err != nil {
		fmt.Fprintln(c.stderr, "Browser system preparation did not complete:", err)
		return 1
	}
	return 0
}
