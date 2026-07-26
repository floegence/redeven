package codeapp

import (
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestResolvePluginPlatformSessionMetaRejectsSyntheticLocalUIFallback(t *testing.T) {
	t.Parallel()

	policy, err := config.ParsePermissionPolicyPreset("execute_read_write")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset: %v", err)
	}
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(cfgPath, &config.Config{PermissionPolicy: policy}); err != nil {
		t.Fatalf("config.Save: %v", err)
	}

	resolver := resolvePluginPlatformSessionMeta(Options{
		ConfigPath:     cfgPath,
		LocalUIEnabled: true,
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			return nil, false
		},
	})

	if meta, ok := resolver("local-ui"); ok || meta != nil {
		t.Fatalf("synthetic local-ui session = %+v ok=%v, want rejected", meta, ok)
	}
}

func TestResolvePluginPlatformSessionMetaKeepsRemoteResolverAuthoritative(t *testing.T) {
	t.Parallel()

	remote := &session.Meta{
		ChannelID:    "ch_remote",
		EndpointID:   "env_remote",
		UserPublicID: "user_remote",
	}
	resolver := resolvePluginPlatformSessionMeta(Options{
		LocalUIEnabled: true,
		ResolvePluginSessionMeta: func(channelID string) (*session.Meta, bool) {
			if channelID == "ch_remote" {
				return remote, true
			}
			return nil, false
		},
	})

	meta, ok := resolver("ch_remote")
	if !ok || meta != remote {
		t.Fatalf("remote resolver result = %+v ok=%v, want original remote session", meta, ok)
	}
}

func TestResolvePluginPlatformSessionMetaDoesNotSynthesizeLocalUIWhenDisabled(t *testing.T) {
	t.Parallel()

	resolver := resolvePluginPlatformSessionMeta(Options{
		LocalUIEnabled: false,
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			return nil, false
		},
	})

	if meta, ok := resolver("local-ui"); ok || meta != nil {
		t.Fatalf("local-ui session = %+v ok=%v, want no synthetic session when Local UI is disabled", meta, ok)
	}
}
