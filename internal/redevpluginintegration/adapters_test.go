package redevpluginintegration

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/manifest"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/websecurity"
)

func TestSessionResolverProjectsRedevenSessionPermissions(t *testing.T) {
	cache := newSessionPermissionCache()
	resolver := &sessionResolver{
		resolve: func(channelID string) (*session.Meta, bool) {
			if channelID != "ch_123" {
				return nil, false
			}
			return &session.Meta{
				ChannelID:         "ch_123",
				EndpointID:        "env_123",
				FloeApp:           "com.floegence.redeven.agent",
				UserPublicID:      "user_123",
				NamespacePublicID: "ns_123",
				CanRead:           true,
				CanWrite:          false,
				CanExecute:        true,
				CanAdmin:          true,
			}, true
		},
		cache: cache,
	}
	sessionCtx, err := resolver.ResolveSession(context.Background(), "ch_123")
	if err != nil {
		t.Fatalf("ResolveSession() error = %v", err)
	}
	if sessionCtx.SessionChannelIDHash == "" || sessionCtx.OwnerUserHash == "" || sessionCtx.OwnerEnvHash == "" || sessionCtx.CSRFGeneration == "" {
		t.Fatalf("session hashes must be populated: %+v", sessionCtx)
	}
	if !sessionCtx.Permissions.Read || sessionCtx.Permissions.Write || !sessionCtx.Permissions.Execute || !sessionCtx.Permissions.Admin {
		t.Fatalf("permissions = %+v", sessionCtx.Permissions)
	}
	policy := &policyAdapter{sessions: cache}
	if decision, err := policy.EvaluateLocalPolicy(context.Background(), sessionctx.Context{SessionChannelIDHash: sessionCtx.SessionChannelIDHash}, host.PluginRef{}, manifest.MethodSpec{Effect: manifest.MethodEffectExecute}); err != nil || decision != host.PolicyAllow {
		t.Fatalf("execute decision = %s err=%v, want allow", decision, err)
	}
	if decision, err := policy.EvaluateLocalPolicy(context.Background(), sessionctx.Context{SessionChannelIDHash: sessionCtx.SessionChannelIDHash}, host.PluginRef{}, manifest.MethodSpec{Effect: manifest.MethodEffectWrite}); err != nil || decision != host.PolicyDeny {
		t.Fatalf("write decision = %s err=%v, want deny", decision, err)
	}
}

func TestWebSecurityGuardUsesInternalRouteRolesAndStrictCSRF(t *testing.T) {
	cache := newSessionPermissionCache()
	cache.Put(sessionctx.Context{
		SessionChannelIDHash: "session_hash",
		CSRFGeneration:       "csrf_token",
	})
	guard := webSecurityGuard{sessions: cache}

	envReq := WithRouteRole(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil), RouteRoleEnvTrusted)
	if _, decision, err := guard.Evaluate(envReq); err != nil || decision != websecurity.OriginAllow {
		t.Fatalf("env management decision = %s err=%v, want allow", decision, err)
	}
	pluginReq := WithRouteRole(httptest.NewRequest(http.MethodPost, "/_redevplugin/bootstrap", nil), RouteRolePluginSandbox)
	if _, decision, err := guard.Evaluate(pluginReq); err != nil || decision != websecurity.OriginAllow {
		t.Fatalf("plugin sandbox decision = %s err=%v, want allow", decision, err)
	}
	badReq := WithRouteRole(httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil), RouteRolePluginSandbox)
	if _, decision, err := guard.Evaluate(badReq); !errors.Is(err, websecurity.ErrOriginDenied) || decision != websecurity.OriginDeny {
		t.Fatalf("plugin management decision = %s err=%v, want origin denied", decision, err)
	}
	unsafeReq := httptest.NewRequest(http.MethodPost, "/_redevplugin/api/plugins/install", nil)
	if err := guard.ValidateCSRF(unsafeReq, "session_hash"); !errors.Is(err, websecurity.ErrCSRFRequired) {
		t.Fatalf("missing csrf error = %v, want ErrCSRFRequired", err)
	}
	unsafeReq.Header.Set(csrfHeader, "wrong")
	if err := guard.ValidateCSRF(unsafeReq, "session_hash"); !errors.Is(err, websecurity.ErrCSRFInvalid) {
		t.Fatalf("wrong csrf error = %v, want ErrCSRFInvalid", err)
	}
	unsafeReq.Header.Set(csrfHeader, "csrf_token")
	if err := guard.ValidateCSRF(unsafeReq, "session_hash"); err != nil {
		t.Fatalf("valid csrf error = %v", err)
	}
}

func TestRuntimeArtifactResolverFailsClosedWhenPublishedRuntimeMissing(t *testing.T) {
	resolver := &runtimeArtifactResolver{stateRoot: t.TempDir()}
	if path, err := resolver.RuntimePath(context.Background(), host.RuntimeTarget{OS: "plan9", Arch: "mips"}); err == nil || path != "" {
		t.Fatalf("RuntimePath() = %q, %v; want missing artifact error", path, err)
	}
}

func TestPackageTrustVerifierDoesNotPromotePublishedTrustWithoutVerifier(t *testing.T) {
	result, err := strictPackageTrustVerifier{}.VerifyPackageTrust(context.Background(), host.PackageTrustVerificationRequest{
		RequestedTrustState: registry.TrustVerified,
	})
	if err != nil {
		t.Fatalf("VerifyPackageTrust() error = %v", err)
	}
	if result.TrustState != registry.TrustNeedsReview || !strings.Contains(result.Metadata["redeven.trust.reason"], "not_configured") {
		t.Fatalf("trust result = %+v, want needs_review with reason", result)
	}
}

func TestNewCreatesDurableReDevPluginState(t *testing.T) {
	stateDir := t.TempDir()
	integration, err := New(context.Background(), Options{
		StateDir:   stateDir,
		StateRoot:  t.TempDir(),
		ConfigPath: filepath.Join(stateDir, "config.json"),
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			return nil, false
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() { _ = integration.Close() })
	for _, rel := range []string{
		"apps/redevplugin/db/registry.sqlite",
		"apps/redevplugin/db/operations.sqlite",
		"apps/redevplugin/assets",
		"apps/redevplugin/storage",
	} {
		if _, err := os.Stat(filepath.Join(stateDir, rel)); err != nil {
			t.Fatalf("expected durable state %s: %v", rel, err)
		}
	}
}
