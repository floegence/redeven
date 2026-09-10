package ai

import (
	"context"
	"errors"
	fltools "github.com/floegence/floret/v7/tools"
	"testing"
)

func TestFlowerCancellationWithoutExitProofRemainsUnconfirmed(t *testing.T) {
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "call", ToolName: "terminal.exec", Status: toolResultStatusAborted, Details: "execution context canceled"})
	if err != nil {
		t.Fatal(err)
	}
	if !errors.Is(result.DispatchErr, context.Canceled) {
		t.Fatalf("unconfirmed cancellation became a normal result: %#v", result)
	}
}

func TestFlowerConfirmedCancellationUsesPublishedOutcome(t *testing.T) {
	result, err := floretToolResultFromFlower(nil, ToolResult{ToolID: "call", ToolName: "terminal.exec", Status: toolResultStatusAborted, Details: "process reaped", cancellationConfirmed: true})
	if err != nil || result.DispatchErr != nil || result.IsError || result.Structured["outcome"] != fltools.ResultOutcomeCanceled {
		t.Fatalf("confirmed cancellation=%#v, %v", result, err)
	}
}
