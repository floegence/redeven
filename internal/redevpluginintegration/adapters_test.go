package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/pkg/externalsource"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/manifest"
	"github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/ownerscope"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/sessionctx"
	"github.com/floegence/redevplugin/pkg/websecurity"
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
				host.ManagementActionCancelOperation,
				host.ManagementActionCancelSurfaceOperation,
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

func TestSharedRuntimeManagementRequiresAdmin(t *testing.T) {
	for _, action := range []host.ManagementAction{
		host.ManagementActionStartRuntime,
		host.ManagementActionStopRuntime,
		host.ManagementActionRefreshEnabledPlugins,
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
		host.ManagementActionCommitExternalPackage,
	} {
		if permissionsAllowAction(sessionPermissions{read: true}, action) {
			t.Fatalf("%s accepted read-only external package mutation", action)
		}
		if !permissionsAllowAction(sessionPermissions{admin: true}, action) {
			t.Fatalf("%s denied admin external package mutation", action)
		}
	}
	for _, action := range []host.ManagementAction{
		host.ManagementActionQueryExternalPackageCommit,
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
	root := filepath.Join(stateDir, "apps", "redevplugin")
	generation, err := ownerscope.PrepareOwnerScopeGeneration(context.Background(), root)
	if err != nil {
		t.Fatalf("PrepareOwnerScopeGeneration() error = %v", err)
	}
	if generation.Status.State != ownerscope.StateFreshCommitted || generation.Status.FreshGenerationID == "" || !generation.Status.QuarantineID.IsZero() {
		t.Fatalf("fresh generation status = %#v", generation.Status)
	}
	for _, rel := range []string{
		"db/registry.sqlite",
		"db/operations.sqlite",
		"db/observability.sqlite",
		"db/session_scopes.sqlite",
		"trust/release-trust.sqlite",
		"trust/trusted-time/ed25519-private.key",
		"external-package-stage",
		"assets",
		"storage",
	} {
		if _, err := os.Stat(filepath.Join(generation.Path, rel)); err != nil {
			t.Fatalf("expected durable state %s: %v", rel, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "db")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("fresh install created legacy root state: %v", err)
	}
}

func TestNewClosesExternalStageWhenReleaseModuleFails(t *testing.T) {
	stateDir := t.TempDir()
	wantErr := errors.New("release module failed")
	closeCalls := 0
	var closedStage *externalsource.StageStore
	opts := ownerScopeTestOptions(t, stateDir)
	opts.newReleaseModule = func(string) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error) {
		return nil, host.PluginReleaseRef{}, nil, wantErr
	}
	opts.closeExternalStage = func(stage *externalsource.StageStore) error {
		closeCalls++
		closedStage = stage
		return stage.Close()
	}

	integration, err := New(context.Background(), opts)
	if integration != nil || !errors.Is(err, wantErr) {
		t.Fatalf("New() = %#v, %v, want nil, %v", integration, err, wantErr)
	}
	if closeCalls != 1 {
		t.Fatalf("external stage close calls = %d, want 1", closeCalls)
	}
	if closedStage == nil {
		t.Fatal("external stage closer did not receive the opened store")
	}
	if _, err := closedStage.StageUpload(context.Background(), "owner_test", strings.NewReader("x"), 1); err == nil {
		t.Fatal("external stage accepted an upload after release module failure")
	}
}

func TestNewAutomaticallyMigratesV065OwnerScopeState(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	root := filepath.Join(stateDir, "apps", "redevplugin")
	if err := os.MkdirAll(filepath.Join(root, "db"), 0o700); err != nil {
		t.Fatal(err)
	}
	legacyDatabaseMarker := filepath.Join("db", "closed_sessions.json")
	if err := os.WriteFile(filepath.Join(root, legacyDatabaseMarker), []byte(`{"sessions":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	legacyMarker := filepath.Join("storage", "legacy-owner-unknown")
	if err := os.MkdirAll(filepath.Join(root, "storage"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, legacyMarker), []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}

	integration, err := New(ctx, ownerScopeTestOptions(t, stateDir))
	if err != nil {
		t.Fatalf("New() migration error = %v", err)
	}
	if err := integration.Close(); err != nil {
		t.Fatal(err)
	}
	generation, err := ownerscope.PrepareOwnerScopeGeneration(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if generation.Status.State != ownerscope.StateFreshCommitted || generation.Status.QuarantineID.IsZero() {
		t.Fatalf("migrated generation status = %#v", generation.Status)
	}
	quarantineRoot := filepath.Join(root, ".redevplugin-quarantine", generation.Status.QuarantineID.String())
	if raw, err := os.ReadFile(filepath.Join(quarantineRoot, legacyMarker)); err != nil || string(raw) != "legacy" {
		t.Fatalf("quarantined legacy marker = %q, %v", raw, err)
	}
	if _, err := os.Stat(filepath.Join(quarantineRoot, legacyDatabaseMarker)); err != nil {
		t.Fatalf("quarantined legacy database marker: %v", err)
	}
	if _, err := os.Stat(filepath.Join(generation.Path, "db", "registry.sqlite")); err != nil {
		t.Fatalf("active generation registry: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "db")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy db remained active: %v", err)
	}

	activeMarker := filepath.Join(generation.Path, "storage", "created-after-migration")
	if err := os.WriteFile(activeMarker, []byte("active"), 0o600); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(ctx, ownerScopeTestOptions(t, stateDir))
	if err != nil {
		t.Fatalf("New() restart error = %v", err)
	}
	if err := restarted.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := ownerscope.PrepareOwnerScopeGeneration(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Path != generation.Path || reopened.Status.FreshGenerationID != generation.Status.FreshGenerationID || reopened.Status.QuarantineID != generation.Status.QuarantineID {
		t.Fatalf("reopened generation = %#v, want %#v", reopened, generation)
	}
	if raw, err := os.ReadFile(activeMarker); err != nil || string(raw) != "active" {
		t.Fatalf("active generation data after restart = %q, %v", raw, err)
	}
	if raw, err := os.ReadFile(filepath.Join(quarantineRoot, legacyMarker)); err != nil || string(raw) != "legacy" {
		t.Fatalf("quarantine after restart = %q, %v", raw, err)
	}
}

func TestNewRejectsUnknownOrCorruptOwnerScopeStateWithoutMutation(t *testing.T) {
	for _, test := range []struct {
		name    string
		relPath string
		content string
		wantErr error
	}{
		{name: "unknown layout", relPath: "db/unknown.sqlite", content: "unknown", wantErr: ownerscope.ErrOwnerScopeMigrationRequired},
		{name: "corrupt journal", relPath: ownerscope.MigrationJournalName, content: "{", wantErr: ownerscope.ErrOwnerScopeJournalCorrupt},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			root := filepath.Join(stateDir, "apps", "redevplugin")
			path := filepath.Join(root, filepath.FromSlash(test.relPath))
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(test.content), 0o600); err != nil {
				t.Fatal(err)
			}
			if integration, err := New(context.Background(), ownerScopeTestOptions(t, stateDir)); integration != nil || !errors.Is(err, test.wantErr) {
				t.Fatalf("New() = %#v, %v, want %v", integration, err, test.wantErr)
			}
			if raw, err := os.ReadFile(path); err != nil || string(raw) != test.content {
				t.Fatalf("rejected owner-scope state changed = %q, %v", raw, err)
			}
			if test.relPath != ownerscope.MigrationJournalName {
				if _, err := os.Stat(filepath.Join(root, ownerscope.MigrationJournalName)); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("rejected state wrote a migration journal: %v", err)
				}
			}
		})
	}
}

func ownerScopeTestOptions(t *testing.T, stateDir string) Options {
	t.Helper()
	return Options{
		StateDir:           stateDir,
		PermissionPolicy:   testPermissionPolicy(t, "execute_read"),
		RuntimePath:        testRuntimePath(t, stateDir),
		Containers:         mustContainersAdapter(t, &capabilityEngineClient{}),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	}
}

func TestNewRejectsNonCanonicalRuntimePath(t *testing.T) {
	stateDir := t.TempDir()
	_, err := New(context.Background(), Options{
		StateDir:           stateDir,
		PermissionPolicy:   testPermissionPolicy(t, "execute_read"),
		RuntimePath:        "redevplugin-runtime",
		Containers:         mustContainersAdapter(t, &capabilityEngineClient{}),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err == nil || !strings.Contains(err.Error(), "absolute canonical path") {
		t.Fatalf("New() runtime path error = %v", err)
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

func TestNewRejectsMissingContainerAdapterBeforeCreatingState(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "not-created")
	_, err := New(context.Background(), Options{
		StateDir:           stateDir,
		PermissionPolicy:   testPermissionPolicy(t, "execute_read"),
		ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false },
	})
	if err == nil || !strings.Contains(err.Error(), "container engine client is required") {
		t.Fatalf("New() container adapter error = %v", err)
	}
	if _, statErr := os.Stat(stateDir); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("invalid adapter created persistent state: %v", statErr)
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
