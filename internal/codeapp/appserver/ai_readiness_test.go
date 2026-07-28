package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

type controlledAIServiceProvider struct {
	mu             sync.Mutex
	service        *ai.Service
	snapshot       AIReadinessSnapshot
	acquires       int
	releases       int
	retries        int
	retryErr       error
	updates        []AIServiceStartupOptions
	scopeRevisions []uint64
	orphanReview   ai.OrphanCanonicalRootReview
	adoptCount     int
	deleteCount    int
}

type invalidAIServiceProvider struct {
	releases int
}

func (p *invalidAIServiceProvider) AcquireAIService(context.Context) (*ai.Service, context.Context, uint64, func(), error) {
	return new(ai.Service), nil, 1, func() { p.releases++ }, nil
}

func (*invalidAIServiceProvider) AIReadiness() AIReadinessSnapshot {
	return AIReadinessSnapshot{State: AIReadinessReady}
}

func (*invalidAIServiceProvider) RetryAIReadiness() error { return nil }

func (*invalidAIServiceProvider) UpdateAIServiceStartupOptions(AIServiceStartupOptions) {}

func (p *controlledAIServiceProvider) AcquireAIService(ctx context.Context) (*ai.Service, context.Context, uint64, func(), error) {
	p.mu.Lock()
	p.acquires++
	service := p.service
	snapshot := p.snapshot
	p.mu.Unlock()
	if service == nil || (snapshot.State != AIReadinessReady && snapshot.State != AIReadinessDegraded) {
		return nil, nil, 0, nil, ErrAIServiceUnavailable
	}
	var once sync.Once
	return service, ctx, 7, func() {
		once.Do(func() {
			p.mu.Lock()
			p.releases++
			p.mu.Unlock()
		})
	}, nil
}

func (p *controlledAIServiceProvider) ReviewOrphanCanonicalRoots(context.Context) (ai.OrphanCanonicalRootReview, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.orphanReview, nil
}

func (p *controlledAIServiceProvider) AdoptOrphanCanonicalRoot(context.Context, ai.AdoptOrphanCanonicalRootRequest) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.adoptCount++
	return 0, nil
}

func (p *controlledAIServiceProvider) DeleteOrphanCanonicalRoot(context.Context, ai.DeleteOrphanCanonicalRootRequest) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.deleteCount++
	return 0, nil
}

func (p *controlledAIServiceProvider) AIReadiness() AIReadinessSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.snapshot
}

func (p *controlledAIServiceProvider) RetryAIReadiness() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.retries++
	return p.retryErr
}

func (p *controlledAIServiceProvider) UpdateAIServiceStartupOptions(options AIServiceStartupOptions) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.updates = append(p.updates, options)
	revision := uint64(0)
	if options.FilesystemScope != nil {
		revision = options.FilesystemScope.Revision()
	}
	p.scopeRevisions = append(p.scopeRevisions, revision)
}

func (p *controlledAIServiceProvider) counts() (int, int, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.acquires, p.releases, p.retries
}

func (p *controlledAIServiceProvider) startupUpdates() ([]AIServiceStartupOptions, []uint64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]AIServiceStartupOptions(nil), p.updates...), append([]uint64(nil), p.scopeRevisions...)
}

func TestAIReadinessRoutesUseOneLeaseAndOneUnavailableEnvelope(t *testing.T) {
	provider := &controlledAIServiceProvider{
		service: new(ai.Service), snapshot: AIReadinessSnapshot{State: AIReadinessReady},
	}
	srv, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})

	res := serveAIReadinessTestRequest(srv, origin, http.MethodPut, "/_redeven_proxy/api/ai/default_permission", []byte("{"))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("invalid request status = %d, body=%s", res.Code, res.Body.String())
	}
	if acquires, releases, _ := provider.counts(); acquires != 1 || releases != 1 {
		t.Fatalf("ready request lease counts = (%d, %d), want (1, 1)", acquires, releases)
	}

	provider.mu.Lock()
	provider.service = nil
	provider.snapshot = AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: "store_integrity_error"}
	provider.mu.Unlock()
	res = serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/ai/skills", nil)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("blocked status = %d, body=%s", res.Code, res.Body.String())
	}
	var envelope apiResp
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.ErrorCode != AIServiceUnavailableErrorCode || envelope.Error != ErrAIServiceUnavailable.Error() {
		t.Fatalf("blocked envelope = %#v", envelope)
	}
}

