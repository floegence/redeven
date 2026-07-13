package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

var errDesktopRuntimeStopOwnerExternal = errors.New("runtime is not Desktop-managed")

type repeatedStringFlag []string

func (f *repeatedStringFlag) String() string {
	if f == nil {
		return ""
	}
	return strings.Join(*f, ",")
}

func (f *repeatedStringFlag) Set(value string) error {
	*f = append(*f, value)
	return nil
}

type runtimeProcessCommandError struct {
	SchemaVersion int `json:"schema_version"`
	Error         struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeRuntimeProcessJSONError(out io.Writer, err error) {
	body := runtimeProcessCommandError{SchemaVersion: runtimemanagement.RuntimeProcessInventorySchemaVersion}
	body.Error.Code = runtimemanagement.RuntimeProcessErrorCode(err)
	if body.Error.Code == "" {
		body.Error.Code = "runtime_process_operation_failed"
	}
	body.Error.Message = strings.TrimSpace(err.Error())
	_ = json.NewEncoder(out).Encode(body)
}

func runtimeProcessInventoryOptions(
	stateRoot string,
	runtimeRoot string,
	desktopOwnerID string,
	currentExecutables []string,
	includeKnownLegacy bool,
	legacyRuntimeRoots []string,
) (runtimemanagement.RuntimeProcessInventoryOptions, error) {
	resolvedStateRoot, err := config.ResolveStateRoot(stateRoot)
	if err != nil {
		return runtimemanagement.RuntimeProcessInventoryOptions{}, err
	}
	resolvedRuntimeRoot := strings.TrimSpace(runtimeRoot)
	if resolvedRuntimeRoot == "" {
		resolvedRuntimeRoot = resolvedStateRoot
	}
	return runtimemanagement.RuntimeProcessInventoryOptions{
		RuntimeRoot:        resolvedRuntimeRoot,
		StateRoot:          resolvedStateRoot,
		DesktopOwnerID:     strings.TrimSpace(desktopOwnerID),
		CurrentExecutables: append([]string(nil), currentExecutables...),
		IncludeKnownLegacy: includeKnownLegacy,
		LegacyRuntimeRoots: append([]string(nil), legacyRuntimeRoots...),
	}, nil
}

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

func (c *cli) desktopRuntimeInventoryCmd(args []string) int {
	fs := newCLIFlagSet("desktop-runtime-inventory")
	stateRoot := fs.String("state-root", "", "Current Runtime state root.")
	runtimeRoot := fs.String("runtime-root", "", "Managed runtime package root.")
	desktopOwnerID := fs.String("desktop-owner-id", "", "Expected Desktop owner identity.")
	includeKnownLegacy := fs.Bool("include-known-legacy", false, "Include built-in historical Desktop layouts.")
	var currentExecutables repeatedStringFlag
	fs.Var(&currentExecutables, "current-executable", "Expected current runtime executable; repeatable.")
	var legacyRuntimeRoots repeatedStringFlag
	fs.Var(&legacyRuntimeRoots, "legacy-runtime-root", "Additional historical runtime root; repeatable.")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, desktopRuntimeInventoryHelpText())
			return 0
		}
		message, details := translateFlagParseError("desktop-runtime-inventory", err)
		writeErrorWithHelp(c.stderr, message, details, desktopRuntimeInventoryHelpText())
		return 2
	}
	if fs.NArg() != 0 {
		writeErrorWithHelp(c.stderr, "`redeven desktop-runtime-inventory` does not accept positional arguments", nil, desktopRuntimeInventoryHelpText())
		return 2
	}
	options, err := runtimeProcessInventoryOptions(
		*stateRoot,
		*runtimeRoot,
		*desktopOwnerID,
		currentExecutables,
		*includeKnownLegacy,
		legacyRuntimeRoots,
	)
	if err != nil {
		writeRuntimeProcessJSONError(c.stdout, err)
		return 1
	}
	inventory, err := runtimemanagement.InspectRuntimeProcesses(context.Background(), options)
	if err != nil {
		writeRuntimeProcessJSONError(c.stdout, err)
		return 1
	}
	if err := json.NewEncoder(c.stdout).Encode(inventory); err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-inventory failed: %v\n", err)
		return 1
	}
	return 0
}

