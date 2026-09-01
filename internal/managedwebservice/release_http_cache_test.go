package managedwebservice

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestReleaseMetadataTransportCollapsesConcurrentReads(t *testing.T) {
	var requests atomic.Int32
	started := make(chan struct{})
	unblock := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) == 1 {
			close(started)
		}
		<-unblock
		response.Header().Set("ETag", `"one"`)
		_, _ = response.Write([]byte(`{"versions":{}}`))
	}))
	t.Cleanup(server.Close)

	client := &http.Client{Transport: newReleaseMetadataTransport(http.DefaultTransport)}
	var wait sync.WaitGroup
	wait.Add(2)
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			defer wait.Done()
			request, err := http.NewRequest(http.MethodGet, server.URL, nil)
			if err == nil {
				request.Header.Set("Accept", "application/json")
				var response *http.Response
				response, err = client.Do(request)
				if err == nil {
					_, err = io.ReadAll(response.Body)
					_ = response.Body.Close()
				}
			}
			errors <- err
		}()
	}
	<-started
	close(unblock)
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected one upstream request, got %d", got)
	}
}

func TestReleaseMetadataTransportUsesValidatorsOnRefresh(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch requests.Add(1) {
		case 1:
			response.Header().Set("ETag", `"one"`)
			response.Header().Set("Last-Modified", "Mon, 31 Aug 2026 00:00:00 GMT")
			_, _ = response.Write([]byte("first"))
		case 2:
			if request.Header.Get("If-None-Match") != `"one"` || request.Header.Get("If-Modified-Since") == "" {
				t.Errorf("missing conditional validators: %#v", request.Header)
			}
			response.WriteHeader(http.StatusNotModified)
		default:
			t.Fatalf("unexpected upstream request")
		}
	}))
	t.Cleanup(server.Close)
	transport := newReleaseMetadataTransport(http.DefaultTransport)
	transport.ttl = time.Hour
	client := &http.Client{Transport: transport}

	read := func(ctx context.Context) string {
		t.Helper()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Accept", "application/json")
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	if got := read(context.Background()); got != "first" {
		t.Fatalf("unexpected initial body %q", got)
	}
	if got := read(context.Background()); got != "first" || requests.Load() != 1 {
		t.Fatalf("fresh cache miss: body=%q requests=%d", got, requests.Load())
	}
	if got := read(withReleaseSourceRefresh(context.Background())); got != "first" || requests.Load() != 2 {
		t.Fatalf("conditional refresh failed: body=%q requests=%d", got, requests.Load())
	}
}

func TestReleaseMetadataTransportSeparatesCredentialsAndBypassesRequestsWithoutMetadataAccept(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		_, _ = response.Write([]byte(request.Header.Get("Authorization")))
	}))
	t.Cleanup(server.Close)
	client := &http.Client{Transport: newReleaseMetadataTransport(http.DefaultTransport)}

	read := func(accept, token string) string {
		t.Helper()
		request, _ := http.NewRequest(http.MethodGet, server.URL, nil)
		if accept != "" {
			request.Header.Set("Accept", accept)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		return string(raw)
	}
	if read("application/json", "alpha") == read("application/json", "beta") {
		t.Fatal("credential-scoped responses were mixed")
	}
	_ = read("", "token")
	_ = read("", "token")
	if got := requests.Load(); got != 4 {
		t.Fatalf("expected requests without metadata Accept to bypass cache, got %d requests", got)
	}
}

func TestReleaseMetadataRedirectPolicyRequiresHTTPSAndStripsCrossOriginCredentials(t *testing.T) {
	original := &http.Request{URL: &url.URL{Scheme: "https", Host: "registry.example"}}
	redirect := &http.Request{URL: &url.URL{Scheme: "https", Host: "objects.example"}, Header: http.Header{"Authorization": []string{"Bearer secret"}, "Cookie": []string{"session=secret"}}}
	if err := releaseMetadataRedirectPolicy(redirect, []*http.Request{original}); err != nil {
		t.Fatal(err)
	}
	if redirect.Header.Get("Authorization") != "" || redirect.Header.Get("Cookie") != "" {
		t.Fatal("cross-origin redirect retained credentials")
	}
	insecure := &http.Request{URL: &url.URL{Scheme: "http", Host: "objects.example"}, Header: http.Header{}}
	if err := releaseMetadataRedirectPolicy(insecure, []*http.Request{original}); err == nil {
		t.Fatal("accepted an insecure release source redirect")
	}
}
