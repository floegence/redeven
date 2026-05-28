package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/runtimemanagement"
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
	status, err := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-status failed: %v\n", err)
		return 1
	}
	report := desktopLaunchReportFromRuntimeStatus(status, desktopLaunchStatusReady)
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
	status, err := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
		return 1
	}
	if status.State == runtimemanagement.AttachStateNotRunning {
		return 0
	}
	if status.State == runtimemanagement.AttachStateStaleLock {
		if err := retireStaleRuntimeLease(status, 0); err != nil {
			fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
			return 1
		}
		if err := confirmDesktopRuntimeStopped(*stateRoot, *probeTimeout); err != nil {
			fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
			return 1
		}
		return 0
	}
	if status.Identity.PID <= 0 {
		fmt.Fprintln(c.stderr, "desktop-runtime-stop failed: runtime did not report a process id")
		return 1
	}
	process, err := os.FindProcess(status.Identity.PID)
	if err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
		return 1
	}
	if err := process.Signal(os.Interrupt); err != nil && !errors.Is(err, os.ErrProcessDone) {
		if killErr := process.Kill(); killErr != nil && !errors.Is(killErr, os.ErrProcessDone) {
			fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", killErr)
			return 1
		}
	}
	deadline := time.Now().Add(*gracePeriod)
	var lastStatus runtimemanagement.RuntimeAttachStatus
	var lastStaleRetireErr error
	for time.Now().Before(deadline) {
		attached, probeErr := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
		if probeErr == nil {
			lastStatus = attached
			if attached.State == runtimemanagement.AttachStateNotRunning {
				return 0
			}
			if attached.State == runtimemanagement.AttachStateStaleLock {
				if err := retireStaleRuntimeLease(attached, status.Identity.PID); err != nil {
					lastStaleRetireErr = err
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if lastStatus.State == runtimemanagement.AttachStateStaleLock && lastStaleRetireErr == nil {
		confirmed, probeErr := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
		if probeErr == nil && confirmed.State == runtimemanagement.AttachStateNotRunning {
			return 0
		}
	}
	if lastStaleRetireErr != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", lastStaleRetireErr)
		return 1
	}
	if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
		return 1
	}
	forceDeadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(forceDeadline) {
		attached, probeErr := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
		if probeErr == nil {
			lastStatus = attached
			if attached.State == runtimemanagement.AttachStateNotRunning {
				return 0
			}
			if attached.State == runtimemanagement.AttachStateStaleLock {
				if err := retireStaleRuntimeLease(attached, status.Identity.PID); err != nil {
					lastStaleRetireErr = err
				} else {
					confirmed, confirmErr := loadDesktopRuntimeStatus(*stateRoot, *probeTimeout)
					if confirmErr == nil && confirmed.State == runtimemanagement.AttachStateNotRunning {
						return 0
					}
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if lastStaleRetireErr != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", lastStaleRetireErr)
		return 1
	}
	if lastStatus.State != "" {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: runtime did not stop before timeout; last state %s\n", lastStatus.State)
		return 1
	}
	fmt.Fprintln(c.stderr, "desktop-runtime-stop failed: runtime did not stop before timeout")
	return 1
}

func retireStaleRuntimeLease(status runtimemanagement.RuntimeAttachStatus, expectedPID int) error {
	if status.State != runtimemanagement.AttachStateStaleLock {
		return nil
	}
	lockPath := strings.TrimSpace(status.Diagnostics.LockPath)
	if lockPath == "" {
		return errors.New("stale runtime lock did not report a lock path")
	}
	lockPID := status.Diagnostics.LockPID
	if expectedPID > 0 && lockPID > 0 && lockPID != expectedPID {
		return fmt.Errorf("stale runtime lock belongs to pid %d, expected stopped pid %d", lockPID, expectedPID)
	}
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		return fmt.Errorf("retire stale runtime lock: %w", err)
	}
	return lk.Release()
}

func confirmDesktopRuntimeStopped(stateRoot string, probeTimeout time.Duration) error {
	status, err := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
	if err != nil {
		return fmt.Errorf("confirm runtime stopped: %w", err)
	}
	return stoppedRuntimeStatusError(status)
}

func stoppedRuntimeStatusError(status runtimemanagement.RuntimeAttachStatus) error {
	if status.State == runtimemanagement.AttachStateNotRunning {
		return nil
	}
	if status.State == "" {
		return errors.New("runtime stop verification did not report a state")
	}
	return fmt.Errorf("runtime stop verification found state %s", status.State)
}

func desktopLaunchReportFromRuntimeStatus(state runtimemanagement.RuntimeAttachStatus, status desktopLaunchStatus) desktopLaunchReport {
	if state.State != runtimemanagement.AttachStateReady && state.State != runtimemanagement.AttachStateStarting {
		return desktopLaunchReport{
			Status:    desktopLaunchStatusBlocked,
			Code:      string(state.State),
			Message:   desktopRuntimeAttachMessage(state.State),
			LockOwner: lockOwnerFromRuntimeIdentity(state.Identity),
			Diagnostics: &desktopLaunchDiagnostics{
				LockPath:                 state.Diagnostics.LockPath,
				RuntimeControlSocketPath: state.Diagnostics.ControlSocketPath,
				AttachState:              string(state.State),
				FailureCode:              state.Diagnostics.FailureCode,
				LockPID:                  state.Diagnostics.LockPID,
				PIDAlive:                 state.Diagnostics.PIDAlive,
				SocketReachable:          state.Diagnostics.SocketReachable,
			},
		}
	}
	endpoint := state.Endpoint
	if endpoint == nil {
		endpoint = &runtimemanagement.RuntimeAttachEndpoint{}
	}
	return desktopLaunchReport{
		Status:                   status,
		LocalUIURL:               endpoint.LocalUIURL,
		LocalUIURLs:              append([]string(nil), endpoint.LocalUIURLs...),
		RuntimeControl:           runtimeControlEndpointFromRuntimeStatus(endpoint.RuntimeControl),
		PasswordRequired:         endpoint.PasswordRequired,
		EffectiveRunMode:         state.RuntimeService.EffectiveRunMode,
		RemoteEnabled:            state.RuntimeService.RemoteEnabled,
		DesktopManaged:           state.Identity.DesktopManaged,
		DesktopOwnerID:           state.Identity.DesktopOwnerID,
		ControlplaneBaseURL:      state.RuntimeService.Bindings.ProviderLink.ProviderOrigin,
		ControlplaneProviderID:   state.RuntimeService.Bindings.ProviderLink.ProviderID,
		EnvPublicID:              state.RuntimeService.Bindings.ProviderLink.EnvPublicID,
		StateDir:                 state.Identity.StateDir,
		RuntimeControlSocketPath: state.Diagnostics.ControlSocketPath,
		PID:                      state.Identity.PID,
		StartedAtUnixMS:          state.Identity.StartedAtUnixMS,
		RuntimeService:           state.RuntimeService,
	}
}

func lockOwnerFromRuntimeIdentity(identity runtimemanagement.RuntimeInstanceIdentity) *desktopLaunchLockOwner {
	if identity.PID <= 0 && strings.TrimSpace(identity.InstanceID) == "" {
		return nil
	}
	return &desktopLaunchLockOwner{
		PID:             identity.PID,
		InstanceID:      identity.InstanceID,
		StartedAtUnixMS: identity.StartedAtUnixMS,
		RuntimeVersion:  identity.RuntimeVersion,
		RuntimeCommit:   identity.RuntimeCommit,
		BinaryPath:      identity.BinaryPath,
		DesktopManaged:  identity.DesktopManaged,
		DesktopOwnerID:  identity.DesktopOwnerID,
		StateRoot:       identity.StateRoot,
		StateDir:        identity.StateDir,
	}
}

func runtimeControlEndpointFromRuntimeStatus(endpoint *runtimemanagement.RuntimeControlEndpoint) *runtimeControlEndpoint {
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
