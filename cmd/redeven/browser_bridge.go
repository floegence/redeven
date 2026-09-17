package main

import (
	"context"
	"fmt"
	"github.com/floegence/redeven/internal/browserbridge"
)

func (c *cli) browserBridgeCmd(args []string) int {
	// This private entry point is called only by the installed native-host shim.
	if len(args) != 2 {
		fmt.Fprintln(c.stderr, "browser bridge requires its private socket and extension origin")
		return 2
	}
	if err := browserbridge.Forward(context.Background(), args[0], args[1], c.stdin, c.stdout); err != nil {
		fmt.Fprintln(c.stderr, "browser bridge connection ended")
		return 1
	}
	return 0
}
