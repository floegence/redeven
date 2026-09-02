package ai

import (
	"context"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
)

func TestProviderAdmissionKeepsFrozenPermissionSnapshot(t *testing.T) {
	r := newRun(runOptions{
		EndpointID: "endpoint_provider_admission", ThreadID: "thread_provider_admission",
		ExecutionKey: "request_provider_admission",
	})
	frozen, err := r.freezePermissionSnapshot(buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil))
	if err != nil {
		t.Fatalf("freeze permission snapshot: %v", err)
	}

	for _, request := range []flprovider.Request{{LogicalRequestID: "ordinary"}, {LogicalRequestID: "thread_title"}} {
		admitted, release, err := r.admitFloretProviderRequest(context.Background(), request)
		if err != nil {
			t.Fatalf("provider admission %q failed: %v", request.LogicalRequestID, err)
		}
		if admitted == nil || release == nil {
			t.Fatalf("provider admission %q returned an invalid lifetime handle", request.LogicalRequestID)
		}
		release()
		current := r.currentPermissionSnapshot()
		if current.SnapshotID != frozen.SnapshotID || current.SnapshotHash != frozen.SnapshotHash {
			t.Fatalf("provider admission %q replaced the frozen snapshot", request.LogicalRequestID)
		}
	}

	gateway := &recordingPreparedGateway{}
	adapter := newFloretProviderAdapter(
		gateway, "openai", "gpt-test", ProviderControls{}, TurnBudgets{}, "",
		withFloretRequestAdmission(r.admitFloretProviderRequest),
	)
	stream, err := adapter.Stream(context.Background(), flprovider.Request{
		LogicalRequestID: "thread_title",
		Messages:         []flprovider.Message{{Role: flprovider.RoleUser, Text: "Title this request."}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for event := range stream {
		if event.Type == flprovider.EventError {
			t.Fatalf("automatic title provider stream failed: %v", event.Err)
		}
	}
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	if len(gateway.requests) != 1 {
		t.Fatalf("automatic title model requests = %d, want 1", len(gateway.requests))
	}
}
