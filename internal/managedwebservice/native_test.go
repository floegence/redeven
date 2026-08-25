package managedwebservice

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
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
	want := []string{"web", "--host", "127.0.0.1", "--port", "43123"}
	if got := nativeCommandArgs(service); !reflect.DeepEqual(got, want) {
		t.Fatalf("native command args = %v, want %v", got, want)
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
}

type nativeTestArchiveEntry struct {
	name string
	body string
	mode int64
}

func writeNativeTestArchive(t *testing.T, entries []nativeTestArchiveEntry) string {
	t.Helper()
	var raw bytes.Buffer
	gz := gzip.NewWriter(&raw)
	tw := tar.NewWriter(gz)
	for _, entry := range entries {
		if err := tw.WriteHeader(&tar.Header{Name: entry.name, Mode: entry.mode, Size: int64(len(entry.body)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(entry.body)); err != nil {
			t.Fatal(err)
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
