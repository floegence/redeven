package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/nativebridge"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

func (c *cli) nativeBridgeCmd(args []string) int {
	fs := newCLIFlagSet("native-bridge")
	stateRoot := fs.String("state-root", "", "State root of an already running Runtime (default: ~/.redeven).")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(c.stdout, "Usage: redeven native-bridge [--state-root PATH]\nAttach a native client to an already running Runtime over stdio HTTP/2.")
			return 0
		}
		fmt.Fprintln(c.stderr, "native-bridge: invalid arguments")
		return 2
	}
	if fs.NArg() != 0 {
		fmt.Fprintln(c.stderr, "native-bridge does not accept positional arguments")
		return 2
	}
	layout, err := config.LocalEnvironmentStateLayout(*stateRoot)
	if err != nil {
		fmt.Fprintln(c.stderr, "native-bridge: invalid state root")
		return 2
	}
	conn, err := net.DialTimeout("unix", layout.RuntimeControlSocketPath, 5*time.Second)
	if err != nil {
		fmt.Fprintln(c.stderr, "native-bridge: the selected Runtime is not running or is inaccessible")
		return 1
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	request, err := http.NewRequest(http.MethodPost, "http://runtime"+runtimemanagement.NativeBridgePath, nil)
	if err != nil {
		return 1
	}
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", nativebridge.ProtocolVersion)
	if err := request.Write(conn); err != nil {
		fmt.Fprintln(c.stderr, "native-bridge: Runtime connection failed")
		return 1
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil || response.StatusCode != http.StatusSwitchingProtocols || response.Header.Get("Upgrade") != nativebridge.ProtocolVersion {
		fmt.Fprintln(c.stderr, "native-bridge: this Runtime does not support the native bridge protocol")
		return 1
	}
	_ = conn.SetDeadline(time.Time{})
	// EOF on SSH stdin releases this bridge, never the running Runtime.
	go func() { _, _ = io.Copy(conn, c.stdin); _ = conn.Close() }()
	if _, err := io.Copy(c.stdout, reader); err != nil && !errors.Is(err, net.ErrClosed) {
		fmt.Fprintln(c.stderr, "native-bridge: connection closed")
		return 1
	}
	return 0
}
