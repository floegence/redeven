package redevpluginintegration

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/pluginmarket"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/manifest"
	"github.com/floegence/redevplugin/v3/pkg/observability"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
	"github.com/floegence/redevplugin/v3/pkg/registry"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
	"github.com/floegence/redevplugin/v3/pkg/websecurity"
)

func TestSessionAdapterDerivesIdentityAndPermissionsFromAuthenticatedSession(t *testing.T) {
	adapter, err := newSessionAdapter(func(channelID string) (*session.Meta, bool) {
		if channelID != "ch_123" {
			return nil, false
		}
		return &session.Meta{
			ChannelID:    "ch_123",
			EndpointID:   "env_123",
			FloeApp:      "com.floegence.redeven.agent",
			UserPublicID: "user_123",
			CanRead:      true,
			CanWrite:     false,
			CanExecute:   true,
			CanAdmin:     true,
		}, true
	}, testPermissionPolicy(t, "execute_read"))
	if err != nil {
		t.Fatalf("newSessionAdapter() error = %v", err)
	}

	req := authenticatedRequest(http.MethodPost, "/_redevplugin/api/plugins/enable", "ch_123")
	sessionContext, err := adapter.Authenticate(req)
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if !sessionContext.Valid() || sessionContext.OwnerSessionHash == sessionContext.SessionChannelIDHash {
		t.Fatalf("derived session context is invalid or aliases independent hashes: %+v", sessionContext)
	}
	if sessionContext.OwnerUserHash == "user_123" || sessionContext.OwnerEnvHash == "env_123" {
		t.Fatalf("raw owner identifiers crossed the adapter boundary: %+v", sessionContext)
	}

	if decision, err := adapter.EvaluateLocalPolicy(context.Background(), sessionContext, host.PluginRef{}, manifest.MethodSpec{Effect: manifest.MethodEffectExecute}); err != nil || decision != host.PolicyAllow {
		t.Fatalf("execute decision = %s err=%v, want allow", decision, err)
	}
	if decision, err := adapter.EvaluateLocalPolicy(context.Background(), sessionContext, host.PluginRef{}, manifest.MethodSpec{Effect: manifest.MethodEffectWrite}); err != nil || decision != host.PolicyDeny {
		t.Fatalf("write decision = %s err=%v, want deny", decision, err)
	}
	if err := adapter.Authorize(context.Background(), host.AuthorizationRequest{
		Session: sessionContext,
		Action:  host.ManagementActionListPlugins,
		Target:  host.AuthorizationTarget{Kind: host.ResourcePlugin, Collection: true},
	}); err != nil {
		t.Fatalf("direct Host read authorization error = %v", err)
	}
	for _, request := range []host.AuthorizationRequest{
		{
			Session: sessionContext,
			Action:  host.ManagementActionDisposeSurface,
			Target:  host.AuthorizationTarget{Kind: host.ResourceSurface, ID: "surface_123"},
		},
		{
			Session: sessionContext,
			Action:  host.ManagementActionRevokeSessionScope,
			Target:  host.AuthorizationTarget{Kind: host.ResourceSessionScope, Collection: true},
		},
	} {
		if err := adapter.Authorize(context.Background(), request); err != nil {
			t.Fatalf("read-authorized surface teardown %s error = %v", request.Action, err)
		}
	}
	if err := adapter.Authorize(context.Background(), host.AuthorizationRequest{
		Session: sessionContext,
		Action:  host.ManagementActionPatchPluginSettings,
		Target:  host.AuthorizationTarget{Kind: host.ResourceSettings, ID: "plugini_123"},
	}); !errors.Is(err, host.ErrActionDenied) {
		t.Fatalf("direct Host write authorization error = %v, want ErrActionDenied", err)
	}
}

func TestSessionAdapterOwnsPermissionPolicySnapshot(t *testing.T) {
	policy := testPermissionPolicy(t, "read_only")
	adapter, err := newSessionAdapter(func(channelID string) (*session.Meta, bool) {
		return &session.Meta{
			ChannelID:    channelID,
			EndpointID:   "env_snapshot",
			UserPublicID: "user_snapshot",
			CanRead:      true,
		}, true
	}, policy)
	if err != nil {
		t.Fatal(err)
	}
	policy.LocalMax.Read = false

	resolved, err := adapter.resolver.ResolveSession(context.Background(), "ch_snapshot")
	if err != nil {
		t.Fatal(err)
	}
	if err := adapter.Authorize(context.Background(), host.AuthorizationRequest{
		Session: resolved,
		Action:  host.ManagementActionListPlugins,
		Target:  host.AuthorizationTarget{Kind: host.ResourcePlugin, Collection: true},
	}); err != nil {
		t.Fatalf("authorization changed after caller mutated its policy: %v", err)
	}
}

func TestMethodAuthorizationDefersExactEffectToLocalPolicy(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		perms sessionPermissions
	}{
		{name: "read", perms: sessionPermissions{read: true}},
		{name: "write", perms: sessionPermissions{write: true}},
		{name: "execute", perms: sessionPermissions{execute: true}},
		{name: "admin", perms: sessionPermissions{admin: true}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			for _, action := range []host.ManagementAction{
				host.ManagementActionCallPluginMethod,
				host.ManagementActionPrepareMethodConfirmation,
				host.ManagementActionInvokeIntent,
				host.ManagementActionCancelExecution,
			} {
				if !permissionsAllowAction(testCase.perms, action) {
					t.Fatalf("%s unexpectedly denied for %+v", action, testCase.perms)
				}
			}
		})
	}
	if permissionsAllowAction(sessionPermissions{}, host.ManagementActionCallPluginMethod) {
		t.Fatal("method call accepted without any data-plane permission")
	}
}

