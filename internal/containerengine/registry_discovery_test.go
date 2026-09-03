package containerengine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const (
	testAMD64Digest  = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	testARM64Digest  = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	testConfigDigest = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
)

func TestOCIReleaseDiscoveryPaginatesAndSelectsPlatformDigest(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Basic "+base64.StdEncoding.EncodeToString([]byte("user:secret")) {
			t.Errorf("registry credential was not applied")
		}
		switch {
		case request.URL.Path == "/v2/team/app/tags/list" && request.URL.Query().Get("last") == "":
			response.Header().Set("Link", `</v2/team/app/tags/list?n=100&last=1.0.0>; rel="next"`)
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"1.0.0"}})
		case request.URL.Path == "/v2/team/app/tags/list":
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"arm-only", "bad tag"}})
		case strings.HasPrefix(request.URL.Path, "/v2/team/app/manifests/"):
			response.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			manifests := []map[string]any{{"digest": testARM64Digest, "platform": map[string]string{"os": "linux", "architecture": "arm64"}}}
			if strings.HasSuffix(request.URL.Path, "/1.0.0") {
				manifests = append(manifests, map[string]any{"digest": testAMD64Digest, "platform": map[string]string{"os": "linux", "architecture": "amd64"}})
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"schemaVersion": 2, "manifests": manifests})
		default:
			t.Fatalf("unexpected request %s", request.URL)
		}
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	discovery := OCIReleaseDiscovery{Client: server.Client()}
	request := OCIReleaseTagPageRequest{Reference: host + "/team/app:old", Credential: RegistryCredential{Username: "user", Secret: "secret"}}
	first, err := discovery.ListTagsPage(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Tags) != 1 || first.Tags[0] != "1.0.0" || first.NextCursor == "" {
		t.Fatalf("unexpected first tag page: %#v", first)
	}
	request.Cursor = first.NextCursor
	second, err := discovery.ListTagsPage(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	items, err := discovery.VerifyTags(context.Background(), OCIReleaseVerificationRequest{Reference: request.Reference, PlatformOS: "linux", PlatformArch: "amd64", Credential: request.Credential, Tags: append(first.Tags, second.Tags...)})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("got %d releases, want 2", len(items))
	}
	byTag := map[string]OCIRelease{items[0].Tag: items[0], items[1].Tag: items[1]}
	if got := byTag["1.0.0"]; !got.Compatible || got.PlatformDigest != testAMD64Digest || !registryDigestPattern.MatchString(got.IndexDigest) {
		t.Fatalf("unexpected amd64 release: %#v", got)
	}
	if got := byTag["arm-only"]; got.Compatible || got.ReasonCode != "PLATFORM_UNAVAILABLE" {
		t.Fatalf("unexpected incompatible release: %#v", got)
	}
}

func TestOCIReleaseDiscoveryUsesBearerChallengeAndVerifiesSingleManifestPlatform(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/token" {
			if request.URL.Query().Get("scope") != "repository:team/app:pull" {
				t.Errorf("unexpected token scope %q", request.URL.Query().Get("scope"))
			}
			_ = json.NewEncoder(response).Encode(map[string]string{"token": "registry-token"})
			return
		}
		if request.Header.Get("Authorization") != "Bearer registry-token" {
			response.Header().Set("WWW-Authenticate", `Bearer realm="`+server.URL+`/token",service="test"`)
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch request.URL.Path {
		case "/v2/team/app/tags/list":
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"2.0.0"}})
		case "/v2/team/app/manifests/2.0.0":
			response.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			_ = json.NewEncoder(response).Encode(map[string]any{"schemaVersion": 2, "config": map[string]string{"digest": testConfigDigest}})
		case "/v2/team/app/blobs/" + testConfigDigest:
			_ = json.NewEncoder(response).Encode(map[string]string{"os": "linux", "architecture": "amd64"})
		default:
			t.Fatalf("unexpected request %s", request.URL)
		}
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	discovery := OCIReleaseDiscovery{Client: server.Client()}
	page, err := discovery.ListTagsPage(context.Background(), OCIReleaseTagPageRequest{Reference: host + "/team/app"})
	if err != nil {
		t.Fatal(err)
	}
	items, err := discovery.VerifyTags(context.Background(), OCIReleaseVerificationRequest{Reference: host + "/team/app", PlatformOS: "linux", PlatformArch: "amd64", Tags: page.Tags})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || !items[0].Compatible || !registryDigestPattern.MatchString(items[0].PlatformDigest) {
		t.Fatalf("unexpected releases: %#v", items)
	}
}