func TestAIReadinessDoesNotBlockSettingsOrSecretRoutes(t *testing.T) {
	provider := &controlledAIServiceProvider{
		snapshot: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: "environment_permission_error"},
	}
	srv, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})

	settingsRes := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/settings", nil)
	if settingsRes.Code != http.StatusOK {
		t.Fatalf("settings status = %d, body=%s", settingsRes.Code, settingsRes.Body.String())
	}
	if !bytes.Contains(settingsRes.Body.Bytes(), []byte(`"ai_readiness":{"state":"blocked","reason_code":"environment_permission_error"`)) {
		t.Fatalf("settings readiness missing: %s", settingsRes.Body.String())
	}
	before, _, _ := provider.counts()
	secretRes := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/ai/provider_keys/status", []byte("{"))
	if secretRes.Code != http.StatusBadRequest {
		t.Fatalf("secret status route = %d, body=%s", secretRes.Code, secretRes.Body.String())
	}
	after, _, _ := provider.counts()
	if after != before {
		t.Fatalf("secret-only route acquired AI service: before=%d after=%d", before, after)
	}

	readinessRes := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/ai/readiness", nil)
	if readinessRes.Code != http.StatusOK {
		t.Fatalf("readiness status = %d, body=%s", readinessRes.Code, readinessRes.Body.String())
	}
	retryRes := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/ai/readiness/retry", nil)
	if retryRes.Code != http.StatusAccepted {
		t.Fatalf("retry status = %d, body=%s", retryRes.Code, retryRes.Body.String())
	}
	if acquires, _, retries := provider.counts(); acquires != after || retries != 1 {
		t.Fatalf("readiness calls counts = acquires %d retries %d", acquires, retries)
	}
}

func TestAIOrphanMaintenanceKeepsThreadIDsAdminOnly(t *testing.T) {
	provider := &controlledAIServiceProvider{
		service:      new(ai.Service),
		snapshot:     AIReadinessSnapshot{State: AIReadinessDegraded, ReasonCode: AIHostThreadSettingsMissingReasonCode, IssueCount: 1},
		orphanReview: ai.OrphanCanonicalRootReview{IssueCount: 1, Items: []ai.OrphanCanonicalRoot{{ThreadID: "thread_secret", Phase: "idle", Status: "idle", CanAppendMessage: true}}},
	}
	readServer, readOrigin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true})
	readiness := serveAIReadinessTestRequest(readServer, readOrigin, http.MethodGet, "/_redeven_proxy/api/ai/readiness", nil)
	if readiness.Code != http.StatusOK || bytes.Contains(readiness.Body.Bytes(), []byte("thread_secret")) || !bytes.Contains(readiness.Body.Bytes(), []byte(`"issue_count":1`)) {
		t.Fatalf("ordinary readiness leaked or omitted degraded facts: %s", readiness.Body.String())
	}
	denied := serveAIReadinessTestRequest(readServer, readOrigin, http.MethodGet, "/_redeven_proxy/api/ai/maintenance/orphan_roots", nil)
	if denied.Code != http.StatusForbidden || bytes.Contains(denied.Body.Bytes(), []byte("thread_secret")) {
		t.Fatalf("non-admin maintenance response = %d %s", denied.Code, denied.Body.String())
	}

	adminServer, adminOrigin := newAIReadinessTestServer(t, provider, session.Meta{EndpointID: "env_a", NamespacePublicID: "ns_a", UserPublicID: "operator_a", CanRead: true, CanAdmin: true})
	review := serveAIReadinessTestRequest(adminServer, adminOrigin, http.MethodGet, "/_redeven_proxy/api/ai/maintenance/orphan_roots", nil)
	if review.Code != http.StatusOK || !bytes.Contains(review.Body.Bytes(), []byte("thread_secret")) {
		t.Fatalf("admin review = %d %s", review.Code, review.Body.String())
	}
	mismatch := serveAIReadinessTestRequest(adminServer, adminOrigin, http.MethodPost, "/_redeven_proxy/api/ai/maintenance/orphan_roots/adopt", []byte(`{"thread_id":"thread_secret","endpoint_id":"env_other","namespace_public_id":"ns_a","model_id":"provider/model","permission_type":"approval_required","working_dir":"/workspace"}`))
	if mismatch.Code != http.StatusForbidden {
		t.Fatalf("cross-endpoint adoption status = %d, body=%s", mismatch.Code, mismatch.Body.String())
	}
	namespaceMismatch := serveAIReadinessTestRequest(adminServer, adminOrigin, http.MethodPost, "/_redeven_proxy/api/ai/maintenance/orphan_roots/adopt", []byte(`{"thread_id":"thread_secret","endpoint_id":"env_a","namespace_public_id":"ns_other","model_id":"provider/model","permission_type":"approval_required","working_dir":"/workspace"}`))
	if namespaceMismatch.Code != http.StatusForbidden {
		t.Fatalf("cross-namespace adoption status = %d, body=%s", namespaceMismatch.Code, namespaceMismatch.Body.String())
	}
	adopted := serveAIReadinessTestRequest(adminServer, adminOrigin, http.MethodPost, "/_redeven_proxy/api/ai/maintenance/orphan_roots/adopt", []byte(`{"thread_id":"thread_secret","endpoint_id":"env_a","namespace_public_id":"ns_a","model_id":"provider/model","permission_type":"approval_required","working_dir":"/workspace"}`))
	if adopted.Code != http.StatusOK {
		t.Fatalf("explicit adoption status = %d, body=%s", adopted.Code, adopted.Body.String())
	}
	deleted := serveAIReadinessTestRequest(adminServer, adminOrigin, http.MethodPost, "/_redeven_proxy/api/ai/maintenance/orphan_roots/delete", []byte(`{"thread_id":"thread_secret"}`))
	if deleted.Code != http.StatusOK {
		t.Fatalf("explicit deletion status = %d, body=%s", deleted.Code, deleted.Body.String())
	}
	provider.mu.Lock()
	adoptCount, deleteCount := provider.adoptCount, provider.deleteCount
	provider.mu.Unlock()
	if adoptCount != 1 || deleteCount != 1 {
		t.Fatalf("maintenance calls = adopt %d delete %d", adoptCount, deleteCount)
	}
	if acquires, releases, _ := provider.counts(); acquires != 0 || releases != 0 {
		t.Fatalf("maintenance routes bypassed dedicated provider capability: acquires=%d releases=%d", acquires, releases)
	}
}

