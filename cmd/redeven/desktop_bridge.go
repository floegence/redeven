package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/runtimemanagement"
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
	state, err := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %v\n", err)
		return 1
	}
	if state.State != runtimemanagement.AttachStateReady || state.Endpoint == nil {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %s\n", desktopRuntimeAttachMessage(state.State))
		return 1
	}
	controlEndpoint := state.Endpoint.RuntimeControl
	dialSurface, err := desktopbridge.NewTrustedBridgeSurfaceDialer(
		state.Endpoint.LocalUIBridgeURL,
		endpointString(controlEndpoint, func(endpoint runtimemanagement.RuntimeControlEndpoint) string { return endpoint.BaseURL }),
	)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: %v\n", err)
		return 1
	}
	probeCtx, probeCancel := context.WithTimeout(context.Background(), *probeTimeout)
	probeErr := desktopbridge.ProbeSurface(probeCtx, dialSurface, desktopbridge.StreamSurfaceLocalUI)
	probeCancel()
	if probeErr != nil {
		fmt.Fprintf(c.stderr, "desktop-bridge failed: trusted Local UI bridge is unreachable: %v\n", probeErr)
		return 1
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	bridge := desktopbridge.Server{
		DialSurface: dialSurface,
		Hello: desktopbridge.Hello{
			RuntimeVersion:  Version,
			RuntimeCommit:   Commit,
			StartedAtUnixMS: state.Identity.StartedAtUnixMS,
			LocalUI: desktopbridge.HelloLocalUI{
				Available: true,
				BasePath:  "/",
			},
			RuntimeControl: desktopbridge.RuntimeControl{
				Available:       controlEndpoint != nil,
				ProtocolVersion: endpointString(controlEndpoint, func(endpoint runtimemanagement.RuntimeControlEndpoint) string { return endpoint.ProtocolVersion }),
				BaseURL:         "bridge://runtime-control",
				Token:           endpointString(controlEndpoint, func(endpoint runtimemanagement.RuntimeControlEndpoint) string { return endpoint.Token }),
				DesktopOwnerID:  endpointString(controlEndpoint, func(endpoint runtimemanagement.RuntimeControlEndpoint) string { return endpoint.DesktopOwnerID }),
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

func endpointString(endpoint *runtimemanagement.RuntimeControlEndpoint, read func(runtimemanagement.RuntimeControlEndpoint) string) string {
	if endpoint == nil {
		return ""
	}
	return strings.TrimSpace(read(*endpoint))
}

func flagErrHelp() error { return flag.ErrHelp }
