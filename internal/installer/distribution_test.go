package installer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDistributionContractAndEntryPins(t *testing.T) {
	data, err := os.ReadFile("distribution_contract.json")
	if err != nil {
		t.Fatal(err)
	}
	contract, err := decodeDistribution(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range [][]byte{
		append(append([]byte{}, data...), []byte(`{}`)...),
		[]byte(strings.Replace(string(data), "redeven.runtime-suite.v1", "unreviewed.v2", 1)),
		[]byte(strings.Replace(string(data), `"linux_arm64"`, `"linux_amd64"`, 1)),
		[]byte(strings.Replace(string(data), `"schema_version":`, `"unknown": true, "schema_version":`, 1)),
	} {
		if _, err := decodeDistribution(input); err == nil {
			t.Fatal("invalid release distribution contract was accepted")
		}
	}
	inventory := map[string]string{}
	entry := "INSTALLER_VERSION='v0.13.13'\nINSTALLER_CONTRACT='redeven.installer_distribution.v1'\n"
	for index, platform := range contract.Platforms {
		digest := strings.Repeat(fmt.Sprint(index), 64)
		inventory["redeven-installer_"+platform] = digest
		entry += "SHA256_" + strings.ToUpper(platform) + "='" + digest + "'\n"
	}
	if _, err := checkBootstrapPins([]byte(entry), contract, inventory); err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		strings.Replace(entry, "v0.13.13", "v0.13.12", 1),
		strings.Replace(entry, "redeven.installer_distribution.v1", "unreviewed.v2", 1),
		entry + "INSTALLER_VERSION='v0.13.13'\n",
		strings.Replace(entry, "SHA256_LINUX_ARM64=", "MISSING_PIN=", 1),
		strings.Replace(entry, strings.Repeat("0", 64), strings.Repeat("f", 64), 1),
	} {
		if _, err := checkBootstrapPins([]byte(input), contract, inventory); err == nil {
			t.Fatal("incompatible or unauthenticated bootstrap pin was accepted")
		}
	}
	if needsDistributionContract("v0.13.12") || !needsDistributionContract("v0.13.13-rc.1") || !needsDistributionContract("v1.0.0") {
		t.Fatal("first installer release contract boundary is incorrect")
	}
}

func TestSignedChecksumInventoryFailsClosed(t *testing.T) {
	digest := strings.Repeat("a", 64)
	for _, input := range []string{"", digest + "  ../outside\n", digest + "  a\\b\n", digest + "  file\n" + digest + "  file\n", "bad  file\n", digest + "  too many fields\n", strings.ToUpper(digest) + "  file\n"} {
		if _, err := parseChecksums([]byte(input)); err == nil {
			t.Fatalf("unsafe checksum list was accepted: %q", input)
		}
	}
}

func TestMetadataFallbackAndBounds(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch r.URL.Path {
		case "/unavailable":
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
		case "/oversized":
			fmt.Fprint(w, strings.Repeat("x", 128))
		default:
			fmt.Fprint(w, "reviewed bytes")
		}
	}))
	defer server.Close()
	d := &downloader{client: server.Client()}
	data, err := d.metadata(t.Context(), []string{server.URL + "/unavailable", server.URL + "/mirror"}, 64)
	if err != nil || string(data) != "reviewed bytes" || requests.Load() != 2 {
		t.Fatal("transport failure did not use the secondary source:", err)
	}
	requests.Store(0)
	if _, err := d.metadata(t.Context(), []string{server.URL + "/oversized", server.URL + "/mirror"}, 64); err == nil || requests.Load() != 1 {
		t.Fatal("invalid successful metadata must fail closed without hiding it behind a mirror")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	request, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	if _, err := (trustHTTPClient{ctx, server.Client()}).Do(request); !errors.Is(err, context.Canceled) {
		t.Fatal("TUF HTTP adapter did not preserve cancellation:", err)
	}
	finished := make(chan error, 1)
	go func() {
		_, err := newTrustFetcher(ctx, server.Client()).DownloadFile(server.URL, 128, 0)
		finished <- err
	}()
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("TUF fetcher lost cancellation:", err)
		}
	case <-time.After(time.Second):
		t.Fatal("TUF fetcher retried a canceled operation instead of returning")
	}
}

func TestAutomaticDowngradeIsRefusedAndExplicitRollbackWorks(t *testing.T) {
	data, digest := tarFixture(t, runtimeFixture("v1.2.3"))
	download, source, requests := fixtureServer(t, data, digest)
	config, err := (Config{InstallerVersion: firstInstallerRelease, Home: t.TempDir(), Mode: "upgrade", Output: io.Discard}).normalized()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(config.InstallDir, 0755); err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(config.InstallDir, "redeven")
	old := []byte("#!/bin/sh\nprintf 'redeven v1.2.4 (old) test\\n'\n")
	if err := os.WriteFile(name, old, 0755); err != nil {
		t.Fatal(err)
	}
	deps := runDependencies{source: source, client: download,
		verify:  func(context.Context, []byte, []byte, []byte, string) error { return nil },
		prepare: func(context.Context, *downloader, Config, string, string) error { return nil },
	}
	if err := run(t.Context(), config, deps); err == nil || !strings.Contains(err.Error(), "will not downgrade") || requests.Load() != 0 {
		t.Fatal("automatic downgrade was not stopped before payload acquisition:", err)
	}
	config.Version = "v1.2.3"
	if err := run(t.Context(), config, deps); err != nil {
		t.Fatal("explicit rollback failed:", err)
	}
	version, err := executableVersion(t.Context(), name)
	if err != nil || version != "v1.2.3" {
		t.Fatal("explicit rollback did not activate the requested release", version, err)
	}
}

func TestOlderInstallerCannotActivateNewRelease(t *testing.T) {
	data, digest := tarFixture(t, runtimeFixture("v1.2.3"))
	download, source, requests := fixtureServer(t, data, digest)
	config, err := (Config{InstallerVersion: "v0.13.12", Home: t.TempDir(), Output: io.Discard}).normalized()
	if err != nil {
		t.Fatal(err)
	}
	err = run(t.Context(), config, runDependencies{source: source, client: download,
		verify: func(context.Context, []byte, []byte, []byte, string) error { return nil },
	})
	if err == nil || !strings.Contains(err.Error(), "requires installer") || requests.Load() != 0 {
		t.Fatal("obsolete installer did not stop before payload execution:", err)
	}
}