func TestAIReadinessPermissionDenialDoesNotAcquire(t *testing.T) {
	provider := &controlledAIServiceProvider{
		service: new(ai.Service), snapshot: AIReadinessSnapshot{State: AIReadinessReady},
	}
	srv, origin := newAIReadinessTestServer(t, provider, session.Meta{})
	res := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/ai/skills", nil)
	if res.Code != http.StatusForbidden {
		t.Fatalf("permission status = %d, body=%s", res.Code, res.Body.String())
	}
	if acquires, releases, _ := provider.counts(); acquires != 0 || releases != 0 {
		t.Fatalf("denied request lease counts = (%d, %d)", acquires, releases)
	}

	readOnlyProvider := &controlledAIServiceProvider{
		service: new(ai.Service), snapshot: AIReadinessSnapshot{State: AIReadinessReady},
	}
	readOnlyServer, readOnlyOrigin := newAIReadinessTestServer(t, readOnlyProvider, session.Meta{CanRead: true})
	res = serveAIReadinessTestRequest(readOnlyServer, readOnlyOrigin, http.MethodPut, "/_redeven_proxy/api/ai/default_permission", []byte(`{}`))
	if res.Code != http.StatusForbidden {
		t.Fatalf("read-only admin route status = %d, body=%s", res.Code, res.Body.String())
	}
	if acquires, releases, _ := readOnlyProvider.counts(); acquires != 0 || releases != 0 {
		t.Fatalf("read-only admin denial lease counts = (%d, %d)", acquires, releases)
	}
}

func TestAIReadinessUnknownOrMismatchedAIRoutesDoNotAcquire(t *testing.T) {
	tests := []struct {
		name     string
		provider *controlledAIServiceProvider
	}{
		{
			name: "ready",
			provider: &controlledAIServiceProvider{
				service: new(ai.Service), snapshot: AIReadinessSnapshot{State: AIReadinessReady},
			},
		},
		{
			name: "blocked",
			provider: &controlledAIServiceProvider{
				snapshot: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: "store_integrity_error"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, origin := newAIReadinessTestServer(t, tt.provider, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})
			requests := []struct {
				method string
				path   string
				status int
			}{
				{method: http.MethodGet, path: "/_redeven_proxy/api/ai/runs/run_1/unknown", status: http.StatusNotFound},
				{method: http.MethodPost, path: "/_redeven_proxy/api/ai/runs/run_1/terminal/process_1/unknown", status: http.StatusNotFound},
				{method: http.MethodPost, path: "/_redeven_proxy/api/ai/runs/run_1/terminal/process_1/read", status: http.StatusMethodNotAllowed},
				{method: http.MethodGet, path: "/_redeven_proxy/api/ai/composer-drafts/scope_1/unknown", status: http.StatusNotFound},
				{method: http.MethodPatch, path: "/_redeven_proxy/api/ai/composer-drafts/scope_1", status: http.StatusNotFound},
				{method: http.MethodGet, path: "/_redeven_proxy/api/ai/uploads/upload_1/unknown", status: http.StatusNotFound},
				{method: http.MethodPatch, path: "/_redeven_proxy/api/ai/uploads/upload_1", status: http.StatusMethodNotAllowed},
				{method: http.MethodGet, path: "/_redeven_proxy/api/ai/uploads", status: http.StatusMethodNotAllowed},
				{method: http.MethodPost, path: "/_redeven_proxy/api/ai/uploads/upload_1/long_text", status: http.StatusMethodNotAllowed},
			}
			for _, request := range requests {
				res := serveAIReadinessTestRequest(srv, origin, request.method, request.path, nil)
				if res.Code != request.status {
					t.Fatalf("%s %s status = %d, want %d; body=%s", request.method, request.path, res.Code, request.status, res.Body.String())
				}
			}
			if acquires, releases, _ := tt.provider.counts(); acquires != 0 || releases != 0 {
				t.Fatalf("unknown or mismatched AI routes lease counts = (%d, %d), want (0, 0)", acquires, releases)
			}
		})
	}
}

