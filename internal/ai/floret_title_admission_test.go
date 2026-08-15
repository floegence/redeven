package ai

import (
	"context"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v4/provider"
)

func TestAutomaticTitleProviderAdmissionDoesNotRequireCanonicalPermissionOwner(t *testing.T) {
	r := &run{}

	if _, _, err := r.admitFloretProviderRequest(context.Background(), flprovider.Request{}); err == nil || !strings.Contains(err.Error(), "canonical permission owner is unavailable") {
		t.Fatalf("ordinary provider admission error = %v, want missing canonical permission owner", err)
	}

	admitted, release, err := r.admitFloretProviderRequest(context.Background(), flprovider.Request{LogicalRequestID: "thread_title"})
	if err != nil {
		t.Fatalf("automatic title admission failed: %v", err)
	}
	if admitted == nil || release == nil {
		t.Fatal("automatic title admission returned an invalid lifetime handle")
	}
	release()

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
