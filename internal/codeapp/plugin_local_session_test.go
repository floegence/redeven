package codeapp

import (
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestResolvePluginPlatformSessionMetaAddsLocalUIFallback(t *testing.T) {
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

	meta, ok := resolver("local-ui")
	if !ok || meta == nil {
		t.Fatalf("local-ui session was not resolved")
	}
	if meta.ChannelID != "local-ui" || meta.EndpointID != "env_local" || meta.UserPublicID != "user_local" {
		t.Fatalf("local-ui identity = %+v, want synthetic local Env App session", meta)
	}
	if meta.FloeApp != "com.floegence.redeven.agent" || meta.CodeSpaceID != "env-ui" || meta.SessionKind != "envapp_rpc" {
		t.Fatalf("local-ui app context = %+v, want Env App context", meta)
	}
	if !meta.CanRead || !meta.CanWrite || !meta.CanExecute || !meta.CanAdmin {
		t.Fatalf("local-ui permissions = read:%v write:%v execute:%v admin:%v, want rwx admin", meta.CanRead, meta.CanWrite, meta.CanExecute, meta.CanAdmin)
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
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
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
