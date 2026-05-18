package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

func (c *cli) desktopRuntimeStatusCmd(args []string) int {
	fs := newCLIFlagSet("desktop-runtime-status")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	probeTimeout := fs.Duration("probe-timeout", desktopRuntimeProbeTimeout, "Runtime health probe timeout.")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, desktopRuntimeStatusHelpText())
			return 0
		}
		message, details := translateFlagParseError("desktop-runtime-status", err)
		writeErrorWithHelp(c.stderr, message, details, desktopRuntimeStatusHelpText())
		return 2
	}
	if fs.NArg() != 0 {
		writeErrorWithHelp(c.stderr, "`redeven desktop-runtime-status` does not accept positional arguments", nil, desktopRuntimeStatusHelpText())
		return 2
	}
	state, err := loadAttachableDesktopRuntime(*stateRoot, *probeTimeout)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-status failed: %v\n", err)
		return 1
	}
	if state == nil {
		fmt.Fprintln(c.stderr, "runtime daemon is not running")
		return 1
	}
	report := desktopLaunchReportFromRuntimeState(state, desktopLaunchStatusReady)
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-status failed: %v\n", err)
		return 1
	}
	body = append(body, '\n')
	if _, err := c.stdout.Write(body); err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-status failed: %v\n", err)
		return 1
	}
	return 0
}

func (c *cli) desktopRuntimeStopCmd(args []string) int {
	fs := newCLIFlagSet("desktop-runtime-stop")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	probeTimeout := fs.Duration("probe-timeout", desktopRuntimeProbeTimeout, "Runtime health probe timeout.")
	gracePeriod := fs.Duration("grace-period", 5*time.Second, "Time to wait after requesting runtime shutdown.")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, desktopRuntimeStopHelpText())
			return 0
		}
		message, details := translateFlagParseError("desktop-runtime-stop", err)
		writeErrorWithHelp(c.stderr, message, details, desktopRuntimeStopHelpText())
		return 2
	}
	if fs.NArg() != 0 {
		writeErrorWithHelp(c.stderr, "`redeven desktop-runtime-stop` does not accept positional arguments", nil, desktopRuntimeStopHelpText())
		return 2
	}
	state, err := loadAttachableDesktopRuntime(*stateRoot, *probeTimeout)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
		return 1
	}
	if state == nil {
		return 0
	}
	if state.PID <= 0 {
		fmt.Fprintln(c.stderr, "desktop-runtime-stop failed: runtime did not report a process id")
		return 1
	}
	process, err := os.FindProcess(state.PID)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
		return 1
	}
	if err := process.Signal(os.Interrupt); err != nil && !errors.Is(err, os.ErrProcessDone) {
		if killErr := process.Kill(); killErr != nil && !errors.Is(killErr, os.ErrProcessDone) {
			fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
			return 1
		}
	}
	deadline := time.Now().Add(*gracePeriod)
	for time.Now().Before(deadline) {
		attached, probeErr := loadAttachableDesktopRuntime(*stateRoot, *probeTimeout)
		if probeErr == nil && attached == nil {
			return 0
		}
		time.Sleep(100 * time.Millisecond)
	}
	return 0
}

func desktopLaunchReportFromRuntimeState(state *localuiruntime.Snapshot, status desktopLaunchStatus) desktopLaunchReport {
	if state == nil {
		return desktopLaunchReport{Status: status}
	}
	return desktopLaunchReport{
		Status:                 status,
		LocalUIURL:             state.LocalUIURL,
		LocalUIURLs:            append([]string(nil), state.LocalUIURLs...),
		RuntimeControl:         runtimeControlEndpointFromRuntimeState(state.RuntimeControl),
		PasswordRequired:       state.PasswordRequired,
		EffectiveRunMode:       state.EffectiveRunMode,
		RemoteEnabled:          state.RemoteEnabled,
		DesktopManaged:         state.DesktopManaged,
		DesktopOwnerID:         state.DesktopOwnerID,
		ControlplaneBaseURL:    state.ControlplaneBaseURL,
		ControlplaneProviderID: state.ControlplaneProviderID,
		EnvPublicID:            state.EnvPublicID,
		StateDir:               state.StateDir,
		DiagnosticsEnabled:     state.DiagnosticsEnabled,
		PID:                    state.PID,
		RuntimeService:         state.RuntimeService,
	}
}

func runtimeControlEndpointFromRuntimeState(endpoint *localuiruntime.RuntimeControlEndpoint) *runtimeControlEndpoint {
	if endpoint == nil {
		return nil
	}
	return &runtimeControlEndpoint{
		ProtocolVersion: endpoint.ProtocolVersion,
		BaseURL:         endpoint.BaseURL,
		Token:           endpoint.Token,
		DesktopOwnerID:  endpoint.DesktopOwnerID,
		ExpiresAtUnixMS: endpoint.ExpiresAtUnixMS,
	}
}
