package threadstore

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreFlowerThreadRoutingRoundTrip(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_src", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread source: %v", err)
	}
	if err := s.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_dest", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatalf("CreateThread dest: %v", err)
	}

	if err := s.UpsertFlowerThreadRouting(ctx, FlowerThreadRouting{
		EndpointID:          "env_1",
		ThreadID:            "th_dest",
		HomeRuntimeID:       "local-environment:test",
		HomeRuntimeKind:     "local_environment",
		OriginEnvPublicID:   "env_a",
		PrimaryTargetID:     "provider:https%3A%2F%2Fredeven.test:env:env_a",
		ActiveTargetIDsJSON: `["provider:https%3A%2F%2Fredeven.test:env:env_a"]`,
		UpdatedAtUnixMs:     100,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadRouting: %v", err)
	}
	meta, err := s.GetFlowerThreadRouting(ctx, "env_1", "th_dest")
	if err != nil {
		t.Fatalf("GetFlowerThreadRouting: %v", err)
	}
	if meta == nil || meta.ThreadID != "th_dest" || meta.UpdatedAtUnixMs != 100 {
		t.Fatalf("unexpected routing: %#v", meta)
	}
	if meta.HomeRuntimeID != "local-environment:test" || meta.HomeRuntimeKind != "local_environment" || meta.PrimaryTargetID != "provider:https%3A%2F%2Fredeven.test:env:env_a" {
		t.Fatalf("unexpected routing metadata: %#v", meta)
	}
	serialized, err := json.Marshal(meta)
	if err != nil {
		t.Fatalf("json.Marshal routing: %v", err)
	}
	if strings.Contains(string(serialized), "owner_kind") || strings.Contains(string(serialized), "parent_thread_id") || strings.Contains(string(serialized), "context_json") || strings.Contains(string(serialized), "action_json") {
		t.Fatalf("routing serialized Agent shadow fields: %s", serialized)
	}

}