func (c *cli) desktopRuntimeStopCmd(args []string) int {
	fs := newCLIFlagSet("desktop-runtime-stop")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	probeTimeout := fs.Duration("probe-timeout", desktopRuntimeProbeTimeout, "Runtime health probe timeout.")
	gracePeriod := fs.Duration("grace-period", 5*time.Second, "Time to wait after requesting runtime shutdown.")
	allMatching := fs.Bool("all-matching", false, "Stop every safely matched current or legacy instance.")
	runtimeRoot := fs.String("runtime-root", "", "Managed runtime package root.")
	desktopOwnerID := fs.String("desktop-owner-id", "", "Expected Desktop owner identity.")
	includeKnownLegacy := fs.Bool("include-known-legacy", false, "Include built-in historical Desktop layouts.")
	var currentExecutables repeatedStringFlag
	fs.Var(&currentExecutables, "current-executable", "Expected current runtime executable; repeatable.")
	expectedDigest := fs.String("expected-inventory-digest", "", "Expected runtime process inventory digest.")
	jsonOut := fs.Bool("json", false, "Write a versioned machine-readable result.")
	var legacyRuntimeRoots repeatedStringFlag
	fs.Var(&legacyRuntimeRoots, "legacy-runtime-root", "Additional historical runtime root; repeatable.")
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
	if *allMatching {
		options, err := runtimeProcessInventoryOptions(
			*stateRoot,
			*runtimeRoot,
			*desktopOwnerID,
			currentExecutables,
			*includeKnownLegacy,
			legacyRuntimeRoots,
		)
		if err == nil && strings.TrimSpace(*expectedDigest) == "" {
			err = errors.New("--expected-inventory-digest is required with --all-matching")
		}
		if err != nil {
			if *jsonOut {
				writeRuntimeProcessJSONError(c.stdout, err)
			} else {
				fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
			}
			return 1
		}
		result, stopErr := runtimemanagement.StopRuntimeProcesses(
			context.Background(),
			options,
			*expectedDigest,
			*gracePeriod,
		)
		if stopErr != nil {
			if *jsonOut {
				writeRuntimeProcessJSONError(c.stdout, stopErr)
			} else {
				fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", stopErr)
			}
			return 1
		}
		if *jsonOut {
			if err := json.NewEncoder(c.stdout).Encode(result); err != nil {
				fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
				return 1
			}
		}
		return 0
	}
	if err := stopDesktopRuntime(*stateRoot, *probeTimeout, *gracePeriod); err != nil {
		fmt.Fprintf(c.stderr, "desktop-runtime-stop failed: %v\n", err)
		return 1
	}
	return 0
}

func stopDesktopRuntime(stateRoot string, probeTimeout time.Duration, gracePeriod time.Duration) error {
	status, err := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
	if err != nil {
		return err
	}
	return stopDesktopRuntimeStatus(stateRoot, probeTimeout, gracePeriod, status)
}

func stopDesktopManagedRuntime(stateRoot string, probeTimeout time.Duration, gracePeriod time.Duration) error {
	status, err := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
	if err != nil {
		return err
	}
	if status.State != runtimemanagement.AttachStateNotRunning && !status.Identity.DesktopManaged {
		return errDesktopRuntimeStopOwnerExternal
	}
	return stopDesktopRuntimeStatus(stateRoot, probeTimeout, gracePeriod, status)
}

func stopDesktopRuntimeStatus(stateRoot string, probeTimeout time.Duration, gracePeriod time.Duration, status runtimemanagement.RuntimeAttachStatus) error {
	if status.State == runtimemanagement.AttachStateNotRunning {
		return nil
	}
	if status.State == runtimemanagement.AttachStateStaleLock {
		if err := retireStaleRuntimeLease(status, 0); err != nil {
			return err
		}
		if err := confirmDesktopRuntimeStopped(stateRoot, probeTimeout); err != nil {
			return err
		}
		return nil
	}
	if status.Identity.PID <= 0 {
		return errors.New("runtime did not report a process id")
	}
	process, err := os.FindProcess(status.Identity.PID)
	if err != nil {
		return err
	}
	if err := process.Signal(os.Interrupt); err != nil && !errors.Is(err, os.ErrProcessDone) {
		if killErr := process.Kill(); killErr != nil && !errors.Is(killErr, os.ErrProcessDone) {
			return killErr
		}
	}
	deadline := time.Now().Add(gracePeriod)
	var lastStatus runtimemanagement.RuntimeAttachStatus
	var lastStaleRetireErr error
	for time.Now().Before(deadline) {
		attached, probeErr := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
		if probeErr == nil {
			lastStatus = attached
			if attached.State == runtimemanagement.AttachStateNotRunning {
				return nil
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
		confirmed, probeErr := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
		if probeErr == nil && confirmed.State == runtimemanagement.AttachStateNotRunning {
			return nil
		}
	}
	if lastStaleRetireErr != nil {
		return lastStaleRetireErr
	}
	if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	forceDeadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(forceDeadline) {
		attached, probeErr := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
		if probeErr == nil {
			lastStatus = attached
			if attached.State == runtimemanagement.AttachStateNotRunning {
				return nil
			}
			if attached.State == runtimemanagement.AttachStateStaleLock {
				if err := retireStaleRuntimeLease(attached, status.Identity.PID); err != nil {
					lastStaleRetireErr = err
				} else {
					confirmed, confirmErr := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
					if confirmErr == nil && confirmed.State == runtimemanagement.AttachStateNotRunning {
						return nil
					}
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if lastStaleRetireErr != nil {
		return lastStaleRetireErr
	}
	if lastStatus.State != "" {
		return fmt.Errorf("runtime did not stop before timeout; last state %s", lastStatus.State)
	}
	return errors.New("runtime did not stop before timeout")
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
		ProviderOrigin:           state.RuntimeService.Bindings.ProviderLink.ProviderOrigin,
		ControlplaneBaseURL:      state.RuntimeService.Bindings.ProviderLink.AccessPointOrigin,
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
