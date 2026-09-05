package managedwebservice

import (
	"context"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func testNPMIntegrity(seed string) string {
	digest := sha512.Sum512([]byte(seed))
	return "sha512-" + base64.StdEncoding.EncodeToString(digest[:])
}

func TestFetchNPMReleasesReturnsAllExactVersionsInSemverOrder(t *testing.T) {
	documents := map[string]any{
		"dist-tags": map[string]string{"latest": "1.0.0"},
		"versions": map[string]any{
			"1.0.0":          map[string]any{"version": "1.0.0", "dist": map[string]string{"integrity": testNPMIntegrity("stable")}, "engines": map[string]string{"node": ">=24 <27"}},
			"1.1.0-alpha.10": map[string]any{"version": "1.1.0-alpha.10", "dist": map[string]string{"integrity": testNPMIntegrity("alpha10")}, "deprecated": "use the stable channel"},
			"1.1.0-alpha.2":  map[string]any{"version": "1.1.0-alpha.2", "dist": map[string]string{"integrity": testNPMIntegrity("alpha2")}},
			"0.9.0":          map[string]any{"version": "0.9.0", "dist": map[string]string{"integrity": "sha1-unverifiable"}},
			"invalid":        map[string]any{"version": "latest", "dist": map[string]string{"integrity": "sha1-invalid"}},
		},
		"time": map[string]string{"1.0.0": "2026-08-31T12:00:00.000Z"},
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.RequestURI != "/@scope%2Fpackage" {
			t.Fatalf("unexpected package request URI %q", request.RequestURI)
		}
		_ = json.NewEncoder(response).Encode(documents)
	}))
	t.Cleanup(server.Close)

	items, err := fetchNPMReleases(context.Background(), server.Client(), NPMHostPackageSpec{PackageName: "@scope/package", RegistryURL: server.URL}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Fatalf("got %d releases, want 4", len(items))
	}
	got := []string{items[0].Version, items[1].Version, items[2].Version, items[3].Version}
	want := []string{"1.1.0-alpha.10", "1.1.0-alpha.2", "1.0.0", "0.9.0"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("versions = %v, want %v", got, want)
	}
	if !items[0].Deprecated || items[0].DeprecationMessage == "" {
		t.Fatal("deprecated release metadata was lost")
	}
	if items[2].PublishedAtUnixMs != time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC).UnixMilli() {
		t.Fatal("published timestamp was not preserved")
	}
	if items[3].IntegrityVerified {
		t.Fatal("unverifiable integrity was treated as verified")
	}
}

func TestDiscoverNPMCandidatesKeepsLastSuccessAndNeverReturnsToken(t *testing.T) {
	var fail atomic.Bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer private-token" {
			t.Errorf("missing request-scoped npm token")
		}
		if fail.Load() {
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]any{
			"versions": map[string]any{"2.0.0-beta.1": map[string]any{
				"version": "2.0.0-beta.1", "dist": map[string]string{"integrity": testNPMIntegrity("candidate")}, "engines": map[string]string{"node": ">=26 <27"},
			}},
		})
	}))
	t.Cleanup(server.Close)
	m := &Manager{
		releaseClient: server.Client(), releaseItems: map[string]cachedReleaseCandidate{}, releaseViews: map[string]ReleaseCandidateResult{}, releaseCursors: map[string]cachedReleaseCursor{},
	}
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Host: &HostTemplateSpec{NPM: &NPMHostPackageSpec{PackageName: "@scope/private", Version: "1.0.0", RegistryURL: server.URL, AuthTokenParameter: "registry_token", Executable: "private"}}}
	browse := releaseBrowseContext{Scope: "template:private", TemplateID: "private", Spec: spec, Parameters: map[string]string{"registry_token": "private-token"}, TemplateSource: "custom"}
	result, err := m.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "refresh"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].Channel != "preview" || result.Candidates[0].Trust != "user_configured_registry" {
		t.Fatalf("unexpected candidates: %#v", result.Candidates)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "private-token") {
		t.Fatal("release candidate result exposed the registry token")
	}
	checkedAt := result.CheckedAtUnixMs
	fail.Store(true)
	result, err = m.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "refresh"})
	if err != nil {
		t.Fatalf("last successful result should remain usable: %v", err)
	}
	if len(result.Candidates) != 1 || result.CheckedAtUnixMs != checkedAt || result.LastErrorCode == "" {
		t.Fatalf("stale success state was not preserved: %#v", result)
	}
}

