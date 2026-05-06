package main

import (
	"errors"
	"flag"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/agentprotocol"
)

func (c *cli) targetsCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, targetsHelpText())
		return 0
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "list":
		return c.targetsListCmd(args[1:])
	case "resolve":
		return c.targetsResolveCmd(args[1:])
	default:
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("unknown targets command: %s", strings.TrimSpace(args[0])),
			[]string{"Run `redeven help targets` for available target commands."},
			targetsHelpText(),
		)
		return 2
	}
}

func (c *cli) targetsListCmd(args []string) int {
	fs := newCLIFlagSet("targets list")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	jsonOut := fs.Bool("json", false, "Write the protocol JSON envelope.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, targetsListHelpText())
			return 0
		}
		message, details := translateFlagParseError("targets list", err)
		writeErrorWithHelp(c.stderr, message, details, targetsListHelpText())
		return 2
	}

	catalog, err := agentprotocol.DiscoverTargets(agentprotocol.DiscoverTargetsOptions{
		StateRoot: *stateRoot,
	})
	if err != nil {
		return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetDiscoveryFailed, err.Error(), "", *jsonOut)
	}
	if *jsonOut {
		return c.writeAgentProtocolSuccess(catalog, "", true)
	}
	for _, target := range catalog.Targets {
		fmt.Fprintf(c.stdout, "%s\t%s\t%s", target.ID, target.Status, target.Label)
		if target.LocalUIURL != "" {
			fmt.Fprintf(c.stdout, "\t%s", target.LocalUIURL)
		}
		fmt.Fprintln(c.stdout)
	}
	return 0
}

func (c *cli) targetsResolveCmd(args []string) int {
	fs := newCLIFlagSet("targets resolve")
	targetName := fs.String("target", "", "Target id, label, env_public_id, or local_environment_public_id.")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).")
	jsonOut := fs.Bool("json", false, "Write the protocol JSON envelope.")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, targetsResolveHelpText())
			return 0
		}
		message, details := translateFlagParseError("targets resolve", err)
		writeErrorWithHelp(c.stderr, message, details, targetsResolveHelpText())
		return 2
	}

	if strings.TrimSpace(*targetName) == "" {
		message := "missing required flag for `redeven targets resolve`: --target"
		if *jsonOut {
			return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetMissing, message, "", true)
		}
		writeErrorWithHelp(c.stderr, message, []string{"Example: redeven targets resolve --target local"}, targetsResolveHelpText())
		return 2
	}

	catalog, err := agentprotocol.DiscoverTargets(agentprotocol.DiscoverTargetsOptions{
		StateRoot: *stateRoot,
	})
	if err != nil {
		return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetDiscoveryFailed, err.Error(), "", *jsonOut)
	}
	target, err := agentprotocol.ResolveTarget(catalog, *targetName)
	if err != nil {
		if *jsonOut {
			return c.writeAgentProtocolFailure(agentprotocol.ErrCodeTargetNotFound, "target not found", strings.TrimSpace(*targetName), true)
		}
		writeErrorWithHelp(c.stderr, "target not found", []string{"Run `redeven targets list` to see available targets."}, targetsResolveHelpText())
		return 2
	}
	if *jsonOut {
		return c.writeAgentProtocolSuccess(target, target.ID, true)
	}
	fmt.Fprintf(c.stdout, "%s\t%s\t%s\n", target.ID, target.Status, target.Label)
	return 0
}

func (c *cli) writeAgentProtocolSuccess(data any, targetID string, jsonOut bool) int {
	if !jsonOut {
		return 0
	}
	body, err := agentprotocol.MarshalJSONLine(agentprotocol.Success(data, targetID))
	if err != nil {
		fmt.Fprintf(c.stderr, "failed to encode response: %v\n", err)
		return 1
	}
	_, _ = c.stdout.Write(body)
	return 0
}

func (c *cli) writeAgentProtocolFailure(code string, message string, targetID string, jsonOut bool) int {
	if !jsonOut {
		fmt.Fprintln(c.stderr, strings.TrimSpace(message))
		return 1
	}
	body, err := agentprotocol.MarshalJSONLine(agentprotocol.Failure(code, message, targetID))
	if err != nil {
		fmt.Fprintf(c.stderr, "failed to encode response: %v\n", err)
		return 1
	}
	_, _ = c.stdout.Write(body)
	return 1
}
