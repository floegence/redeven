package managedwebservice

import (
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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
		releaseClient: server.Client(), releaseItems: map[string]cachedReleaseCandidate{}, releaseViews: map[string]ReleaseCandidateResult{},
	}
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Host: &HostTemplateSpec{NPM: &NPMHostPackageSpec{PackageName: "@scope/private", Version: "1.0.0", RegistryURL: server.URL, AuthTokenParameter: "registry_token", Executable: "private"}}}
	result, err := m.discoverAndCache(context.Background(), "template:private", "private", spec, map[string]string{"registry_token": "private-token"}, nil, "custom")
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
	result, err = m.discoverAndCache(withReleaseSourceRefresh(context.Background()), "template:private", "private", spec, map[string]string{"registry_token": "private-token"}, nil, "custom")
	if err != nil {
		t.Fatalf("last successful result should remain usable: %v", err)
	}
	if len(result.Candidates) != 1 || result.CheckedAtUnixMs != checkedAt || result.LastErrorCode == "" {
		t.Fatalf("stale success state was not preserved: %#v", result)
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
