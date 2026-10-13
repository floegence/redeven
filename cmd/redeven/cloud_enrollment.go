package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
)

func (c *cli) cloudEnrollmentCmd(args []string) int {
	const help = "Usage: redeven cloud enrollment <status|resume|cancel> --state-root PATH [--operation-id ID] [--yes]\nStop the Runtime before resuming or cancelling enrollment. Cancellation preserves the original identity and unknown remote result; it does not revoke Cloud approval. Resume uses that same operation without a setup ticket. Use Portal to manage approval or a new state root to register a different Runtime.\n"
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, help)
		return 0
	}
	action := args[0]
	flags := newCLIFlagSet("cloud enrollment")
	root := flags.String("state-root", "", "Runtime state root")
	id := flags.String("operation-id", "", "Original enrollment operation ID")
	yes := flags.Bool("yes", false, "Confirm local cancellation")
	if err := parseCommandFlags(flags, args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, help)
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 || action != "status" && action != "resume" && action != "cancel" || action != "status" && !validOperationID(*id) {
		writeText(c.stderr, help)
		return 2
	}
	layout, err := resolveBootstrapTargetLayout(*root)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	if action == "status" {
		pending, err := config.InspectPendingCloudEnrollment(layout.ConfigPath)
		if errors.Is(err, os.ErrNotExist) {
			fmt.Fprintln(c.stdout, "No pending Cloud enrollment.")
			return 0
		}
		if err != nil {
			fmt.Fprintln(c.stderr, "Pending enrollment is unreadable; preserve its files and use a new state root:", err)
			return 1
		}
		_ = json.NewEncoder(c.stdout).Encode(pending)
		return 0
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		fmt.Fprintln(c.stderr, "Stop this Runtime before changing its pending enrollment:", err)
		return 1
	}
	defer func() { _ = lock.Release() }()
	if action == "cancel" && !*yes && !c.confirmGatewayAction("Cancel local enrollment attempts? The original identity is retained; Cloud approval is unchanged.") {
		return 1
	}
	if err := config.SetPendingCloudEnrollmentSuspended(layout.ConfigPath, *id, action == "cancel"); err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	if action == "cancel" {
		fmt.Fprintln(c.stdout, "Enrollment cancelled locally. Resume the original operation or manage its approval in Portal.")
		return 0
	}
	pending, err := config.InspectPendingCloudEnrollment(layout.ConfigPath)
	if err != nil {
		fmt.Fprintln(c.stderr, err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err = config.BootstrapConfig(ctx, config.BootstrapArgs{StateRoot: layout.StateRoot, CloudOrigin: pending.CloudOrigin, EnvironmentID: pending.EnvironmentID, RuntimeVersion: Version})
	if err != nil {
		fmt.Fprintln(c.stderr, "Enrollment remains recoverable with the same operation ID:", err)
		return 1
	}
	fmt.Fprintln(c.stdout, "Enrollment recovered. Start this Runtime to connect.")
	return 0
}