type releaseCredentialClient struct {
	credential    containerengine.RegistryCredential
	credentialErr error
	calls         atomic.Int32
}

func (*releaseCredentialClient) Status(context.Context, containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{}, nil
}

func (*releaseCredentialClient) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	return nil, nil
}

func (*releaseCredentialClient) Inspect(context.Context, containerengine.Engine, string) (containerengine.EngineContainer, error) {
	return containerengine.EngineContainer{}, nil
}

func (*releaseCredentialClient) Action(context.Context, containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	return containerengine.EngineActionResult{}, nil
}

func (*releaseCredentialClient) TailLogs(context.Context, containerengine.EngineLogsRequest) (containerengine.EngineLogsResult, error) {
	return containerengine.EngineLogsResult{}, nil
}

func (*releaseCredentialClient) PullImage(context.Context, containerengine.Engine, string) (containerengine.EngineImageResult, error) {
	return containerengine.EngineImageResult{}, nil
}

func (c *releaseCredentialClient) RegistryCredential(context.Context, containerengine.Engine, string) (containerengine.RegistryCredential, error) {
	c.calls.Add(1)
	return c.credential, c.credentialErr
}

func TestDiscoverOCICandidatesFallsBackToAnonymousForPublicRegistry(t *testing.T) {
	platformDigest := testReleaseDigest("b")
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "" {
			t.Errorf("anonymous Registry request unexpectedly used authorization")
		}
		switch request.URL.Path {
		case "/v2/team/app/tags/list":
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"1.2.3"}})
		case "/v2/team/app/manifests/1.2.3":
			response.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			_ = json.NewEncoder(response).Encode(map[string]any{"schemaVersion": 2, "manifests": []map[string]any{{"digest": platformDigest, "platform": map[string]string{"os": "linux", "architecture": runtime.GOARCH}}}})
		default:
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
	}))
	t.Cleanup(server.Close)
	credentials := &releaseCredentialClient{credentialErr: errors.New("credential helper is unavailable")}
	adapter, err := containerengine.NewAdapter(credentials)
	if err != nil {
		t.Fatal(err)
	}
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{containers: adapter, releaseClient: server.Client()}
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentContainer,
		Container:     &ContainerTemplateSpec{Image: host + "/team/app:1.0.0@" + testReleaseDigest("c")},
	}
	result, err := manager.browseReleaseCandidates(context.Background(), releaseBrowseContext{Scope: "template:public", TemplateID: "public", Spec: spec, TemplateSource: "builtin"}, ReleaseCandidateRequest{Action: "refresh"})
	if err != nil {
		t.Fatalf("public anonymous discovery failed after credential lookup error: %v", err)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].VerificationStatus != "pending" {
		t.Fatalf("unexpected anonymous tag candidates: %#v", result.Candidates)
	}
	result, err = manager.browseReleaseCandidates(context.Background(), releaseBrowseContext{Scope: "template:public", TemplateID: "public", Spec: spec, TemplateSource: "builtin"}, ReleaseCandidateRequest{Action: "verify", CandidateIDs: []string{result.Candidates[0].CandidateID}})
	if err != nil || !result.Candidates[0].Selectable {
		t.Fatalf("unexpected verified anonymous candidates: %#v, error: %v", result.Candidates, err)
	}
	if calls := credentials.calls.Load(); calls != 0 {
		t.Fatalf("public Registry requested local credentials %d times", calls)
	}
}

