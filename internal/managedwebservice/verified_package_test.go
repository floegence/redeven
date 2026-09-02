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
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestDownloadVerifiedPackageArchiveReportsAuditedTransferProgress(t *testing.T) {
	t.Parallel()
	payload := bytes.Repeat([]byte("audited-software-package"), 4096)
	digest := sha256.Sum256(payload)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	artifact := verifiedPackageArtifact{
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
	if err := downloadVerifiedPackageArchive(context.Background(), server.Client(), artifact, destination, progress); err != nil {
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
	safeArchive := writeVerifiedPackageTestArchive(t, []verifiedPackageTestArchiveEntry{{name: "bin/service", body: "launcher", mode: 0o755}})
	destination := filepath.Join(t.TempDir(), "safe")
	if err := extractManagedArchive(safeArchive, destination); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(destination, "bin", "service"))
	if err != nil || info.Mode()&0o111 == 0 {
		t.Fatalf("extracted launcher info = %+v, err=%v", info, err)
	}

	unsafeArchive := writeVerifiedPackageTestArchive(t, []verifiedPackageTestArchiveEntry{{name: "../escape", body: "forbidden", mode: 0o644}})
	if err := extractManagedArchive(unsafeArchive, filepath.Join(t.TempDir(), "unsafe")); err == nil || !strings.Contains(err.Error(), "escapes destination") {
		t.Fatalf("unsafe archive error = %v", err)
	}

	symlinkArchive := writeVerifiedPackageTestArchive(t, []verifiedPackageTestArchiveEntry{{name: "bin/npm", typeflag: tar.TypeSymlink, linkname: "../lib/npm.js"}})
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

type verifiedPackageTestArchiveEntry struct {
	name     string
	body     string
	mode     int64
	typeflag byte
	linkname string
}

func writeVerifiedPackageTestArchive(t *testing.T, entries []verifiedPackageTestArchiveEntry) string {
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
