package flowerhost

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/flowerhostrpc"
)

func TestTargetAdvertisesCapabilitiesRequiresFilesForReadAndWrite(t *testing.T) {
	t.Parallel()

	gitOnly := FlowerTargetRef{Capabilities: []string{TargetCapabilityGit}}
	if targetAdvertisesCapabilities(gitOnly, []string{"read"}) {
		t.Fatalf("git-only target must not satisfy file read capability")
	}
	if targetAdvertisesCapabilities(gitOnly, []string{"write"}) {
		t.Fatalf("git-only target must not satisfy file write capability")
	}

	files := FlowerTargetRef{Capabilities: []string{TargetCapabilityFiles}}
	if !targetAdvertisesCapabilities(files, []string{"read", "write"}) {
		t.Fatalf("files target should satisfy file read/write capabilities")
	}
}

func TestTargetToolExecutionErrorProtocolMismatchReason(t *testing.T) {
	t.Parallel()

	err := targetToolExecutionError{err: targetConnectError{code: "target_protocol_mismatch", message: "Target tool response does not match the request."}}
	if got := err.InvalidArgumentsCode(); got != "target_protocol_mismatch" {
		t.Fatalf("code=%q, want target_protocol_mismatch", got)
	}
	if !strings.Contains(err.Error(), "Target tool response") {
		t.Fatalf("error=%q", err.Error())
	}
}

func TestResolveTargetRejectsTargetWithoutFileCapabilityForFileRead(t *testing.T) {
	t.Parallel()

	store, err := DefaultPaths(t.TempDir())
	if err != nil {
		t.Fatalf("DefaultPaths() error = %v", err)
	}
	configStore := NewConfigStore(store)
	if err := configStore.SaveTargetCache(context.Background(), TargetCache{
		Version: 1,
		Entries: []TargetCacheEntry{{
			TargetID:  "cp:test:env:env_a",
			Label:     "env-a",
			TargetURL: "https://region.example.test/?endpoint_id=env_a",
			Metadata: json.RawMessage(`{
				"provider_origin": "https://region.example.test",
				"env_public_id": "env_a",
				"capabilities": ["git"]
			}`),
		}},
	}); err != nil {
		t.Fatalf("SaveTargetCache() error = %v", err)
	}
	executor := NewTargetExecutor(TargetExecutorOptions{
		Catalog:   NewTargetCatalog(configStore),
		Connector: &TargetConnector{},
	})
	_, err = executor.resolveTarget(context.Background(), "cp:test:env:env_a", []string{"read"})
	if got := TargetConnectReason(err); got != "target_unsupported" {
		t.Fatalf("reason=%q err=%v, want target_unsupported", got, err)
	}
}

func TestTargetExecutorRejectsMismatchedResponseEnvelope(t *testing.T) {
	t.Parallel()

	call := ai.TargetToolCall{
		ToolCallID: "call_1",
		TargetID:   "cp:test:env:env_a",
		ToolName:   "file.read",
		Arguments:  json.RawMessage(`{"file_path":"README.md"}`),
	}
	resp := flowerhostrpc.TargetToolResult{
		ToolCallID: "call_1",
		TargetID:   "cp:test:env:env_b",
		ToolName:   "file.read",
		Result:     map[string]any{"ok": true},
	}
	err := validateTargetToolResponse(call, resp)
	if got := TargetConnectReason(err); got != "target_protocol_mismatch" {
		t.Fatalf("reason=%q err=%v, want target_protocol_mismatch", got, err)
	}
}