func TestOCIReleaseCatalogReadsCredentialsOnlyAfterAnonymousAuthenticationFailure(t *testing.T) {
	var anonymousRequests atomic.Int32
	var authenticatedRequests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/team/app/tags/list" {
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
		username, secret, authenticated := request.BasicAuth()
		if !authenticated {
			anonymousRequests.Add(1)
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		authenticatedRequests.Add(1)
		if username != "registry-user" || secret != "registry-secret" {
			t.Fatalf("unexpected Registry credentials %q/%q", username, secret)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"1.2.3"}})
	}))
	t.Cleanup(server.Close)
	credentials := &releaseCredentialClient{credential: containerengine.RegistryCredential{Username: "registry-user", Secret: "registry-secret"}}
	adapter, err := containerengine.NewAdapter(credentials)
	if err != nil {
		t.Fatal(err)
	}
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{containers: adapter, releaseClient: server.Client()}
	result, err := manager.browseReleaseCandidates(context.Background(), releaseBrowseContext{
		Scope: "template:private", TemplateID: "private", TemplateSource: "builtin",
		Spec: TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: host + "/team/app:1.0.0@" + testReleaseDigest("c")}},
	}, ReleaseCandidateRequest{Action: "refresh"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].Tag != "1.2.3" {
		t.Fatalf("authenticated Registry candidates = %#v", result.Candidates)
	}
	if credentials.calls.Load() != 1 || anonymousRequests.Load() != 1 || authenticatedRequests.Load() != 1 {
		t.Fatalf("credential calls=%d anonymous requests=%d authenticated requests=%d", credentials.calls.Load(), anonymousRequests.Load(), authenticatedRequests.Load())
	}
}

func TestOCIReleaseCatalogPinsAndVerifiesCurrentAndRecommendedTags(t *testing.T) {
	currentDigest := testReleaseDigest("a")
	recommendedDigest := testReleaseDigest("b")
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/v2/team/app/tags/list":
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"9.0.0", "8.0.0"}})
		case strings.HasPrefix(request.URL.Path, "/v2/team/app/manifests/"):
			tag := strings.TrimPrefix(request.URL.Path, "/v2/team/app/manifests/")
			digest := testReleaseDigest("c")
			switch tag {
			case "1.0.0":
				digest = currentDigest
			case "2.0.0":
				digest = recommendedDigest
			}
			response.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			_ = json.NewEncoder(response).Encode(map[string]any{"schemaVersion": 2, "manifests": []map[string]any{{"digest": digest, "platform": map[string]string{"os": "linux", "architecture": runtime.GOARCH}}}})
		default:
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	repository := host + "/team/app"
	manager := &Manager{releaseClient: server.Client()}
	browse := releaseBrowseContext{
		Scope: "service:mws-one", ServiceID: "", TemplateID: "example", TemplateSource: "builtin",
		Spec:        TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: repository + ":2.0.0@" + recommendedDigest}},
		Current:     &ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: repository, Tag: "1.0.0", Digest: currentDigest},
		Recommended: &ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: repository, Tag: "2.0.0", Digest: recommendedDigest},
	}
	result, err := manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Candidates) != 4 || !result.Candidates[0].IsCurrent {
		t.Fatalf("pinned release order = %#v", result.Candidates)
	}
	recommendedIndex := slices.IndexFunc(result.Candidates, func(candidate ReleaseCandidate) bool { return candidate.Tag == "2.0.0" })
	if recommendedIndex < 0 || result.Candidates[recommendedIndex].IsRecommended || result.Candidates[recommendedIndex].RecommendationStatus != "pending" {
		t.Fatalf("pending recommendation = %#v", result.Candidates)
	}
	ids := []string{result.Candidates[0].CandidateID, result.Candidates[recommendedIndex].CandidateID}
	result, err = manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "verify", CandidateIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Candidates[0].Selectable || !result.Candidates[1].Selectable || result.Candidates[0].VerificationStatus != "verified" || result.Candidates[1].VerificationStatus != "verified" {
		t.Fatalf("verified pinned releases = %#v", result.Candidates[:2])
	}
}

