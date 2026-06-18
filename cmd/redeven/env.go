package main

import (
	"errors"
	"flag"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/agentprotocol"
)

func (c *cli) envCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, envHelpText())
		return 0
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "list":
		return c.envListCmd(args[1:])
	case "resolve":
		return c.envResolveCmd(args[1:])
	case "status":
		return c.envStatusCmd(args[1:], false)
	case "diagnose":
		return c.envStatusCmd(args[1:], true)
	case "start", "stop", "restart", "update":
		return c.envOperationCmd(strings.TrimSpace(strings.ToLower(args[0])), args[1:])
	default:
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("unknown env command: %s", strings.TrimSpace(args[0])),
			[]string{"Run `redeven help env` for available environment commands."},
			envHelpText(),
		)
		return 2
	}
}

func (c *cli) envListCmd(args []string) int {
	fs := newCLIFlagSet("env list")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	jsonOut := fs.Bool("json", false, "Write the protocol JSON envelope.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, envListHelpText())
			return 0
		}
		message, details := translateFlagParseError("env list", err)
		writeErrorWithHelp(c.stderr, message, details, envListHelpText())
		return 2
	}

	catalog, err := agentprotocol.DiscoverTargets(agentprotocol.DiscoverTargetsOptions{
		StateRoot: *stateRoot,
	})
	if err != nil {
		return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetDiscoveryFailed, err.Error(), "", *jsonOut)
	}
	catalog = agentprotocol.EnvironmentTargetCatalog(catalog)
	if *jsonOut {
		return c.writeAgentProtocolSuccess(catalog, "", true)
	}
	for _, target := range catalog.Targets {
		fmt.Fprintf(c.stdout, "%s\t%s\t%s\n", target.ID, target.Status, target.Label)
	}
	return 0
}

func (c *cli) envResolveCmd(args []string) int {
	fs := newCLIFlagSet("env resolve")
	targetName := fs.String("target", "", "Environment target id, current, label, env_public_id, or recognized Redeven target shape.")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	jsonOut := fs.Bool("json", false, "Write the protocol JSON envelope.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, envResolveHelpText())
			return 0
		}
		message, details := translateFlagParseError("env resolve", err)
		writeErrorWithHelp(c.stderr, message, details, envResolveHelpText())
		return 2
	}
	if strings.TrimSpace(*targetName) == "" {
		message := "missing required flag for `redeven env resolve`: --target"
		if *jsonOut {
			return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetMissing, message, "", true)
		}
		writeErrorWithHelp(c.stderr, message, []string{"Example: redeven env resolve --target local"}, envResolveHelpText())
		return 2
	}

	catalog, err := agentprotocol.DiscoverTargets(agentprotocol.DiscoverTargetsOptions{
		StateRoot: *stateRoot,
	})
	if err != nil {
		return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetDiscoveryFailed, err.Error(), "", *jsonOut)
	}
	resolution, err := agentprotocol.ResolveEnvironmentTarget(catalog, *targetName)
	if err != nil {
		if *jsonOut {
			return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetNotFound, "target not found", strings.TrimSpace(*targetName), true)
		}
		writeErrorWithHelp(c.stderr, "target not found", []string{"Run `redeven env list` to see available environments."}, envResolveHelpText())
		return 2
	}
	if *jsonOut {
		return c.writeAgentProtocolSuccess(resolution, resolution.Target.ID, true)
	}
	fmt.Fprintf(c.stdout, "%s\t%s\t%s", resolution.Target.ID, resolution.Target.Status, resolution.Target.Label)
	if !resolution.Supported {
		fmt.Fprintf(c.stdout, "\t%s", resolution.ReasonCode)
	}
	fmt.Fprintln(c.stdout)
	return 0
}