func TestSharedPluginHostControlRequiresAdmin(t *testing.T) {
	for _, action := range []host.ManagementAction{
		host.ManagementActionStartRuntime,
		host.ManagementActionStopRuntime,
		host.ManagementActionRecoverEnabledPlugins,
	} {
		if permissionsAllowAction(sessionPermissions{execute: true}, action) {
			t.Fatalf("%s accepted execute-only shared runtime control", action)
		}
		if !permissionsAllowAction(sessionPermissions{admin: true}, action) {
			t.Fatalf("%s denied admin shared runtime control", action)
		}
	}
}

func TestExternalPackageAdmissionUsesExplicitPermissionTiers(t *testing.T) {
	for _, action := range []host.ManagementAction{
		host.ManagementActionInspectExternalPackage,
		host.ManagementActionInstallInspectedPackage,
	} {
		if permissionsAllowAction(sessionPermissions{read: true}, action) {
			t.Fatalf("%s accepted read-only external package mutation", action)
		}
		if !permissionsAllowAction(sessionPermissions{admin: true}, action) {
			t.Fatalf("%s denied admin external package mutation", action)
		}
	}
	for _, action := range []host.ManagementAction{
		host.ManagementActionListPermissionGrants,
		host.ManagementActionGetPermissionRequirements,
	} {
		if permissionsAllowAction(sessionPermissions{}, action) {
			t.Fatalf("%s accepted without read permission", action)
		}
		if !permissionsAllowAction(sessionPermissions{read: true}, action) {
			t.Fatalf("%s denied read-only query", action)
		}
	}
}

func TestReleaseInstallUsesExplicitPermissionTiers(t *testing.T) {
	if permissionsAllowAction(sessionPermissions{read: true}, host.ManagementActionInstallReleaseRef) {
		t.Fatal("release install start accepted read-only session")
	}
	if !permissionsAllowAction(sessionPermissions{admin: true}, host.ManagementActionInstallReleaseRef) {
		t.Fatal("release install start denied admin session")
	}
	for _, action := range []host.ManagementAction{
		host.ManagementActionGetExecution,
		host.ManagementActionListExecutions,
	} {
		if permissionsAllowAction(sessionPermissions{}, action) {
			t.Fatalf("%s accepted without read permission", action)
		}
		if !permissionsAllowAction(sessionPermissions{read: true}, action) {
			t.Fatalf("%s denied read-only session", action)
		}
	}
}

func TestSessionAdapterKeepsUserScopesDistinctWithinEnvironment(t *testing.T) {
	adapter, err := newSessionAdapter(func(channelID string) (*session.Meta, bool) {
		userID := "user_a"
		if channelID == "ch_b" {
			userID = "user_b"
		}
		return &session.Meta{
			ChannelID:    channelID,
			EndpointID:   "env_shared",
			UserPublicID: userID,
			CanRead:      true,
		}, true
	}, testPermissionPolicy(t, "read_only"))
	if err != nil {
		t.Fatalf("newSessionAdapter() error = %v", err)
	}

	first, err := adapter.resolver.ResolveSession(context.Background(), "ch_a")
	if err != nil {
		t.Fatalf("resolve first session: %v", err)
	}
	second, err := adapter.resolver.ResolveSession(context.Background(), "ch_b")
	if err != nil {
		t.Fatalf("resolve second session: %v", err)
	}
	if first.OwnerEnvHash != second.OwnerEnvHash || first.OwnerUserHash == second.OwnerUserHash {
		t.Fatalf("owner projection mismatch: first=%+v second=%+v", first, second)
	}
	firstScope, err := first.ResourceScope(sessionctx.ScopeUser)
	if err != nil {
		t.Fatal(err)
	}
	secondScope, err := second.ResourceScope(sessionctx.ScopeUser)
	if err != nil {
		t.Fatal(err)
	}
	if firstScope.Matches(secondScope) {
		t.Fatalf("distinct users unexpectedly share a user resource scope: %+v", firstScope)
	}
}

func TestSessionAdapterRejectsMissingOrMismatchedIdentity(t *testing.T) {
	testCases := []struct {
		name string
		meta session.Meta
	}{
		{name: "channel mismatch", meta: session.Meta{ChannelID: "ch_other", EndpointID: "env_1", UserPublicID: "user_1"}},
		{name: "missing channel", meta: session.Meta{EndpointID: "env_1", UserPublicID: "user_1"}},
		{name: "missing user", meta: session.Meta{ChannelID: "ch_1", EndpointID: "env_1"}},
		{name: "missing environment", meta: session.Meta{ChannelID: "ch_1", UserPublicID: "user_1"}},
		{name: "non canonical user", meta: session.Meta{ChannelID: "ch_1", EndpointID: "env_1", UserPublicID: " user_1"}},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			adapter, err := newSessionAdapter(func(string) (*session.Meta, bool) {
				meta := testCase.meta
				return &meta, true
			}, testPermissionPolicy(t, "read_only"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := adapter.resolver.ResolveSession(context.Background(), "ch_1"); !errors.Is(err, sessionctx.ErrSessionRequired) {
				t.Fatalf("ResolveSession() error = %v, want ErrSessionRequired", err)
			}
		})
	}
}

