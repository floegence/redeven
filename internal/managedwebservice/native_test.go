package managedwebservice

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestNativeCommandUsesOnlySupportedWebFlags(t *testing.T) {
	t.Parallel()
	service := &pfregistry.ManagedService{RuntimePort: 43123}
	want := []string{"web", "--host", "127.0.0.1", "--port", "43123", "--no-open"}
	if got := nativeCommandArgs(service); !reflect.DeepEqual(got, want) {
		t.Fatalf("native command args = %v, want %v", got, want)
	}
}

func TestDownloadNativeArchiveReportsAuditedTransferProgress(t *testing.T) {
	t.Parallel()
	payload := bytes.Repeat([]byte("audited-native-package"), 4096)
	digest := sha256.Sum256(payload)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	artifact := nativeArtifact{
		DownloadURL: server.URL + "/releases/node%20runtime.tar.gz?token=must-not-leak",
		SHA256:      hex.EncodeToString(digest[:]),
		SizeBytes:   int64(len(payload)),
	}
	type progressEvent struct {
		stage    string
		current  int64
		transfer pfregistry.ManagedOperationTransferProgress
	}
	events := make([]progressEvent, 0, 2)
	progress := func(stage string, current int64, transfers ...pfregistry.ManagedOperationTransferProgress) {
		if len(transfers) != 1 {
			t.Fatalf("progress transfer count = %d, want 1", len(transfers))
		}
		events = append(events, progressEvent{stage: stage, current: current, transfer: transfers[0]})
	}
	destination := filepath.Join(t.TempDir(), "package.tar.gz")
	if err := downloadNativeArchive(context.Background(), server.Client(), artifact, destination, progress); err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 {
		t.Fatalf("progress event count = %d, want at least 2", len(events))
	}
	first, last := events[0], events[len(events)-1]
	wantReference := "node runtime.tar.gz@sha256:" + artifact.SHA256
	if first.stage != "downloading" || first.current != 2 || first.transfer.ArtifactReference != wantReference || first.transfer.ArtifactIndex != 1 || first.transfer.ArtifactTotal != 1 || first.transfer.DownloadedBytes != 0 || first.transfer.TotalBytes != artifact.SizeBytes {
		t.Fatalf("initial progress = %+v", first)
	}
	if strings.Contains(first.transfer.ArtifactReference, "token") || last.transfer.DownloadedBytes != artifact.SizeBytes || last.transfer.TotalBytes != artifact.SizeBytes {
		t.Fatalf("final progress = %+v", last)
	}
	written, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(written, payload) {
		t.Fatal("downloaded package content differs from source")
	}
}

func TestExtractManagedArchiveAcceptsFilesAndRejectsEscapes(t *testing.T) {
	t.Parallel()
	safeArchive := writeNativeTestArchive(t, []nativeTestArchiveEntry{{name: "bin/dsh", body: "launcher", mode: 0o755}})
	destination := filepath.Join(t.TempDir(), "safe")
	if err := extractManagedArchive(safeArchive, destination); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(destination, "bin", "dsh"))
	if err != nil || info.Mode()&0o111 == 0 {
		t.Fatalf("extracted launcher info = %+v, err=%v", info, err)
	}

	unsafeArchive := writeNativeTestArchive(t, []nativeTestArchiveEntry{{name: "../escape", body: "forbidden", mode: 0o644}})
	if err := extractManagedArchive(unsafeArchive, filepath.Join(t.TempDir(), "unsafe")); err == nil || !strings.Contains(err.Error(), "escapes destination") {
		t.Fatalf("unsafe archive error = %v", err)
	}

	symlinkArchive := writeNativeTestArchive(t, []nativeTestArchiveEntry{{name: "bin/npm", typeflag: tar.TypeSymlink, linkname: "../lib/npm.js"}})
	if err := extractManagedArchive(symlinkArchive, filepath.Join(t.TempDir(), "strict-links")); err == nil || !strings.Contains(err.Error(), "symbolic links") {
		t.Fatalf("custom package symlink error = %v", err)
	}
	nodeDestination := filepath.Join(t.TempDir(), "node-links")
	if err := extractNodeRuntimeArchive(symlinkArchive, nodeDestination); err != nil {
		t.Fatalf("skip audited Node.js tool symlink: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(nodeDestination, "bin", "npm")); !os.IsNotExist(err) {
		t.Fatalf("ignored Node.js tool symlink exists: %v", err)
	}
}

func TestNativeInstallBuildsPrivateReleaseLockedRuntime(t *testing.T) {
	t.Parallel()
	archivePath := writeNativeTestArchive(t, []nativeTestArchiveEntry{
		{name: "node-test/bin/node", body: "node", mode: 0o755},
		{name: "node-test/lib/node_modules/npm/bin/npm-cli.js", body: "npm", mode: 0o644},
	})
	archive, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(archive)
	}))
	defer server.Close()
	digest := sha256.Sum256(archive)
	artifact := nativeArtifact{
		DownloadURL: server.URL + "/node.tar.gz", SHA256: hex.EncodeToString(digest[:]), SizeBytes: int64(len(archive)),
		ArchiveRoot: "node-test", NodeRelPath: "node-test/bin/node", NPMCLIRelPath: "node-test/lib/node_modules/npm/bin/npm-cli.js", ExecutableRelPath: "bin/dsh",
	}
	installCalls := 0
	driver := &nativeDriver{
		stateDir: t.TempDir(), client: server.Client(), packageOrigin: server.URL,
		packageInstaller: func(_ context.Context, _, _, appRoot, _ string) error {
			installCalls++
			entry := filepath.Join(appRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
			if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
				return err
			}
			return os.WriteFile(entry, []byte("dsh"), 0o600)
		},
	}
	service := &pfregistry.ManagedService{ServiceID: "mws_native_install"}
	catalog := catalogPayload{Platforms: map[string]nativeArtifact{currentPlatformKey(): artifact}}
	_, executable, err := driver.Install(context.Background(), service, catalog, discardOperationProgress)
	if err != nil {
		t.Fatal(err)
	}
	installRoot := filepath.Dir(filepath.Dir(executable))
	if installCalls != 1 || !regularExecutable(executable) {
		t.Fatalf("native install calls=%d executable=%q", installCalls, executable)
	}
	if err := verifyInstalledNativeRuntime(installRoot, artifact); err != nil {
		t.Fatalf("verify installed runtime: %v", err)
	}
	_, replayed, err := driver.Install(context.Background(), service, catalog, discardOperationProgress)
	if err != nil || replayed != executable || installCalls != 1 {
		t.Fatalf("idempotent native install executable=%q calls=%d err=%v", replayed, installCalls, err)
	}
}

type nativeTestArchiveEntry struct {
	name     string
	body     string
	mode     int64
	typeflag byte
	linkname string
}

func writeNativeTestArchive(t *testing.T, entries []nativeTestArchiveEntry) string {
	t.Helper()
	var raw bytes.Buffer
	gz := gzip.NewWriter(&raw)
	tw := tar.NewWriter(gz)
	for _, entry := range entries {
		typeflag := entry.typeflag
		if typeflag == 0 {
			typeflag = tar.TypeReg
		}
		size := int64(len(entry.body))
		if typeflag != tar.TypeReg {
			size = 0
		}
		if err := tw.WriteHeader(&tar.Header{Name: entry.name, Mode: entry.mode, Size: size, Typeflag: typeflag, Linkname: entry.linkname}); err != nil {
			t.Fatal(err)
		}
		if size > 0 {
			if _, err := tw.Write([]byte(entry.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "package.tar.gz")
	if err := os.WriteFile(path, raw.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
