package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/runtimemanagement"
)

func desktopTargetProcessInventoryHelpText() string {
	return "redeven desktop-target-process-inventory --target-root <path>\n"
}

func desktopTargetProcessStopHelpText() string {
	return "redeven desktop-target-process-stop --target-root <path> --expected-inventory-digest <sha256> [--grace-period 5s]\n"
}

func (c *cli) desktopTargetProcessInventoryCmd(args []string) int {
	fs := newCLIFlagSet("desktop-target-process-inventory")
	targetRoot := fs.String("target-root", "", "Exact Redeven-owned target root.")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, desktopTargetProcessInventoryHelpText())
			return 0
		}
		writeErrorWithHelp(c.stderr, err.Error(), nil, desktopTargetProcessInventoryHelpText())
		return 2
	}
	if fs.NArg() != 0 {
		writeErrorWithHelp(c.stderr, "`redeven desktop-target-process-inventory` does not accept positional arguments", nil, desktopTargetProcessInventoryHelpText())
		return 2
	}
	inventory, err := runtimemanagement.InspectTargetProcesses(context.Background(), runtimemanagement.TargetProcessOptions{TargetRoot: *targetRoot})
	if err != nil {
		writeRuntimeProcessJSONError(c.stdout, err)
		return 1
	}
	if err := json.NewEncoder(c.stdout).Encode(inventory); err != nil {
		fmt.Fprintf(c.stderr, "desktop-target-process-inventory failed: %v\n", err)
		return 1
	}
	return 0
}

func (c *cli) desktopTargetProcessStopCmd(args []string) int {
	fs := newCLIFlagSet("desktop-target-process-stop")
	targetRoot := fs.String("target-root", "", "Exact Redeven-owned target root.")
	expectedDigest := fs.String("expected-inventory-digest", "", "Expected process inventory digest.")
	gracePeriod := fs.Duration("grace-period", 5*time.Second, "Time to wait after SIGTERM before identity-checked SIGKILL.")
	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, desktopTargetProcessStopHelpText())
			return 0
		}
		writeErrorWithHelp(c.stderr, err.Error(), nil, desktopTargetProcessStopHelpText())
		return 2
	}
	if fs.NArg() != 0 || strings.TrimSpace(*expectedDigest) == "" {
		writeErrorWithHelp(c.stderr, "target root and expected inventory digest are required", nil, desktopTargetProcessStopHelpText())
		return 2
	}
	result, err := runtimemanagement.StopTargetProcesses(
		context.Background(),
		runtimemanagement.TargetProcessOptions{TargetRoot: *targetRoot},
		*expectedDigest,
		*gracePeriod,
	)
	if err != nil {
		writeRuntimeProcessJSONError(c.stdout, err)
		return 1
	}
	if err := json.NewEncoder(c.stdout).Encode(result); err != nil {
		fmt.Fprintf(c.stderr, "desktop-target-process-stop failed: %v\n", err)
		return 1
	}
	return 0
}
