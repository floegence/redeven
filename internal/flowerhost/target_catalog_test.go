package flowerhost

import (
	"context"
	"encoding/json"
	"strings"
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
		"provider_origin":           "https://redeven.test",
		"provider_id":               "redeven_reference",
		"env_public_id":             "env_a",
		"namespace_public_id":       "ns_1",
		"runtime_status":            "online",
		"connect_state":             TargetConnectConnectable,
		"capabilities":              []string{TargetCapabilityFiles, TargetCapabilityGit},
		"last_connected_at_unix_ms": float64(123),
	})
	if err != nil {
		t.Fatalf("Marshal metadata: %v", err)
	}
	if err := store.SaveTargetCache(context.Background(), TargetCache{
		Version: 1,
		Entries: []TargetCacheEntry{{
			TargetID:         "provider:https%3A%2F%2Fredeven.test:env:env_a",
			Label:            "staging-api",
			TargetURL:        "https://dev.redeven.test/environments/env_a",
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
	if target.TargetID != "provider:https%3A%2F%2Fredeven.test:env:env_a" || target.EnvPublicID != "env_a" {
		t.Fatalf("target identity=%#v", target)
	}
	if target.Label != "staging-api" || target.ConnectState != TargetConnectConnectable {
		t.Fatalf("target display/state=%#v", target)
	}
	if len(target.Capabilities) != 2 || target.Capabilities[0] != TargetCapabilityFiles || target.Capabilities[1] != TargetCapabilityGit {
		t.Fatalf("capabilities=%#v", target.Capabilities)
	}
}

func TestTargetCacheSanitizesLegacySensitiveMetadata(t *testing.T) {
	t.Parallel()

	paths, err := DefaultPaths(t.TempDir())
	if err != nil {
		t.Fatalf("DefaultPaths: %v", err)
	}
	store := NewConfigStore(paths)
	metadata, err := json.Marshal(map[string]any{
		"target_kind":               TargetKindProviderEnvironment,
		"provider_origin":           "https://redeven.test",
		"provider_id":               "redeven_reference",
		"env_public_id":             "env_a",
		"namespace_public_id":       "ns_1",
		"runtime_status":            "online",
		"connect_state":             TargetConnectConnectable,
		"capabilities":              []string{TargetCapabilityFiles, TargetCapabilityFiles, TargetCapabilityMonitor},
		"last_connected_at_unix_ms": float64(123),
		"last_connect_error": map[string]any{
			"code":         "TEMPORARY_FAILURE",
			"message":      "The provider was unavailable.",
			"at_unix_ms":   float64(124),
			"entry_ticket": "nested-entry-ticket-must-not-leak",
		},
		"control_plane_access_token": "provider-token-must-not-leak",
		"bootstrap_ticket":           "boot-ticket-must-not-leak",
		"entry_ticket":               "entry-ticket-must-not-leak",
		"e2ee_psk":                   "psk-must-not-leak",
	})
	if err != nil {
		t.Fatalf("Marshal metadata: %v", err)
	}
	if err := store.SaveTargetCache(context.Background(), TargetCache{
		Version: 1,
		Entries: []TargetCacheEntry{{
			TargetID: "provider:https%3A%2F%2Fredeven.test:env:env_a",
			Label:    "env-a",
			Metadata: metadata,
		}},
	}); err != nil {
		t.Fatalf("SaveTargetCache: %v", err)
	}
	cache, err := store.LoadTargetCache(context.Background())
	if err != nil {
		t.Fatalf("LoadTargetCache: %v", err)
	}
	if len(cache.Entries) != 1 {
		t.Fatalf("entries=%#v, want one", cache.Entries)
	}
	serialized := string(cache.Entries[0].Metadata)
	for _, forbidden := range []string{
		"control_plane_access_token",
		"provider-token-must-not-leak",
		"bootstrap_ticket",
		"boot-ticket-must-not-leak",
		"entry_ticket",
		"entry-ticket-must-not-leak",
		"nested-entry-ticket-must-not-leak",
		"e2ee_psk",
		"psk-must-not-leak",
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("sanitized metadata leaked %q in %s", forbidden, serialized)
		}
	}
	var sanitized map[string]any
	if err := json.Unmarshal(cache.Entries[0].Metadata, &sanitized); err != nil {
		t.Fatalf("Unmarshal sanitized metadata: %v", err)
	}
	if sanitized["provider_origin"] != "https://redeven.test" || sanitized["env_public_id"] != "env_a" {
		t.Fatalf("sanitized identity metadata=%#v", sanitized)
	}
	capabilities, ok := sanitized["capabilities"].([]any)
	if !ok || len(capabilities) != 2 || capabilities[0] != TargetCapabilityFiles || capabilities[1] != TargetCapabilityMonitor {
		t.Fatalf("sanitized capabilities=%#v", sanitized["capabilities"])
	}
	lastConnectError, ok := sanitized["last_connect_error"].(map[string]any)
	if !ok || lastConnectError["code"] != "TEMPORARY_FAILURE" || lastConnectError["message"] != "The provider was unavailable." {
		t.Fatalf("sanitized last_connect_error=%#v", sanitized["last_connect_error"])
	}
}

func TestTargetCatalogDoesNotInferCapabilities(t *testing.T) {
	t.Parallel()

	metadata, err := json.Marshal(map[string]any{
		"provider_origin": "https://redeven.test",
		"env_public_id":   "env_a",
	})
	if err != nil {
		t.Fatalf("Marshal metadata: %v", err)
	}
	target := targetRefFromCacheEntry(TargetCacheEntry{
		TargetID: "provider:https%3A%2F%2Fredeven.test:env:env_a",
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
		TargetID:  "provider:https%3A%2F%2Fredeven.test:env:env_a",
		Label:     "env-a",
		TargetURL: "https://dev.redeven.test/environments/env_a",
	})
	if target.ProviderOrigin != "" || target.EnvPublicID != "" {
		t.Fatalf("target identity should come from metadata only: %#v", target)
	}
}
