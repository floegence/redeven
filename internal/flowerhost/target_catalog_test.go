package flowerhost

import (
	"context"
	"encoding/json"
	"testing"
)

func TestTargetCatalogProjectsDesktopTargetCache(t *testing.T) {
	t.Parallel()

	paths, err := DefaultPaths(t.TempDir())
	if err != nil {
		t.Fatalf("DefaultPaths: %v", err)
	}
	store := NewConfigStore(paths)
	metadata, err := json.Marshal(map[string]any{
		"provider_origin":           "https://region.example.test",
		"provider_id":               "redeven_reference",
		"env_public_id":             "env_a",
		"namespace_public_id":       "ns_1",
		"runtime_status":            "online",
		"connect_state":             TargetConnectConnectable,
		"capabilities":              []string{TargetCapabilityFiles, TargetCapabilityFlowerRPC},
		"last_connected_at_unix_ms": float64(123),
	})
	if err != nil {
		t.Fatalf("Marshal metadata: %v", err)
	}
	if err := store.SaveTargetCache(context.Background(), TargetCache{
		Version: 1,
		Entries: []TargetCacheEntry{{
			TargetID:         "cp:https%3A%2F%2Fregion.example.test:env:env_a",
			Label:            "staging-api",
			TargetURL:        "https://region.example.test/environments/env_a",
			LastSeenAtUnixMs: 456,
			Metadata:         metadata,
		}},
	}); err != nil {
		t.Fatalf("SaveTargetCache: %v", err)
	}

	targets, err := NewTargetCatalog(store).ListTargets(context.Background())
	if err != nil {
		t.Fatalf("ListTargets: %v", err)
	}
	if len(targets) != 1 {
		t.Fatalf("targets=%#v, want one", targets)
	}
	target := targets[0]
	if target.TargetID != "cp:https%3A%2F%2Fregion.example.test:env:env_a" || target.EnvPublicID != "env_a" {
		t.Fatalf("target identity=%#v", target)
	}
	if target.Label != "staging-api" || target.ConnectState != TargetConnectConnectable {
		t.Fatalf("target display/state=%#v", target)
	}
	if len(target.Capabilities) != 2 || target.Capabilities[0] != TargetCapabilityFiles || target.Capabilities[1] != TargetCapabilityFlowerRPC {
		t.Fatalf("capabilities=%#v", target.Capabilities)
	}
}

func TestTargetCatalogDoesNotInferCapabilities(t *testing.T) {
	t.Parallel()

	metadata, err := json.Marshal(map[string]any{
		"provider_origin": "https://region.example.test",
		"env_public_id":   "env_a",
	})
	if err != nil {
		t.Fatalf("Marshal metadata: %v", err)
	}
	target := targetRefFromCacheEntry(TargetCacheEntry{
		TargetID: "cp:test:env:env_a",
		Label:    "env-a",
		Metadata: metadata,
	})
	if len(target.Capabilities) != 0 {
		t.Fatalf("capabilities=%#v, want none when metadata does not advertise them", target.Capabilities)
	}
}

func TestTargetCatalogDoesNotInferIdentityFromDisplayURL(t *testing.T) {
	t.Parallel()

	target := targetRefFromCacheEntry(TargetCacheEntry{
		TargetID:  "cp:test:env:env_a",
		Label:     "env-a",
		TargetURL: "https://region.example.test/v1/channel/init/entry?endpoint_id=env_a",
	})
	if target.ProviderOrigin != "" || target.EnvPublicID != "" {
		t.Fatalf("target identity should come from metadata only: %#v", target)
	}
}
