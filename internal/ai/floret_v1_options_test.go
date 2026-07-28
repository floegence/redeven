package ai

import (
	"testing"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
)

func requireFloretTurnOptions(t *testing.T, cfg flconfig.Config, options ...flruntime.TurnExecutionOption) flruntime.TurnExecutionHostOptions {
	t.Helper()
	result, err := flruntime.NewTurnExecutionHostOptions(cfg, options...)
	if err != nil {
		t.Fatalf("NewTurnExecutionHostOptions: %v", err)
	}
	return result
}

func requireFloretSubAgentOptions(t *testing.T, cfg flconfig.Config, options ...flruntime.SubAgentOption) flruntime.SubAgentHostOptions {
	t.Helper()
	result, err := flruntime.NewSubAgentHostOptions(cfg, options...)
	if err != nil {
		t.Fatalf("NewSubAgentHostOptions: %v", err)
	}
	return result
}