func (c *cli) envStatusCmd(args []string, includeDiagnostics bool) int {
	commandName := "env status"
	helpText := envStatusHelpText()
	if includeDiagnostics {
		commandName = "env diagnose"
		helpText = envDiagnoseHelpText()
	}
	fs := newCLIFlagSet(commandName)
	targetName := fs.String("target", "", "Environment target id, current, label, env_public_id, or recognized Redeven target shape.")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	probeTimeout := fs.Duration("probe-timeout", desktopRuntimeProbeTimeout, "Runtime health probe timeout.")
	jsonOut := fs.Bool("json", false, "Write the protocol JSON envelope.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, helpText)
			return 0
		}
		message, details := translateFlagParseError(commandName, err)
		writeErrorWithHelp(c.stderr, message, details, helpText)
		return 2
	}

	status, err := c.loadEnvironmentStatus(*stateRoot, *targetName, *probeTimeout, includeDiagnostics)
	if err != nil {
		return c.writeEnvironmentLoadError(err, strings.TrimSpace(*targetName), *jsonOut, helpText)
	}
	if *jsonOut {
		return c.writeAgentProtocolSuccess(status, status.Target.ID, true)
	}
	c.writeEnvironmentStatusText(status, includeDiagnostics)
	return 0
}

func (c *cli) envOperationCmd(operation string, args []string) int {
	fs := newCLIFlagSet("env " + operation)
	targetName := fs.String("target", "", "Environment target id, current, label, env_public_id, or recognized Redeven target shape.")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	probeTimeout := fs.Duration("probe-timeout", desktopRuntimeProbeTimeout, "Runtime health probe timeout.")
	var gracePeriod *time.Duration
	if operation == agentprotocol.EnvOperationStop {
		gracePeriod = fs.Duration("grace-period", 5*time.Second, "Time to wait after requesting runtime shutdown.")
	}
	jsonOut := fs.Bool("json", false, "Write the protocol JSON envelope.")
	helpText := envOperationHelpText(operation)

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, helpText)
			return 0
		}
		message, details := translateFlagParseError("env "+operation, err)
		writeErrorWithHelp(c.stderr, message, details, helpText)
		return 2
	}

	status, err := c.loadEnvironmentStatus(*stateRoot, *targetName, *probeTimeout, true)
	if err != nil {
		return c.writeEnvironmentLoadError(err, strings.TrimSpace(*targetName), *jsonOut, helpText)
	}
	plan, ok := status.Operations[operation]
	if !ok {
		return c.writeAgentProtocolFailure(agentprotocol.ErrCodeEnvironmentOperation, "environment operation is not available", status.Target.ID, *jsonOut)
	}
	if operation == agentprotocol.EnvOperationStop && plan.Availability == agentprotocol.OperationAvailabilityAvailable {
		stopGracePeriod := 5 * time.Second
		if gracePeriod != nil {
			stopGracePeriod = *gracePeriod
		}
		if err := stopDesktopManagedRuntime(*stateRoot, *probeTimeout, stopGracePeriod); err != nil {
			if errors.Is(err, errDesktopRuntimeStopOwnerExternal) {
				plan = agentprotocol.BlockedOperationPlan(
					agentprotocol.EnvOperationStop,
					agentprotocol.OperationMethodLocalHost,
					agentprotocol.EnvReasonRuntimeOwnerExternal,
					"A runtime is present, but it is not owned by a Desktop-managed Redeven runtime. Use the owning runtime surface to stop it.",
				)
				result := agentprotocol.EnvironmentOperationResultFromStatus(status, plan, true)
				if *jsonOut {
					return c.writeAgentProtocolSuccess(result, status.Target.ID, true)
				}
				fmt.Fprintf(c.stdout, "%s\t%s\t%s\t%s\n", result.Operation.Operation, result.Operation.Availability, result.Operation.Label, result.Operation.Message)
				return 0
			}
			return c.writeAgentProtocolFailure(agentprotocol.ErrCodeEnvironmentOperation, err.Error(), status.Target.ID, *jsonOut)
		}
		after, loadErr := c.loadEnvironmentStatus(*stateRoot, *targetName, *probeTimeout, true)
		if loadErr == nil {
			status = after
		}
		plan = agentprotocol.MarkOperationPerformed(plan, "Runtime stopped.")
	}
	result := agentprotocol.EnvironmentOperationResultFromStatus(status, plan, true)
	if *jsonOut {
		return c.writeAgentProtocolSuccess(result, status.Target.ID, true)
	}
	fmt.Fprintf(c.stdout, "%s\t%s\t%s", result.Operation.Operation, result.Operation.Availability, result.Operation.Label)
	if result.Operation.ReasonCode != "" {
		fmt.Fprintf(c.stdout, "\t%s", result.Operation.ReasonCode)
	}
	if result.Operation.Message != "" {
		fmt.Fprintf(c.stdout, "\t%s", result.Operation.Message)
	}
	fmt.Fprintln(c.stdout)
	return 0
}