func TestOCIRecommendationIsNotSelectableOrBadgedWhenThePinnedTagDisappears(t *testing.T) {
	browse := releaseBrowseContext{
		Scope: "template:webtop", TemplateID: "webtop", TemplateSource: "builtin",
		Spec:        TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: "registry.example/team/webtop:recommended@" + testReleaseDigest("a")}},
		Recommended: &ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: "registry.example/team/webtop", Tag: "recommended", Digest: testReleaseDigest("a")},
	}
	pending := pendingOCIReleaseCandidate(browse, "recommended")
	if pending.Candidate.IsRecommended || pending.Candidate.RecommendationStatus != "pending" {
		t.Fatalf("pending recommendation = %+v", pending.Candidate)
	}
	unavailable := verifiedOCIReleaseCandidate(browse, pending, containerengine.OCIRelease{Tag: "recommended", ReasonCode: "RELEASE_NOT_FOUND", Reason: "missing", Compatible: false})
	if unavailable.Candidate.IsRecommended || unavailable.Candidate.Selectable || unavailable.Candidate.RecommendationStatus != "unavailable" || unavailable.Candidate.VerificationStatus != "unavailable" || unavailable.Candidate.Digest != testReleaseDigest("a") {
		t.Fatalf("unavailable recommendation = %+v", unavailable.Candidate)
	}
	available := verifiedOCIReleaseCandidate(browse, pending, containerengine.OCIRelease{Tag: "recommended", PlatformDigest: testReleaseDigest("a"), Compatible: true})
	if !available.Candidate.IsRecommended || !available.Candidate.Selectable || available.Candidate.RecommendationStatus != "available" {
		t.Fatalf("available recommendation = %+v", available.Candidate)
	}
	moved := verifiedOCIReleaseCandidate(browse, pending, containerengine.OCIRelease{Tag: "recommended", PlatformDigest: testReleaseDigest("b"), Compatible: true})
	if moved.Candidate.IsRecommended || !moved.Candidate.Selectable || moved.Candidate.RecommendationStatus != "unavailable" {
		t.Fatalf("moved recommendation = %+v", moved.Candidate)
	}
}

func TestOCIRecommendationKeepsVerifiedDigestSelectableWhenItsTagDisappears(t *testing.T) {
	manifest := []byte(`{"schemaVersion":2,"config":{"digest":"` + testReleaseDigest("c") + `"}}`)
	sum := sha256.Sum256(manifest)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v2/team/webtop/manifests/recommended":
			response.WriteHeader(http.StatusNotFound)
		case "/v2/team/webtop/manifests/" + digest:
			response.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			_, _ = response.Write(manifest)
		case "/v2/team/webtop/blobs/" + testReleaseDigest("c"):
			_ = json.NewEncoder(response).Encode(map[string]string{"os": "linux", "architecture": runtime.GOARCH})
		default:
			response.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{releaseClient: server.Client(), releaseItems: map[string]cachedReleaseCandidate{}, releaseViews: map[string]ReleaseCandidateResult{}, releaseCursors: map[string]cachedReleaseCursor{}}
	browse := releaseBrowseContext{
		Scope: "template:webtop", TemplateID: "webtop", TemplateSource: "builtin",
		Spec:        TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: host + "/team/webtop:recommended@" + digest}},
		Recommended: &ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: host + "/team/webtop", Tag: "recommended", Digest: digest, Platform: "linux/" + runtime.GOARCH},
	}
	result, err := manager.replaceReleaseView(context.Background(), browse, []cachedReleaseCandidate{pendingOCIReleaseCandidate(browse, "recommended")}, "complete", "")
	if err != nil {
		t.Fatal(err)
	}
	result, err = manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "verify", CandidateIDs: []string{result.Candidates[0].CandidateID}})
	if err != nil {
		t.Fatal(err)
	}
	candidate := result.Candidates[0]
	if !candidate.Selectable || !candidate.DigestVerified || candidate.IsRecommended || candidate.RecommendationStatus != "unavailable" || candidate.ReasonCode != "RECOMMENDED_TAG_UNAVAILABLE_DIGEST_VERIFIED" || candidate.Digest != digest {
		t.Fatalf("verified fixed recommendation = %+v", candidate)
	}
	selected, err := manager.resolveReleaseCandidate(context.Background(), browse.Scope, candidate.CandidateID, nil, nil, "builtin")
	if err != nil {
		t.Fatal(err)
	}
	if selected.Identity.Tag != "recommended" || selected.Identity.Digest != digest || selected.Identity.ArtifactReference != host+"/team/webtop:recommended@"+digest {
		t.Fatalf("selected fixed identity = %+v", selected.Identity)
	}
}