func TestOCIReleaseDiscoveryKeepsUnverifiableTagVisibleButDisabled(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v2/team/app/tags/list":
			_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"bad", "good"}})
		case "/v2/team/app/manifests/bad":
			response.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			_, _ = response.Write([]byte(`{"schemaVersion":2,"config":{"digest":"invalid"}}`))
		case "/v2/team/app/manifests/good":
			response.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			_ = json.NewEncoder(response).Encode(map[string]any{"schemaVersion": 2, "manifests": []map[string]any{{"digest": testAMD64Digest, "platform": map[string]string{"os": "linux", "architecture": "amd64"}}}})
		default:
			t.Fatalf("unexpected request %s", request.URL)
		}
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	discovery := OCIReleaseDiscovery{Client: server.Client()}
	page, err := discovery.ListTagsPage(context.Background(), OCIReleaseTagPageRequest{Reference: host + "/team/app"})
	if err != nil {
		t.Fatal(err)
	}
	items, err := discovery.VerifyTags(context.Background(), OCIReleaseVerificationRequest{Reference: host + "/team/app", PlatformOS: "linux", PlatformArch: "amd64", Tags: page.Tags})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("releases = %#v", items)
	}
	byTag := map[string]OCIRelease{items[0].Tag: items[0], items[1].Tag: items[1]}
	if bad := byTag["bad"]; bad.Compatible || bad.ReasonCode != "RELEASE_IDENTITY_UNVERIFIABLE" {
		t.Fatalf("unverifiable tag = %#v", bad)
	}
	if !byTag["good"].Compatible {
		t.Fatalf("valid tag was lost: %#v", byTag["good"])
	}
}

func TestOCIReleaseDiscoveryListsWithoutResolvingManifests(t *testing.T) {
	manifestRequests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.Contains(request.URL.Path, "/manifests/") {
			manifestRequests++
			t.Fatalf("tag listing resolved a manifest: %s", request.URL)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"tags": []string{"3.0.0", "2.0.0"}})
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	page, err := (OCIReleaseDiscovery{Client: server.Client()}).ListTagsPage(context.Background(), OCIReleaseTagPageRequest{Reference: host + "/team/app"})
	if err != nil || len(page.Tags) != 2 || manifestRequests != 0 {
		t.Fatalf("tag page = %#v, manifest requests = %d, error = %v", page, manifestRequests, err)
	}
}

func TestOCIReleaseDiscoveryPreservesVerifiedSiblingsOnSourceFailure(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v2/team/app/manifests/good":
			response.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			_ = json.NewEncoder(response).Encode(map[string]any{"schemaVersion": 2, "manifests": []map[string]any{{"digest": testAMD64Digest, "platform": map[string]string{"os": "linux", "architecture": "amd64"}}}})
		case "/v2/team/app/manifests/limited":
			response.WriteHeader(http.StatusTooManyRequests)
		default:
			t.Fatalf("unexpected request %s", request.URL)
		}
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	items, err := (OCIReleaseDiscovery{Client: server.Client()}).VerifyTags(context.Background(), OCIReleaseVerificationRequest{
		Reference: host + "/team/app", PlatformOS: "linux", PlatformArch: "amd64", Tags: []string{"good", "limited"},
	})
	if !errors.Is(err, ErrImageRateLimited) || len(items) != 1 || items[0].Tag != "good" || !items[0].Compatible {
		t.Fatalf("partial verification = %#v, error = %v", items, err)
	}
}

func TestRegistryNextLinkRejectsCrossRegistryPagination(t *testing.T) {
	requestURL := mustParseURLForTest(t, "https://registry.example/v2/team/app/tags/list")
	for _, link := range []string{
		`<https://attacker.example/v2/team/app/tags/list?last=one&n=100>; rel="next"`,
		`<https://registry.example/v2/team/app/tags/list-extra?last=one&n=100>; rel="next"`,
		`<https://user:secret@registry.example/v2/team/app/tags/list?last=one&n=100>; rel="next"`,
		`<https://registry.example/v2/team/app/tags/list?last=one&n=101>; rel="next"`,
	} {
		if got := registryNextLink(requestURL, link, "registry.example"); got != "" {
			t.Fatalf("accepted unsafe pagination URL %q from %q", got, link)
		}
	}
}

func TestParseRegistryReferenceRejectsURLAndRepositoryInjection(t *testing.T) {
	for _, value := range []string{
		"https://registry.example/team/app",
		"registry.example/team/../admin:latest",
		"registry.example/team/app?scope=admin",
		"registry.example/team/app@sha256:not-a-digest",
		"registry.example/team/app:bad/tag",
	} {
		if _, err := parseRegistryReference(value); err == nil {
			t.Errorf("accepted invalid reference %q", value)
		}
	}
}

func TestRegistryContentDigestRejectsMismatchedHeader(t *testing.T) {
	if _, err := registryContentDigest("sha256:"+strings.Repeat("a", 64), []byte("different")); err == nil {
		t.Fatal("accepted a Registry content digest that does not match the manifest bytes")
	}
}

func TestOCIReleaseDiscoveryPreservesRateLimitAndCancellation(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusTooManyRequests)
	}))
	t.Cleanup(server.Close)
	host := strings.TrimPrefix(server.URL, "https://")
	discovery := OCIReleaseDiscovery{Client: server.Client()}
	if _, err := discovery.ListTagsPage(context.Background(), OCIReleaseTagPageRequest{Reference: host + "/team/app"}); !errors.Is(err, ErrImageRateLimited) {
		t.Fatalf("rate limit error = %v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := discovery.ListTagsPage(cancelled, OCIReleaseTagPageRequest{Reference: host + "/team/app"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func mustParseURLForTest(t *testing.T, value string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