func TestAIReadinessInvalidLeaseFailsClosedAndReleases(t *testing.T) {
	provider := new(invalidAIServiceProvider)
	srv, origin := newAIReadinessTestServer(t, provider, session.Meta{CanRead: true})

	res := serveAIReadinessTestRequest(srv, origin, http.MethodGet, "/_redeven_proxy/api/ai/skills", nil)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid lease status = %d, body=%s", res.Code, res.Body.String())
	}
	if !bytes.Contains(res.Body.Bytes(), []byte(`"state":"blocked","reason_code":"ai_readiness_contract_error"`)) {
		t.Fatalf("invalid lease did not fail closed: %s", res.Body.String())
	}
	if provider.releases != 1 {
		t.Fatalf("invalid lease release count = %d, want 1", provider.releases)
	}
}

func TestAIReadinessRetrySanitizesProviderError(t *testing.T) {
	provider := &controlledAIServiceProvider{
		snapshot: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIServiceStartupErrorReasonCode},
		retryErr: errors.New("secret database path and raw startup detail"),
	}
	srv, origin := newAIReadinessTestServer(t, provider, session.Meta{CanAdmin: true})

	res := serveAIReadinessTestRequest(srv, origin, http.MethodPost, "/_redeven_proxy/api/ai/readiness/retry", nil)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("retry status = %d, body=%s", res.Code, res.Body.String())
	}
	if bytes.Contains(res.Body.Bytes(), []byte("secret database path")) || !bytes.Contains(res.Body.Bytes(), []byte(ErrAIServiceUnavailable.Error())) {
		t.Fatalf("retry error was not sanitized: %s", res.Body.String())
	}
}

func TestSanitizeAIReadinessSnapshotRejectsUnknownContractValues(t *testing.T) {
	tests := []struct {
		name string
		in   AIReadinessSnapshot
		want AIReadinessSnapshot
	}{
		{
			name: "unknown state",
			in: AIReadinessSnapshot{
				State: "starting_up", ReasonCode: "raw_internal_failure", Retryable: true, SafeToRetry: true,
			},
			want: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIReadinessContractErrorReasonCode},
		},
		{
			name: "unknown blocked reason",
			in: AIReadinessSnapshot{
				State: AIReadinessBlocked, ReasonCode: "database path /private/secret", Committed: true,
			},
			want: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: AIReadinessContractErrorReasonCode},
		},
		{
			name: "ready clears failure fields",
			in: AIReadinessSnapshot{
				State: AIReadinessReady, ReasonCode: AIServiceStartupErrorReasonCode, Retryable: true, RolledBack: true,
			},
			want: AIReadinessSnapshot{State: AIReadinessReady},
		},
		{
			name: "transient clears failure fields",
			in: AIReadinessSnapshot{
				State: AIReadinessMigrating, ReasonCode: AIServiceStartupErrorReasonCode, SafeToRetry: true,
			},
			want: AIReadinessSnapshot{State: AIReadinessMigrating},
		},
		{
			name: "known reason is normalized",
			in:   AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: " environment_permission_error ", Retryable: true},
			want: AIReadinessSnapshot{State: AIReadinessBlocked, ReasonCode: "environment_permission_error", Retryable: true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeAIReadinessSnapshot(tt.in); got != tt.want {
				t.Fatalf("sanitized snapshot = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func newAIReadinessTestServer(t *testing.T, provider AIServiceProvider, meta session.Meta) (*Server, string) {
	t.Helper()
	channelID := "ch_ai_readiness"
	srv, err := New(Options{
		Backend:            &stubBackend{},
		DistFS:             fstest.MapFS{"env/index.html": {Data: []byte("<html></html>")}},
		ConfigPath:         writeTestConfig(t),
		AIServiceProvider:  provider,
		ResolveSessionMeta: resolveMetaForTest(channelID, meta),
		ListenAddr:         "127.0.0.1:0",
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv, envOriginWithChannel(channelID)
}

func serveAIReadinessTestRequest(srv *Server, origin string, method string, path string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Origin", origin)
	res := httptest.NewRecorder()
	srv.serveHTTP(res, req)
	return res
}