func TestEnsureDefaultReleaseAvailableRejectsAStaleBuiltinOCIRecommendation(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/team/webtop/manifests/recommended" {
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
		response.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	digest := testReleaseDigest("a")
	manager := &Manager{releaseClient: server.Client()}
	template := Template{
		Source:             "builtin",
		Spec:               &TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: host + "/team/webtop:recommended@" + digest}},
		RecommendedRelease: &ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: host + "/team/webtop", Tag: "recommended", Digest: digest},
	}
	if err := manager.ensureDefaultReleaseAvailable(context.Background(), template, nil); err == nil {
		t.Fatal("stale built-in recommendation was accepted")
	} else if code, _, _, retryable := ErrorDetails(err); code != "RECOMMENDED_RELEASE_UNAVAILABLE" || !retryable {
		t.Fatalf("error = (%q, retryable=%t), want RECOMMENDED_RELEASE_UNAVAILABLE", code, retryable)
	}
}

func TestDiscoverOCICandidatesReportsCredentialStoreOnlyWhenRegistryRequiresAuthentication(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)
	credentialErr := errors.New("credential helper is unavailable")
	adapter, err := containerengine.NewAdapter(&releaseCredentialClient{credentialErr: credentialErr})
	if err != nil {
		t.Fatal(err)
	}
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{containers: adapter, releaseClient: server.Client()}
	_, err = manager.browseReleaseCandidates(context.Background(), releaseBrowseContext{Scope: "template:private", TemplateID: "private", Spec: TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentContainer,
		Container:     &ContainerTemplateSpec{Image: host + "/team/app:1.0.0@" + testReleaseDigest("c")},
	}, TemplateSource: "builtin"}, ReleaseCandidateRequest{Action: "refresh"})
	code, _, _, retryable := ErrorDetails(err)
	if code != "RELEASE_SOURCE_AUTH_UNAVAILABLE" || !retryable {
		t.Fatalf("authenticated Registry error = (%q, retryable=%t), want RELEASE_SOURCE_AUTH_UNAVAILABLE", code, retryable)
	}
}

func TestOCIReleaseCatalogRetriesOpenAfterAnInitialSourceFailure(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/team/app/tags/list" {
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
		if requests.Add(1) == 1 {
			response.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"1.0.0"}})
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{releaseClient: server.Client()}
	browse := releaseBrowseContext{
		Scope: "template:retry", TemplateID: "retry", TemplateSource: "builtin",
		Spec: TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: host + "/team/app:1.0.0@" + testReleaseDigest("a")}},
	}
	if _, err := manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "open"}); err == nil {
		t.Fatal("initial source failure was not returned")
	}
	result, err := manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "open"})
	if err != nil {
		t.Fatalf("reopened catalog did not retry the source: %v", err)
	}
	if requests.Load() != 2 || len(result.Candidates) != 1 || result.Candidates[0].Tag != "1.0.0" {
		t.Fatalf("retried release catalog = %#v, requests=%d", result, requests.Load())
	}
}