func (c *cli) loadEnvironmentStatus(stateRoot string, targetName string, probeTimeout time.Duration, includeDiagnostics bool) (agentprotocol.EnvironmentStatus, error) {
	catalog, err := agentprotocol.DiscoverTargets(agentprotocol.DiscoverTargetsOptions{
		StateRoot: stateRoot,
	})
	if err != nil {
		return agentprotocol.EnvironmentStatus{}, fmt.Errorf("%s: %w", agentprotocol.ErrCodeTargetDiscoveryFailed, err)
	}
	resolution, err := agentprotocol.ResolveEnvironmentTarget(catalog, targetName)
	if err != nil {
		return agentprotocol.EnvironmentStatus{}, fmt.Errorf("%s: %w", agentprotocol.ErrCodeTargetNotFound, err)
	}
	if !resolution.Supported {
		return agentprotocol.UnsupportedEnvironmentStatus(resolution), nil
	}
	runtimeStatus, err := loadDesktopRuntimeStatus(stateRoot, probeTimeout)
	if err != nil {
		return agentprotocol.EnvironmentStatus{}, fmt.Errorf("%s: %w", agentprotocol.ErrCodeEnvironmentStatus, err)
	}
	return agentprotocol.EnvironmentStatusFromAttach(resolution, runtimeStatus, includeDiagnostics), nil
}

func (c *cli) writeEnvironmentLoadError(err error, targetID string, jsonOut bool, helpText string) int {
	message := strings.TrimSpace(err.Error())
	code := agentprotocol.ErrCodeEnvironmentStatus
	switch {
	case strings.HasPrefix(message, agentprotocol.ErrCodeTargetDiscoveryFailed+":"):
		code = agentprotocol.ErrCodeTargetDiscoveryFailed
		message = strings.TrimSpace(strings.TrimPrefix(message, agentprotocol.ErrCodeTargetDiscoveryFailed+":"))
	case strings.HasPrefix(message, agentprotocol.ErrCodeTargetNotFound+":"):
		code = agentprotocol.ErrCodeTargetNotFound
		message = "target not found"
	case strings.HasPrefix(message, agentprotocol.ErrCodeEnvironmentStatus+":"):
		code = agentprotocol.ErrCodeEnvironmentStatus
		message = strings.TrimSpace(strings.TrimPrefix(message, agentprotocol.ErrCodeEnvironmentStatus+":"))
	}
	if jsonOut {
		return c.writeAgentProtocolFailure(code, message, targetID, true)
	}
	writeErrorWithHelp(c.stderr, message, []string{"Run `redeven env list` to see available environments."}, helpText)
	return 2
}

func (c *cli) writeEnvironmentStatusText(status agentprotocol.EnvironmentStatus, includeDiagnostics bool) {
	fmt.Fprintf(c.stdout, "%s\t%s\t%s\t%s\n", status.Target.ID, status.Target.Status, status.Target.Label, status.Runtime.State)
	if strings.TrimSpace(status.Runtime.Message) != "" {
		fmt.Fprintf(c.stdout, "%s\n", status.Runtime.Message)
	}
	if includeDiagnostics && status.Diagnostics != nil {
		if status.Diagnostics.FailureCode != "" {
			fmt.Fprintf(c.stdout, "failure_code\t%s\n", status.Diagnostics.FailureCode)
		}
		if status.Diagnostics.ControlSocketPath != "" {
			fmt.Fprintf(c.stdout, "runtime_control_socket_path\t%s\n", status.Diagnostics.ControlSocketPath)
		}
		if status.Diagnostics.LockPath != "" {
			fmt.Fprintf(c.stdout, "lock_path\t%s\n", status.Diagnostics.LockPath)
		}
	}
}
