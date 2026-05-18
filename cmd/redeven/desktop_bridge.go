package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

func (c *cli) desktopBridgeCmd(args []string) int {
	fs := newCLIFlagSet("desktop-bridge")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	probeTimeout := fs.Duration("probe-timeout", desktopRuntimeProbeTimeout, "Runtime health probe timeout.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flagErrHelp()) {
			writeText(c.stdout, desktopBridgeHelpText())
			return 0
		}
		message, details := translateFlagParseError("desktop-bridge", err)
		writeErrorWithHelp(c.stderr, message, details, desktopBridgeHelpText())
		return 2
	}
	if fs.NArg() != 0 {
		writeErrorWithHelp(c.stderr, "`redeven desktop-bridge` does not accept positional arguments", nil, desktopBridgeHelpText())
		return 2
	}
	state, err := loadAttachableDesktopRuntime(*stateRoot, *probeTimeout)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %v\n", err)
		return 1
	}
	if state == nil {
		fmt.Fprintln(c.stderr, "desktop-bridge failed: runtime daemon is not running; start the runtime first")
		return 1
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	controlEndpoint := state.RuntimeControl
	bridge := desktopbridge.Server{
		DialSurface: desktopbridge.NewURLSurfaceDialer(state.LocalUIURL, endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.BaseURL })),
		Hello: desktopbridge.Hello{
			RuntimeVersion: Version,
			RuntimeCommit:  Commit,
			LocalUI: desktopbridge.HelloLocalUI{
				Available: true,
				BasePath:  "/",
			},
			RuntimeControl: desktopbridge.RuntimeControl{
				Available:       controlEndpoint != nil,
				ProtocolVersion: endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.ProtocolVersion }),
				BaseURL:         "bridge://runtime-control",
				Token:           endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.Token }),
				DesktopOwnerID:  endpointString(controlEndpoint, func(endpoint localuiruntime.RuntimeControlEndpoint) string { return endpoint.DesktopOwnerID }),
			},
			RuntimeService: state.RuntimeService,
		},
		OnShutdown: cancel,
	}
	if err := bridge.Serve(ctx, c.stdin, c.stdout); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %v\n", err)
		return 1
	}
	return 0
}

func endpointString(endpoint *localuiruntime.RuntimeControlEndpoint, read func(localuiruntime.RuntimeControlEndpoint) string) string {
	if endpoint == nil {
		return ""
	}
	return strings.TrimSpace(read(*endpoint))
}

func loadAttachableDesktopRuntime(stateRoot string, probeTimeout time.Duration) (*localuiruntime.Snapshot, error) {
	stateLayout, err := resolveRunStateLayout(stateRoot)
	if err != nil {
		return nil, err
	}
	return localuiruntime.LoadAttachable(stateLayout.RuntimeStatePath, probeTimeout)
}

func flagErrHelp() error { return flag.ErrHelp }