func TestOCIReleaseCatalogKeepsPaginationCursorAfterCancellation(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/team/app/tags/list" {
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
		if request.URL.Query().Get("last") == "" {
			response.Header().Set("Link", `</v2/team/app/tags/list?n=100&last=1.0.0>; rel="next"`)
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"1.0.0"}})
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"2.0.0"}})
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{releaseClient: server.Client()}
	browse := releaseBrowseContext{
		Scope: "template:cancel-page", TemplateID: "cancel-page", TemplateSource: "builtin",
		Spec: TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: host + "/team/app:1.0.0@" + testReleaseDigest("a")}},
	}
	result, err := manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "open"})
	if err != nil || !result.HasMore || result.CursorID == "" {
		t.Fatalf("first page = %#v, error=%v", result, err)
	}
	cursorID := result.CursorID
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	result, err = manager.browseReleaseCandidates(cancelled, browse, ReleaseCandidateRequest{Action: "continue", CursorID: cursorID})
	if !errors.Is(err, context.Canceled) || result != nil {
		t.Fatalf("cancelled page = %#v, error=%v", result, err)
	}
	result, err = manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "continue", CursorID: cursorID})
	if err != nil {
		t.Fatalf("cursor was consumed by cancellation: %v", err)
	}
	if result.HasMore || len(result.Candidates) != 2 {
		t.Fatalf("retried page = %#v", result)
	}
}

