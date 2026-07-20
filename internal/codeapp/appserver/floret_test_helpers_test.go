package appserver

import (
	"testing"

	flruntime "github.com/floegence/floret/runtime"
)

func configureAppserverFloretTestTurnBinder(t *testing.T, store *flruntime.Store) *flruntime.TurnExecutionHostBinder {
	t.Helper()
	var turnBinder *flruntime.TurnExecutionHostBinder
	if err := flruntime.ConfigureHostCapabilities(store, func(bootstrap *flruntime.HostBootstrap) error {
		var err error
		turnBinder, err = flruntime.NewTurnExecutionHostBinder(bootstrap)
		return err
	}); err != nil {
		t.Fatalf("configure Floret test capabilities: %v", err)
	}
	return turnBinder
}