func TestSessionCacheRejectsReusedChannelWithStaleOwnerContext(t *testing.T) {
	currentUser := "user_a"
	adapter, err := newSessionAdapter(func(channelID string) (*session.Meta, bool) {
		return &session.Meta{
			ChannelID:    channelID,
			EndpointID:   "env_shared",
			UserPublicID: currentUser,
			CanRead:      true,
		}, true
	}, testPermissionPolicy(t, "read_only"))
	if err != nil {
		t.Fatal(err)
	}
	stale, err := adapter.resolver.ResolveSession(context.Background(), "ch_reused")
	if err != nil {
		t.Fatal(err)
	}
	currentUser = "user_b"
	if _, err := adapter.resolver.ResolveSession(context.Background(), "ch_reused"); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Authorize(context.Background(), host.AuthorizationRequest{
		Session: stale,
		Action:  host.ManagementActionListPlugins,
		Target:  host.AuthorizationTarget{Kind: host.ResourcePlugin, Collection: true},
	}); !errors.Is(err, host.ErrActionDenied) {
		t.Fatalf("stale session authorization error = %v, want ErrActionDenied", err)
	}
}

func TestWebSecurityGuardRequiresExactTrustedOriginAndCSRF(t *testing.T) {
	adapter, err := newSessionAdapter(func(channelID string) (*session.Meta, bool) {
		if channelID != "ch_123" {
			return nil, false
		}
		return &session.Meta{
			ChannelID:    channelID,
			EndpointID:   "env_123",
			UserPublicID: "user_123",
			CanRead:      true,
		}, true
	}, testPermissionPolicy(t, "read_only"))
	if err != nil {
		t.Fatal(err)
	}

	valid := authenticatedRequest(http.MethodPost, "/_redevplugin/api/plugins/surfaces/surface_1/assets/read", "ch_123")
	valid.Host = "env.example.test"
	valid.Header.Set("Origin", "https://env.example.test")
	valid.Header.Set(csrfHeader, csrfProof)
	valid, err = WithTrustedOrigin(valid, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	sessionContext, err := adapter.Authenticate(valid)
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if err := adapter.ValidateOrigin(valid, sessionContext, websecurity.OriginPolicyTrustedHost); err != nil {
		t.Fatalf("ValidateOrigin() error = %v", err)
	}
	if err := adapter.ValidateCSRF(valid, sessionContext, websecurity.CSRFPolicyRequired); err != nil {
		t.Fatalf("ValidateCSRF() error = %v", err)
	}

	for _, testCase := range []struct {
		name      string
		configure func(*http.Request)
	}{
		{name: "missing", configure: func(r *http.Request) { r.Header.Del("Origin") }},
		{name: "null", configure: func(r *http.Request) { r.Header.Set("Origin", "null") }},
		{name: "foreign", configure: func(r *http.Request) { r.Header.Set("Origin", "https://foreign.example.test") }},
		{name: "duplicate", configure: func(r *http.Request) { r.Header.Add("Origin", "https://env.example.test") }},
	} {
		t.Run("origin_"+testCase.name, func(t *testing.T) {
			req := valid.Clone(valid.Context())
			req.Header = valid.Header.Clone()
			testCase.configure(req)
			if err := adapter.ValidateOrigin(req, sessionContext, websecurity.OriginPolicyTrustedHost); !errors.Is(err, websecurity.ErrOriginDenied) {
				t.Fatalf("ValidateOrigin() error = %v, want ErrOriginDenied", err)
			}
		})
	}

	missingCSRF := valid.Clone(valid.Context())
	missingCSRF.Header = valid.Header.Clone()
	missingCSRF.Header.Del(csrfHeader)
	if err := adapter.ValidateCSRF(missingCSRF, sessionContext, websecurity.CSRFPolicyRequired); !errors.Is(err, websecurity.ErrCSRFRequired) {
		t.Fatalf("missing CSRF error = %v, want ErrCSRFRequired", err)
	}
	wrongCSRF := valid.Clone(valid.Context())
	wrongCSRF.Header = valid.Header.Clone()
	wrongCSRF.Header.Set(csrfHeader, "wrong")
	if err := adapter.ValidateCSRF(wrongCSRF, sessionContext, websecurity.CSRFPolicyRequired); !errors.Is(err, websecurity.ErrCSRFInvalid) {
		t.Fatalf("wrong CSRF error = %v, want ErrCSRFInvalid", err)
	}
	schemeMismatch := valid.Clone(valid.Context())
	schemeMismatch.Header = valid.Header.Clone()
	schemeMismatch.Header.Set("Origin", "http://env.example.test")
	if err := adapter.ValidateOrigin(schemeMismatch, sessionContext, websecurity.OriginPolicyTrustedHost); !errors.Is(err, websecurity.ErrOriginDenied) {
		t.Fatalf("scheme mismatch error = %v, want ErrOriginDenied", err)
	}
}

func TestWebSecurityGuardAcceptsSameOriginReleaseInstallOperationReadsWithoutOrigin(t *testing.T) {
	adapter, err := newSessionAdapter(func(channelID string) (*session.Meta, bool) {
		if channelID != "ch_123" {
			return nil, false
		}
		return &session.Meta{
			ChannelID:    channelID,
			EndpointID:   "env_123",
			UserPublicID: "user_123",
			CanRead:      true,
		}, true
	}, testPermissionPolicy(t, "read_only"))
	if err != nil {
		t.Fatal(err)
	}

	paths := []string{
		"/_redevplugin/api/plugins/release-install-operations",
		"/_redevplugin/api/plugins/release-install-operations/release_install_123",
		"/_redevplugin/api/plugins/release-install-operations/by-request/request_123",
	}
	for _, requestPath := range paths {
		t.Run(requestPath, func(t *testing.T) {
			req := authenticatedRequest(http.MethodGet, requestPath, "ch_123")
			req.Host = "env.example.test"
			req.Header.Set("Sec-Fetch-Site", "same-origin")
			req.Header.Set("Sec-Fetch-Mode", "cors")
			req.Header.Set("Sec-Fetch-Dest", "empty")
			req, err = WithTrustedOrigin(req, "https://env.example.test")
			if err != nil {
				t.Fatal(err)
			}
			sessionContext, err := adapter.Authenticate(req)
			if err != nil {
				t.Fatalf("Authenticate() error = %v", err)
			}
			if err := adapter.ValidateOrigin(req, sessionContext, websecurity.OriginPolicyTrustedHost); err != nil {
				t.Fatalf("ValidateOrigin() error = %v", err)
			}
		})
	}

	base := authenticatedRequest(http.MethodGet, paths[0], "ch_123")
	base.Host = "env.example.test"
	base.Header.Set("Sec-Fetch-Site", "same-origin")
	base.Header.Set("Sec-Fetch-Mode", "cors")
	base.Header.Set("Sec-Fetch-Dest", "empty")
	base, err = WithTrustedOrigin(base, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	sessionContext, err := adapter.Authenticate(base)
	if err != nil {
		t.Fatal(err)
	}
	for _, testCase := range []struct {
		name      string
		configure func(*http.Request)
	}{
		{name: "cross_site", configure: func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }},
		{name: "navigate", configure: func(r *http.Request) { r.Header.Set("Sec-Fetch-Mode", "navigate") }},
		{name: "document", configure: func(r *http.Request) { r.Header.Set("Sec-Fetch-Dest", "document") }},
		{name: "missing_metadata", configure: func(r *http.Request) { r.Header.Del("Sec-Fetch-Site") }},
		{name: "duplicate_metadata", configure: func(r *http.Request) { r.Header.Add("Sec-Fetch-Site", "same-origin") }},
		{name: "unsafe_method", configure: func(r *http.Request) { r.Method = http.MethodPost }},
	} {
		t.Run("reject_"+testCase.name, func(t *testing.T) {
			req := base.Clone(base.Context())
			req.Header = base.Header.Clone()
			testCase.configure(req)
			if err := adapter.ValidateOrigin(req, sessionContext, websecurity.OriginPolicyTrustedHost); !errors.Is(err, websecurity.ErrOriginDenied) {
				t.Fatalf("ValidateOrigin() error = %v, want ErrOriginDenied", err)
			}
		})
	}
}

func TestWebSecurityGuardRejectsUntrustedRouteRole(t *testing.T) {
	adapter, err := newSessionAdapter(func(string) (*session.Meta, bool) { return nil, false }, testPermissionPolicy(t, "read_only"))
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/_redevplugin/api/plugins/catalog", nil)
	req.Header.Set(sessionhop.HeaderChannelID, "ch_123")
	if _, err := adapter.Authenticate(req); !errors.Is(err, sessionctx.ErrSessionRequired) {
		t.Fatalf("Authenticate() error = %v, want ErrSessionRequired", err)
	}
}

func TestPackageTrustVerifierUsesV5Provenance(t *testing.T) {
	verifier, err := newPackageTrustVerifier()
	if err != nil {
		t.Fatal(err)
	}
	unsignedLocal, err := verifier.VerifyPackageTrust(context.Background(), host.PackageTrustVerificationRequest{LocalImport: true})
	if err != nil {
		t.Fatalf("unsigned local trust error = %v", err)
	}
	if unsignedLocal.TrustState != registry.TrustUnsignedLocal {
		t.Fatalf("unsigned local trust = %s, want %s", unsignedLocal.TrustState, registry.TrustUnsignedLocal)
	}

	unclassified, err := verifier.VerifyPackageTrust(context.Background(), host.PackageTrustVerificationRequest{})
	if err != nil {
		t.Fatalf("unclassified package trust error = %v", err)
	}
	if unclassified.TrustState != registry.TrustUntrusted {
		t.Fatalf("unclassified trust = %s, want %s", unclassified.TrustState, registry.TrustUntrusted)
	}

	incompleteRelease, err := verifier.VerifyPackageTrust(context.Background(), host.PackageTrustVerificationRequest{Action: host.PackageTrustActionInstall})
	if err != nil {
		t.Fatalf("incomplete release trust error = %v", err)
	}
	if incompleteRelease.TrustState != registry.TrustUntrusted {
		t.Fatalf("incomplete release trust = %s, want %s", incompleteRelease.TrustState, registry.TrustUntrusted)
	}

	assessment, err := verifier.AssessExternalPackageSignature(context.Background(), host.ExternalPackageSignatureAssessmentRequest{
		Package: pluginpkg.Package{},
	})
	if err != nil {
		t.Fatalf("unsigned external package assessment error = %v", err)
	}
	if assessment.Status != registry.SignatureAbsent {
		t.Fatalf("unsigned external package assessment = %s, want %s", assessment.Status, registry.SignatureAbsent)
	}
}

func TestNewCreatesDurableReDevPluginState(t *testing.T) {
	stateDir := t.TempDir()
	integration, err := New(context.Background(), ownerScopeTestOptions(t, stateDir))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{
		"control.sqlite",
		"observability.sqlite",
		"secrets.sqlite",
		"external-inspections",
		"plugin-data",
		"assets",
	} {
		if _, err := os.Stat(filepath.Join(stateDir, rel)); err != nil {
			t.Fatalf("expected durable state %s: %v", rel, err)
		}
	}
	for _, rel := range []string{
		"db/registry.sqlite", "db/operations.sqlite", "db/streams.sqlite",
		"db/install_stage.sqlite", "db/confirmation_intents.sqlite", "db/session_scopes.sqlite",
		"external-package-stage", "storage", "closed_sessions.json",
	} {
		if _, err := os.Stat(filepath.Join(stateDir, rel)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("obsolete state owner %s exists: %v", rel, err)
		}
	}
}

func TestNewKeepsOfficialReleasePlatformModuleAvailableWhileMarketIsOffline(t *testing.T) {
	market, err := pluginmarket.NewService(pluginmarket.ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "market-lkg.json"),
		HTTPClient: &http.Client{Transport: blockingMarketTransport(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("market offline")
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	const channelID = "channel_release_features"
	options := ownerScopeTestOptions(t, t.TempDir())
	options.PluginMarket = market
	options.ResolveSessionMeta = func(got string) (*session.Meta, bool) {
		return &session.Meta{
			ChannelID: channelID, EndpointID: "env_release_features", UserPublicID: "user_release_features",
			FloeApp: "com.floegence.redeven.agent", CanRead: true,
		}, got == channelID
	}
	integration, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := integration.Close(); err != nil {
			t.Errorf("close integration: %v", err)
		}
	})

	request := httptest.NewRequest(http.MethodPost, "/_redevplugin/api/plugins/features/query", strings.NewReader(`{}`))
	request.Header.Set(sessionhop.HeaderChannelID, channelID)
	request = WithRouteRole(request, RouteRoleEnvTrusted)
	request.Host = "env.example.test"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://env.example.test")
	request.Header.Set(csrfHeader, csrfProof)
	request, err = WithTrustedOrigin(request, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	integration.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("features status = %d body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		OK   bool     `json:"ok"`
		Data []string `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK {
		t.Fatalf("features response = %s", response.Body.String())
	}
	for _, feature := range payload.Data {
		if feature == string(host.FeatureRelease) {
			return
		}
	}
	t.Fatalf("official release platform module is missing: %v", payload.Data)
}

func ownerScopeTestOptions(t *testing.T, stateDir string) Options {
	t.Helper()
	return Options{
		StateDir:           stateDir,
		PermissionPolicy:   testPermissionPolicy(t, "execute_read"),
		RuntimePath:        testRuntimePath(t, stateDir),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	}
}

func TestNewRejectsNonCanonicalRuntimePath(t *testing.T) {
	stateDir := t.TempDir()
	_, err := New(context.Background(), Options{
		StateDir:           stateDir,
		PermissionPolicy:   testPermissionPolicy(t, "execute_read"),
		RuntimePath:        "redevplugin-runtime",
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err == nil || !strings.Contains(err.Error(), "absolute canonical path") {
		t.Fatalf("New() runtime path error = %v", err)
	}
}

type blockingMarketTransport func(*http.Request) (*http.Response, error)

func (transport blockingMarketTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

type controlledMarketService struct {
	calls    chan struct{}
	release  chan struct{}
	snapshot pluginmarket.Snapshot
	err      error
}

func (service *controlledMarketService) Refresh(ctx context.Context) (pluginmarket.Snapshot, error) {
	service.calls <- struct{}{}
	if service.release != nil {
		select {
		case <-ctx.Done():
			return pluginmarket.Snapshot{}, ctx.Err()
		case <-service.release:
		}
	}
	return service.snapshot.Clone(), service.err
}

func (*controlledMarketService) Detail(context.Context, string) (pluginmarket.PluginDetail, int64, error) {
	return pluginmarket.PluginDetail{}, -1, pluginmarket.ErrUnavailable
}

func (*controlledMarketService) Icon(context.Context, string, pluginmarket.PresentationIcon) (pluginmarket.IconAsset, error) {
	return pluginmarket.IconAsset{}, pluginmarket.ErrUnavailable
}

type scriptedMarketService struct {
	calls     chan time.Time
	responses chan marketRefreshResult
}

func (service *scriptedMarketService) Refresh(ctx context.Context) (pluginmarket.Snapshot, error) {
	select {
	case service.calls <- time.Now():
	case <-ctx.Done():
		return pluginmarket.Snapshot{}, ctx.Err()
	}
	select {
	case result := <-service.responses:
		return result.snapshot.Clone(), result.err
	case <-ctx.Done():
		return pluginmarket.Snapshot{}, ctx.Err()
	}
}

func (*scriptedMarketService) Detail(context.Context, string) (pluginmarket.PluginDetail, int64, error) {
	return pluginmarket.PluginDetail{}, -1, pluginmarket.ErrUnavailable
}

func (*scriptedMarketService) Icon(context.Context, string, pluginmarket.PresentationIcon) (pluginmarket.IconAsset, error) {
	return pluginmarket.IconAsset{}, pluginmarket.ErrUnavailable
}

func TestNewDoesNotWaitForRemotePluginMarket(t *testing.T) {
	requestStarted := make(chan struct{}, 1)
	market, err := pluginmarket.NewService(pluginmarket.ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "market-lkg.json"),
		HTTPClient: &http.Client{Transport: blockingMarketTransport(func(request *http.Request) (*http.Response, error) {
			select {
			case requestStarted <- struct{}{}:
			default:
			}
			<-request.Context().Done()
			return nil, request.Context().Err()
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	options := ownerScopeTestOptions(t, t.TempDir())
	options.PluginMarket = market
	type result struct {
		integration *Integration
		err         error
	}
	completed := make(chan result, 1)
	go func() {
		integration, newErr := New(context.Background(), options)
		completed <- result{integration: integration, err: newErr}
	}()
	var created result
	select {
	case created = <-completed:
	case <-time.After(2 * time.Second):
		t.Fatal("New() blocked on the remote plugin market")
	}
	if created.err != nil {
		t.Fatal(created.err)
	}
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("background plugin market refresh did not start")
	}
	if err := created.integration.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestMarketSnapshotReturnsCachedStateWithoutWaitingForRefresh(t *testing.T) {
	release := make(chan struct{})
	service := &controlledMarketService{
		calls:   make(chan struct{}, 1),
		release: release,
		snapshot: pluginmarket.Snapshot{
			SchemaVersion: pluginmarket.SnapshotSchemaVersion,
			Generation:    8,
			CachedAt:      time.Now().UTC(),
			Source:        pluginmarket.SnapshotSourceRemote,
		},
	}
	cached := pluginmarket.Snapshot{
		SchemaVersion: pluginmarket.SnapshotSchemaVersion,
		Generation:    7,
		CachedAt:      time.Now().UTC().Add(-time.Hour),
		Stale:         true,
		Source:        pluginmarket.SnapshotSourceCache,
	}
	integration := &Integration{marketService: service, marketSnapshot: &cached}
	integration.startMarketRefreshController(marketRefreshPolicy{successDelay: func() time.Duration { return time.Hour }})
	defer func() { _ = integration.Close() }()
	select {
	case <-service.calls:
	case <-time.After(time.Second):
		t.Fatal("background plugin market refresh did not start")
	}
	snapshot, err := integration.MarketSnapshot(context.Background())
	if err != nil || snapshot.Generation != 7 || !snapshot.Stale {
		t.Fatalf("MarketSnapshot() = %#v, %v", snapshot, err)
	}
	close(release)
}

func TestRefreshMarketJoinsCurrentControllerRefresh(t *testing.T) {
	release := make(chan struct{})
	service := &controlledMarketService{
		calls:   make(chan struct{}, 4),
		release: release,
		snapshot: pluginmarket.Snapshot{
			SchemaVersion: pluginmarket.SnapshotSchemaVersion,
			Generation:    8,
			CachedAt:      time.Now().UTC(),
			Source:        pluginmarket.SnapshotSourceRemote,
		},
	}
	integration := &Integration{marketService: service}
	integration.startMarketRefreshController(marketRefreshPolicy{successDelay: func() time.Duration { return time.Hour }})
	defer func() { _ = integration.Close() }()
	select {
	case <-service.calls:
	case <-time.After(time.Second):
		t.Fatal("background plugin market refresh did not start")
	}
	type result struct {
		snapshot pluginmarket.Snapshot
		err      error
	}
	results := make(chan result, 2)
	for range 2 {
		go func() {
			snapshot, err := integration.RefreshMarket(context.Background())
			results <- result{snapshot: snapshot, err: err}
		}()
	}
	time.Sleep(20 * time.Millisecond)
	if len(service.calls) != 0 {
		t.Fatal("concurrent refresh readers started a duplicate market request")
	}
	close(release)
	for range 2 {
		result := <-results
		if result.err != nil || result.snapshot.Generation != 8 || result.snapshot.Stale {
			t.Fatalf("RefreshMarket() = %#v, %v", result.snapshot, result.err)
		}
	}
}

func TestRefreshMarketHonorsCallerCancellation(t *testing.T) {
	service := &controlledMarketService{
		calls:   make(chan struct{}, 1),
		release: make(chan struct{}),
	}
	integration := &Integration{marketService: service}
	integration.startMarketRefreshController(marketRefreshPolicy{successDelay: func() time.Duration { return time.Hour }})
	defer func() { _ = integration.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := integration.RefreshMarket(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("RefreshMarket() error = %v, want context cancellation", err)
	}
}

func TestMarketSnapshotFailsWithoutAcceptedSnapshot(t *testing.T) {
	service := &controlledMarketService{
		calls: make(chan struct{}, 1),
		err:   pluginmarket.ErrUnavailable,
	}
	integration := &Integration{marketService: service}
	integration.startMarketRefreshController(marketRefreshPolicy{successDelay: func() time.Duration { return time.Hour }})
	defer func() { _ = integration.Close() }()
	if _, err := integration.MarketSnapshot(context.Background()); !errors.Is(err, pluginmarket.ErrUnavailable) {
		t.Fatalf("MarketSnapshot() error = %v, want unavailable", err)
	}
}

func TestMarketRefreshControllerRetriesAndResetsAfterSuccess(t *testing.T) {
	service := &scriptedMarketService{
		calls:     make(chan time.Time, 8),
		responses: make(chan marketRefreshResult, 8),
	}
	remote := pluginmarket.Snapshot{
		SchemaVersion: pluginmarket.SnapshotSchemaVersion,
		Generation:    9,
		CachedAt:      time.Now().UTC(),
		Source:        pluginmarket.SnapshotSourceRemote,
	}
	service.responses <- marketRefreshResult{err: errors.New("first failure")}
	service.responses <- marketRefreshResult{err: errors.New("second failure")}
	service.responses <- marketRefreshResult{snapshot: remote}
	service.responses <- marketRefreshResult{err: errors.New("failure after success")}
	service.responses <- marketRefreshResult{snapshot: remote}
	integration := &Integration{marketService: service}
	integration.startMarketRefreshController(marketRefreshPolicy{
		timeout:      time.Second,
		retryDelays:  []time.Duration{10 * time.Millisecond, 40 * time.Millisecond},
		successDelay: func() time.Duration { return 10 * time.Millisecond },
	})
	defer func() { _ = integration.Close() }()

	callTimes := make([]time.Time, 0, 5)
	for len(callTimes) < 5 {
		select {
		case calledAt := <-service.calls:
			callTimes = append(callTimes, calledAt)
		case <-time.After(time.Second):
			t.Fatalf("refresh calls = %d, want 5", len(callTimes))
		}
	}
	if secondDelay := callTimes[1].Sub(callTimes[0]); secondDelay < 7*time.Millisecond {
		t.Fatalf("first retry delay = %s, want about 10ms", secondDelay)
	}
	if thirdDelay := callTimes[2].Sub(callTimes[1]); thirdDelay < 30*time.Millisecond {
		t.Fatalf("second retry delay = %s, want about 40ms", thirdDelay)
	}
	if resetDelay := callTimes[4].Sub(callTimes[3]); resetDelay >= 30*time.Millisecond {
		t.Fatalf("retry delay after success = %s, want reset to about 10ms", resetDelay)
	}
}

func TestDefaultMarketRefreshPolicyUsesDocumentedCadence(t *testing.T) {
	policy := defaultMarketRefreshPolicy()
	wantRetries := []time.Duration{15 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 5 * time.Minute}
	if len(policy.retryDelays) != len(wantRetries) {
		t.Fatalf("retry delays = %v", policy.retryDelays)
	}
	for index, want := range wantRetries {
		if policy.retryDelays[index] != want {
			t.Fatalf("retry delay %d = %s, want %s", index, policy.retryDelays[index], want)
		}
	}
	for range 100 {
		delay := policy.successDelay()
		if delay < 9*time.Minute || delay > 11*time.Minute {
			t.Fatalf("success delay = %s, want 10m ±1m", delay)
		}
	}
}

func TestMarketRefreshControllerRejectsOlderGeneration(t *testing.T) {
	current := pluginmarket.Snapshot{
		SchemaVersion: pluginmarket.SnapshotSchemaVersion,
		Generation:    9,
		CachedAt:      time.Now().UTC(),
		Source:        pluginmarket.SnapshotSourceRemote,
	}
	service := &controlledMarketService{
		calls: make(chan struct{}, 1),
		snapshot: pluginmarket.Snapshot{
			SchemaVersion: pluginmarket.SnapshotSchemaVersion,
			Generation:    8,
			CachedAt:      time.Now().UTC(),
			Source:        pluginmarket.SnapshotSourceRemote,
		},
	}
	integration := &Integration{marketService: service, marketSnapshot: &current}
	integration.startMarketRefreshController(marketRefreshPolicy{
		retryDelays:  []time.Duration{time.Hour},
		successDelay: func() time.Duration { return time.Hour },
	})
	defer func() { _ = integration.Close() }()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	baseline, events, err := integration.SubscribeMarketRefresh(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range baseline {
		if event.State == pluginmarket.RefreshStateFailed {
			goto failed
		}
	}
	for {
		select {
		case event := <-events:
			if event.State == pluginmarket.RefreshStateFailed {
				goto failed
			}
		case <-time.After(time.Second):
			t.Fatal("missing refresh_failed event")
		}
	}

failed:
	snapshot, err := integration.MarketSnapshot(context.Background())
	if err != nil || snapshot.Generation != current.Generation {
		t.Fatalf("MarketSnapshot() = %#v, %v", snapshot, err)
	}
}

func TestSubscribeMarketRefreshReplaysLatestAndReleasesOnCancel(t *testing.T) {
	service := &controlledMarketService{calls: make(chan struct{}, 1), release: make(chan struct{})}
	integration := &Integration{marketService: service}
	integration.startMarketRefreshController(marketRefreshPolicy{successDelay: func() time.Duration { return time.Hour }})
	defer func() { _ = integration.Close() }()
	select {
	case <-service.calls:
	case <-time.After(time.Second):
		t.Fatal("background refresh did not start")
	}

	ctx, cancel := context.WithCancel(context.Background())
	baseline, events, err := integration.SubscribeMarketRefresh(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(baseline) != 1 || baseline[0].State != pluginmarket.RefreshStateRefreshing || baseline[0].Seq <= 0 {
		t.Fatalf("baseline = %#v", baseline)
	}
	cancel()
	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("subscription remained open after cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("subscription was not released after cancellation")
	}
}

func TestMarketRefreshControllerCloseReleasesSubscriber(t *testing.T) {
	service := &controlledMarketService{calls: make(chan struct{}, 1), release: make(chan struct{})}
	integration := &Integration{marketService: service}
	integration.startMarketRefreshController(marketRefreshPolicy{successDelay: func() time.Duration { return time.Hour }})
	select {
	case <-service.calls:
	case <-time.After(time.Second):
		t.Fatal("background refresh did not start")
	}
	_, events, err := integration.SubscribeMarketRefresh(context.Background(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case _, ok := <-events:
		if ok {
			// The latest refreshing state may already be buffered; the next read
			// must observe controller shutdown.
			select {
			case _, stillOpen := <-events:
				if stillOpen {
					t.Fatal("subscription remained open after Integration.Close")
				}
			case <-time.After(time.Second):
				t.Fatal("subscription was not closed with the controller")
			}
		}
	case <-time.After(time.Second):
		t.Fatal("subscription was not closed with the controller")
	}
	if _, _, err := integration.SubscribeMarketRefresh(context.Background(), 0); !errors.Is(err, pluginmarket.ErrUnavailable) {
		t.Fatalf("SubscribeMarketRefresh() after close error = %v", err)
	}
}

func TestMarketIconUsesVerifiedSnapshotWithoutRefreshingCatalog(t *testing.T) {
	data := []byte("verified market icon")
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	var requestedPaths []string
	market, err := pluginmarket.NewService(pluginmarket.ServiceOptions{
		Origin:    "https://plugins.redeven.com",
		CachePath: filepath.Join(t.TempDir(), "market-lkg.json"),
		HTTPClient: &http.Client{Transport: blockingMarketTransport(func(request *http.Request) (*http.Response, error) {
			requestedPaths = append(requestedPaths, request.URL.Path)
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(string(data))),
				Header:     http.Header{"Content-Type": {"image/png"}},
			}, nil
		})},
	})
	if err != nil {
		t.Fatal(err)
	}
	icon := &pluginmarket.PresentationIcon{
		URL:       "/v1/plugins/com.example.metrics/icon?sha256=" + digest,
		MediaType: "image/png",
		Width:     512,
		Height:    512,
		SHA256:    digest,
	}
	snapshot := pluginmarket.Snapshot{Plugins: []pluginmarket.CatalogPlugin{{
		PluginID: "com.example.metrics",
		Presentation: pluginmarket.PresentationCompact{
			Icon: icon,
		},
	}}}
	integration := &Integration{marketSnapshot: &snapshot, marketService: market}

	asset, err := integration.MarketIcon(context.Background(), "com.example.metrics", digest)
	if err != nil {
		t.Fatal(err)
	}
	if string(asset.Data) != string(data) || asset.SHA256 != digest || asset.MediaType != "image/png" {
		t.Fatalf("MarketIcon() = %#v", asset)
	}
	if len(requestedPaths) != 1 || requestedPaths[0] != "/v1/plugins/com.example.metrics/icon" {
		t.Fatalf("MarketIcon() requests = %v, want icon only", requestedPaths)
	}
}

func TestNewRejectsMissingPermissionPolicy(t *testing.T) {
	_, err := New(context.Background(), Options{
		StateDir:           t.TempDir(),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err == nil {
		t.Fatal("New() unexpectedly accepted a missing permission policy")
	}
}

func TestObservabilityProjectionRequiresDurablePrimaryWrite(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	primary, err := observability.NewSQLiteStore(ctx, filepath.Join(stateDir, "observability.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	audit, err := auditlog.New(auditlog.Options{StateDir: stateDir})
	if err != nil {
		t.Fatal(err)
	}
	adapter := newObservabilityAdapter(primary, audit, nil)
	if err := primary.Close(); err != nil {
		t.Fatal(err)
	}
	if err := adapter.AppendPluginAudit(ctx, observability.AuditEvent{Type: "plugin.test"}); err == nil {
		t.Fatal("AppendPluginAudit() unexpectedly succeeded after primary close")
	}
	entries, err := audit.List(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("product audit received an event without a durable primary write: %+v", entries)
	}
}

func TestObservabilityProjectionExcludesRawDiagnosticText(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	primary, err := observability.NewSQLiteStore(ctx, filepath.Join(stateDir, "observability.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = primary.Close() })
	diagnosticStore, err := diagnostics.New(diagnostics.Options{StateDir: stateDir, Source: "test"})
	if err != nil {
		t.Fatal(err)
	}
	adapter := newObservabilityAdapter(primary, nil, diagnosticStore)
	raw := "bearer secret-token https://example.test/path?token=secret /Users/alice/private.key"
	err = adapter.AppendPluginDiagnostic(ctx, observability.DiagnosticEvent{
		Type:     "plugin.execution.failed",
		Severity: observability.DiagnosticSeverityWarning,
		Message:  "execution failed",
		Failure: observability.FailureFromError(
			observability.FailureAdapter,
			observability.FailureComponentExecution,
			observability.FailureOperationExecutionFail,
			errors.New(raw),
		),
	})
	if err != nil {
		t.Fatal(err)
	}
	events, err := diagnosticStore.List(10)
	if err != nil || len(events) != 1 {
		t.Fatalf("product diagnostics = %+v, err=%v", events, err)
	}
	encoded, err := json.Marshal(events[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), raw) || strings.Contains(string(encoded), "secret-token") || strings.Contains(string(encoded), "/Users/alice") {
		t.Fatalf("raw diagnostic text crossed product sink boundary: %s", encoded)
	}
}

func testPermissionPolicy(t *testing.T, preset string) *config.PermissionPolicy {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset(preset)
	if err != nil {
		t.Fatalf("parse permission policy: %v", err)
	}
	return policy
}

func authenticatedRequest(method, path, channelID string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set(sessionhop.HeaderChannelID, channelID)
	return WithRouteRole(req, RouteRoleEnvTrusted)
}

func TestNewKeepsRemoteReleaseAvailableWithUnusableDocumentCache(t *testing.T) {
	options := ownerScopeTestOptions(t, t.TempDir())
	cachePath := filepath.Join(options.StateDir, "release-documents.sqlite")
	original := []byte("unknown cache format")
	if err := os.WriteFile(cachePath, original, 0600); err != nil {
		t.Fatal(err)
	}
	market, err := pluginmarket.NewService(pluginmarket.ServiceOptions{
		Origin: "https://plugins.redeven.com", CachePath: filepath.Join(t.TempDir(), "market.json"),
		HTTPClient: &http.Client{Transport: blockingMarketTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("market offline") })},
	})
	if err != nil {
		t.Fatal(err)
	}
	options.PluginMarket = market
	integration, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	if integration.releaseProvider == nil || integration.releaseProvider.documentCache != nil {
		t.Fatal("remote release fallback unavailable")
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	value, err := os.ReadFile(cachePath)
	if err != nil || string(value) != string(original) {
		t.Fatalf("unknown cache was changed: %q %v", value, err)
	}
}