func TestOCIReleaseCatalogRefetchesExpiredTemplateCandidateIDs(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v2/team/app/tags/list" {
			t.Fatalf("unexpected Registry request %s", request.URL)
		}
		requests.Add(1)
		_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"1.0.0"}})
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	manager := &Manager{releaseClient: server.Client()}
	browse := releaseBrowseContext{
		Scope: "template:expired", TemplateID: "expired", TemplateSource: "builtin",
		Spec: TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentContainer, Container: &ContainerTemplateSpec{Image: host + "/team/app:1.0.0@" + testReleaseDigest("a")}},
	}
	first, err := manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "open"})
	if err != nil || len(first.Candidates) != 1 {
		t.Fatalf("first catalog = %#v, error=%v", first, err)
	}
	oldID := first.Candidates[0].CandidateID
	manager.releaseMu.Lock()
	expired := manager.releaseItems[oldID]
	expired.ExpiresAt = time.Now().Add(-time.Second)
	manager.releaseItems[oldID] = expired
	manager.releaseMu.Unlock()
	second, err := manager.browseReleaseCandidates(context.Background(), browse, ReleaseCandidateRequest{Action: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 2 || len(second.Candidates) != 1 || second.Candidates[0].CandidateID == oldID {
		t.Fatalf("expired catalog was reused: %#v, requests=%d", second, requests.Load())
	}
}

func TestNodeRangeCompatibilityFailsClosed(t *testing.T) {
	for _, test := range []struct {
		rangeValue string
		compatible bool
	}{
		{rangeValue: ">=24 <25", compatible: true},
		{rangeValue: "^24.0.0", compatible: true},
		{rangeValue: "~25.9.0", compatible: false},
		{rangeValue: "22.x || 24.x", compatible: true},
		{rangeValue: "workspace:*", compatible: false},
	} {
		compatible, _, _ := nodeRangeCompatible(test.rangeValue)
		if compatible != test.compatible {
			t.Errorf("range %q compatible=%t, want %t", test.rangeValue, compatible, test.compatible)
		}
	}
}

func TestReleaseRelationKeepsOlderAndOpaqueVersionsSelectable(t *testing.T) {
	current := &ReleaseIdentity{Kind: "npm", Source: "@scope/package", Registry: "https://registry.example/", Version: "2.0.0"}
	if got := releaseRelation(current, ReleaseIdentity{Kind: "npm", Source: current.Source, Registry: current.Registry, Version: "1.9.0"}); got != "older" {
		t.Fatalf("older relation = %q", got)
	}
	if got := releaseRelation(current, ReleaseIdentity{Kind: "npm", Source: current.Source, Registry: current.Registry, Version: "2.1.0"}); got != "newer" {
		t.Fatalf("newer relation = %q", got)
	}
	container := &ReleaseIdentity{Kind: "oci", Source: "registry.example/team/app", Tag: "nightly", Digest: testReleaseDigest("a")}
	if got := releaseRelation(container, ReleaseIdentity{Kind: "oci", Source: container.Source, Tag: "market", Digest: testReleaseDigest("b")}); got != "unknown" {
		t.Fatalf("opaque relation = %q", got)
	}
}

func TestVerifyExpectedNPMReleaseIdentityRejectsMovedPublishedVersion(t *testing.T) {
	expected := ReleaseIdentity{
		SchemaVersion: 1, Kind: "npm", Source: "@scope/package", Registry: "https://registry.example/",
		Version: "1.2.3", Integrity: testNPMIntegrity("selected"), Platform: currentPlatformKey(),
	}
	raw, digest, err := canonicalReleaseIdentity(expected)
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{ReleaseIdentityJSON: raw, ReleaseIdentitySHA256: digest}
	actual := expected
	actual.Integrity = testNPMIntegrity("moved")
	if err := verifyExpectedNPMReleaseIdentity(service, actual); err == nil {
		t.Fatal("accepted an npm version whose Registry integrity changed after selection")
	} else if code, _, _, _ := ErrorDetails(err); code != "RELEASE_CANDIDATE_CHANGED" {
		t.Fatalf("error code = %q, want RELEASE_CANDIDATE_CHANGED", code)
	}
	actual.Integrity = expected.Integrity
	actual.Trust = "registry_verified"
	if err := verifyExpectedNPMReleaseIdentity(service, actual); err != nil {
		t.Fatalf("rejected the exact selected npm identity: %v", err)
	}
}

func testReleaseDigest(character string) string {
	return "sha256:" + strings.Repeat(character, 64)
}

func TestManagedNodeRuntimeDigestExcludesApplicationButDetectsRuntimeMutation(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "runtime", "node"), []byte("verified"), 0o700); err != nil {
		t.Fatal(err)
	}
	before, err := managedNodeRuntimeDigest(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "app"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "package.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	afterApp, err := managedNodeRuntimeDigest(root)
	if err != nil || afterApp != before {
		t.Fatalf("application changed runtime digest: before=%s after=%s err=%v", before, afterApp, err)
	}
	if err := os.MkdirAll(filepath.Join(root, "bin"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "bin", "managed-service"), []byte("launcher"), 0o700); err != nil {
		t.Fatal(err)
	}
	afterLauncher, err := managedNodeRuntimeDigest(root)
	if err != nil || afterLauncher != before {
		t.Fatalf("managed launcher changed runtime digest: before=%s after=%s err=%v", before, afterLauncher, err)
	}
	unexpected := filepath.Join(root, "bin", "unexpected")
	if err := os.WriteFile(unexpected, []byte("unexpected"), 0o700); err != nil {
		t.Fatal(err)
	}
	afterUnexpected, err := managedNodeRuntimeDigest(root)
	if err != nil {
		t.Fatal(err)
	}
	if afterUnexpected == before {
		t.Fatal("unexpected managed bin content was not detected")
	}
	if err := os.Remove(unexpected); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "runtime", "node"), []byte("mutated"), 0o700); err != nil {
		t.Fatal(err)
	}
	afterMutation, err := managedNodeRuntimeDigest(root)
	if err != nil {
		t.Fatal(err)
	}
	if afterMutation == before {
		t.Fatal("runtime mutation was not detected")
	}
}
