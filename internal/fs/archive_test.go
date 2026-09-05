package fs

import (
	"archive/tar"
	standardzip "archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bodgit/sevenzip"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
	yekazip "github.com/yeka/zip"
)

type archiveFixtureEntry struct {
	name       string
	body       string
	typeflag   byte
	linkTarget string
}

func writeTarFixture(t *testing.T, target string, entries ...archiveFixtureEntry) {
	t.Helper()
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(file)
	for _, entry := range entries {
		mode := int64(0o644)
		if entry.typeflag == tar.TypeDir {
			mode = 0o755
		}
		header := &tar.Header{
			Name:     entry.name,
			Mode:     mode,
			Size:     int64(len(entry.body)),
			Typeflag: entry.typeflag,
			Linkname: entry.linkTarget,
		}
		if entry.typeflag == tar.TypeDir || entry.typeflag == tar.TypeSymlink || entry.typeflag == tar.TypeLink {
			header.Size = 0
		}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if entry.body != "" {
			if _, err := io.WriteString(tw, entry.body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeZipFixture(t *testing.T, target string, entries map[string]string) {
	t.Helper()
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	zw := standardzip.NewWriter(file)
	for name, body := range entries {
		writer, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(writer, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeEncryptedZipFixture(t *testing.T, target string, password string) {
	t.Helper()
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	zw := yekazip.NewWriter(file)
	writer, err := zw.Encrypt("secret.txt", password, yekazip.AES256Encryption)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(writer, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func newArchiveTestService(t *testing.T, root string, coordinator gitruntime.FilesystemMutationCoordinator) *Service {
	t.Helper()
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	return NewServiceWithCoordinator(scope, coordinator)
}

func TestExtractArchivePreservesTreeAndSafeLinks(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "bundle.tar")
	writeTarFixture(t, source,
		archiveFixtureEntry{name: "project/", typeflag: tar.TypeDir},
		archiveFixtureEntry{name: "project/readme.txt", body: "hello", typeflag: tar.TypeReg},
		archiveFixtureEntry{name: "project/readme-hard.txt", typeflag: tar.TypeLink, linkTarget: "project/readme.txt"},
		archiveFixtureEntry{name: "project/readme-link.txt", typeflag: tar.TypeSymlink, linkTarget: "readme.txt"},
	)

	svc := newArchiveTestService(t, root, gitruntime.New())
	result, err := svc.extractArchive(context.Background(), source, root, "bundle", "")
	if err != nil {
		t.Fatalf("extractArchive() error = %v", err)
	}
	if mustEvalPath(t, result.DestinationPath) != mustEvalPath(t, filepath.Join(root, "bundle")) || result.ResultKind != archiveResultDirectory || result.ArchiveFormat != "tar" {
		t.Fatalf("extractArchive() = %#v", result)
	}
	assertFileContent(t, filepath.Join(result.DestinationPath, "project", "readme.txt"), "hello")
	assertFileContent(t, filepath.Join(result.DestinationPath, "project", "readme-hard.txt"), "hello")
	if target, err := os.Readlink(filepath.Join(result.DestinationPath, "project", "readme-link.txt")); err != nil || target != "readme.txt" {
		t.Fatalf("Readlink() = %q, %v", target, err)
	}
}

func TestExtractArchiveUsesHeaderAndChoosesUnusedDestination(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "misleading.txt")
	writeZipFixture(t, source, map[string]string{"hello.txt": "hello"})
	if err := os.Mkdir(filepath.Join(root, "bundle"), 0o755); err != nil {
		t.Fatal(err)
	}

	svc := newArchiveTestService(t, root, gitruntime.New())
	result, err := svc.extractArchive(context.Background(), source, root, "bundle", "")
	if err != nil {
		t.Fatalf("extractArchive() error = %v", err)
	}
	if mustEvalPath(t, result.DestinationPath) != mustEvalPath(t, filepath.Join(root, "bundle (2)")) || result.ArchiveFormat != "zip" {
		t.Fatalf("extractArchive() = %#v", result)
	}
	assertFileContent(t, filepath.Join(result.DestinationPath, "hello.txt"), "hello")
}

func TestExtractArchiveDecompressesSingleFile(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "notes.gz")
	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	if _, err := io.WriteString(zw, "notes"); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, compressed.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	svc := newArchiveTestService(t, root, gitruntime.New())
	result, err := svc.extractArchive(context.Background(), source, root, "notes", "")
	if err != nil {
		t.Fatalf("extractArchive() error = %v", err)
	}
	if result.ResultKind != archiveResultFile || result.ArchiveFormat != "gz" || mustEvalPath(t, result.DestinationPath) != mustEvalPath(t, filepath.Join(root, "notes")) {
		t.Fatalf("extractArchive() = %#v", result)
	}
	assertFileContent(t, result.DestinationPath, "notes")
}

func TestExtractEncryptedZipRequiresCorrectPassword(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "secret.zip")
	writeEncryptedZipFixture(t, source, "correct horse")
	svc := newArchiveTestService(t, root, gitruntime.New())

	if _, err := svc.extractArchive(context.Background(), source, root, "missing-password", ""); !errors.Is(err, errArchivePasswordRequired) {
		t.Fatalf("missing password error = %v", err)
	}
	if _, err := svc.extractArchive(context.Background(), source, root, "wrong-password", "wrong"); !errors.Is(err, errArchiveWrongPassword) {
		t.Fatalf("wrong password error = %v", err)
	}
	result, err := svc.extractArchive(context.Background(), source, root, "decrypted", "correct horse")
	if err != nil {
		t.Fatalf("correct password error = %v", err)
	}
	assertFileContent(t, filepath.Join(result.DestinationPath, "secret.txt"), "secret")
	for _, name := range []string{"missing-password", "wrong-password"} {
		assertPathMissing(t, filepath.Join(root, name))
	}
}

func TestEncryptedZipCancellationIsNotReportedAsWrongPassword(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "secret.zip")
	writeEncryptedZipFixture(t, sourcePath, "correct horse")
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err = extractZipArchive(ctx, source, "correct horse", &archiveTreeWriter{
		ctx:   ctx,
		root:  filepath.Join(root, "staging"),
		nodes: make(map[string]archiveNode),
	})
	if !errors.Is(err, context.Canceled) || errors.Is(err, errArchiveWrongPassword) {
		t.Fatalf("extractZipArchive() error = %v, want cancellation", err)
	}
}

func TestExtractArchiveRejectsMultipartNameAndCorruptContent(t *testing.T) {
	t.Run("multipart", func(t *testing.T) {
		root := t.TempDir()
		source := filepath.Join(root, "bundle.zip.001")
		writeZipFixture(t, source, map[string]string{"hello.txt": "hello"})
		svc := newArchiveTestService(t, root, gitruntime.New())
		if _, err := svc.extractArchive(context.Background(), source, root, "output", ""); !errors.Is(err, errArchiveMultipart) {
			t.Fatalf("extractArchive() error = %v, want multipart", err)
		}
		assertPathMissing(t, filepath.Join(root, "output"))
	})

	t.Run("corrupt", func(t *testing.T) {
		root := t.TempDir()
		source := filepath.Join(root, "broken.zip")
		if err := os.WriteFile(source, []byte("PK\x03\x04broken"), 0o644); err != nil {
			t.Fatal(err)
		}
		svc := newArchiveTestService(t, root, gitruntime.New())
		if _, err := svc.extractArchive(context.Background(), source, root, "output", ""); !errors.Is(err, errArchiveCorrupt) {
			t.Fatalf("extractArchive() error = %v, want corrupt archive", err)
		}
		assertPathMissing(t, filepath.Join(root, "output"))
	})
}

func TestArchiveDestinationNameRejectsPortableVolumePrefix(t *testing.T) {
	for _, name := range []string{"C:bundle", "D:notes"} {
		if err := validateArchiveDestinationName(name); err == nil {
			t.Fatalf("validateArchiveDestinationName(%q) succeeded", name)
		}
	}
}

func TestArchiveExtractionRPCErrorCodes(t *testing.T) {
	tests := []struct {
		err  error
		code uint32
	}{
		{errArchiveUnsupportedFormat, 42211},
		{errArchiveMultipart, 42212},
		{errArchivePasswordRequired, 42213},
		{errArchiveWrongPassword, 42214},
		{errArchiveUnsafeEntry, 42215},
		{errArchiveUnsupportedEntry, 42216},
		{errArchiveCorrupt, 42217},
		{errArchiveResourceLimit, 50311},
		{errArchiveNoSpace, 50711},
		{errArchiveCleanup, 50011},
		{context.Canceled, 499},
	}
	for _, test := range tests {
		if got := archiveExtractionRPCError(test.err); got.Code != test.code {
			t.Fatalf("archiveExtractionRPCError(%v).Code = %d, want %d", test.err, got.Code, test.code)
		}
	}
}

func TestClassifyArchiveLibraryErrorMapsEncryptedSevenZip(t *testing.T) {
	encryptedReadError := &sevenzip.ReadError{Encrypted: true, Err: errors.New("encrypted data")}
	if err := classifyArchiveLibraryError(encryptedReadError, false, false); !errors.Is(err, errArchivePasswordRequired) {
		t.Fatalf("without password error = %v", err)
	}
	if err := classifyArchiveLibraryError(encryptedReadError, true, false); !errors.Is(err, errArchiveWrongPassword) {
		t.Fatalf("with password error = %v", err)
	}
}

func TestExtractArchiveRejectsUnsafeEntriesAndCleansStaging(t *testing.T) {
	tests := []struct {
		name    string
		entries []archiveFixtureEntry
	}{
		{name: "parent traversal", entries: []archiveFixtureEntry{{name: "../outside.txt", body: "bad", typeflag: tar.TypeReg}}},
		{name: "absolute path", entries: []archiveFixtureEntry{{name: "/outside.txt", body: "bad", typeflag: tar.TypeReg}}},
		{name: "escaping symlink", entries: []archiveFixtureEntry{{name: "link", typeflag: tar.TypeSymlink, linkTarget: "../outside.txt"}}},
		{name: "link cycle", entries: []archiveFixtureEntry{{name: "a", typeflag: tar.TypeSymlink, linkTarget: "b"}, {name: "b", typeflag: tar.TypeSymlink, linkTarget: "a"}}},
		{name: "windows absolute path", entries: []archiveFixtureEntry{{name: `C:\outside.txt`, body: "bad", typeflag: tar.TypeReg}}},
		{name: "duplicate path", entries: []archiveFixtureEntry{{name: "same", body: "one", typeflag: tar.TypeReg}, {name: "same", body: "two", typeflag: tar.TypeReg}}},
		{name: "special entry", entries: []archiveFixtureEntry{{name: "pipe", typeflag: tar.TypeFifo}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			source := filepath.Join(root, "unsafe.tar")
			writeTarFixture(t, source, test.entries...)
			svc := newArchiveTestService(t, root, gitruntime.New())
			_, err := svc.extractArchive(context.Background(), source, root, "output", "")
			if !errors.Is(err, errArchiveUnsafeEntry) && !errors.Is(err, errArchiveUnsupportedEntry) {
				t.Fatalf("extractArchive() error = %v", err)
			}
			assertPathMissing(t, filepath.Join(root, "output"))
			matches, globErr := filepath.Glob(filepath.Join(root, archiveStagingPrefix+"*"))
			if globErr != nil || len(matches) != 0 {
				t.Fatalf("staging paths = %v, error = %v", matches, globErr)
			}
		})
	}
}

func TestExtractArchiveCancellationCleansStaging(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "bundle.tar")
	writeTarFixture(t, source, archiveFixtureEntry{name: "file.txt", body: strings.Repeat("x", 1024), typeflag: tar.TypeReg})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	svc := newArchiveTestService(t, root, gitruntime.New())
	_, err := svc.extractArchive(ctx, source, root, "output", "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("extractArchive() error = %v, want canceled", err)
	}
	assertPathMissing(t, filepath.Join(root, "output"))
}

func TestExtractArchiveRPCRequiresReadAndWriteAndUsesCoordinator(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "bundle.zip")
	writeZipFixture(t, source, map[string]string{"hello.txt": "hello"})
	coordinator := &recordingMutationCoordinator{}
	svc := newArchiveTestService(t, root, coordinator)
	request := fsExtractReq{SourcePath: source, DestinationParentPath: root, DestinationName: "bundle"}

	for _, meta := range []*session.Meta{{CanRead: false, CanWrite: true}, {CanRead: true, CanWrite: false}} {
		router := sessionrpc.NewRouter()
		svc.Register(router, meta)
		payload, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		var response json.RawMessage
		callErr := router.Call(context.Background(), TypeID_FS_EXTRACT, json.RawMessage(payload), &response)
		var rpcErr *sessionrpc.Error
		if !errors.As(callErr, &rpcErr) || rpcErr.Code != 403 {
			t.Fatalf("RPC error = %#v, want 403", callErr)
		}
	}

	router := sessionrpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true, CanWrite: true})
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var response fsExtractResp
	if err := router.Call(context.Background(), TypeID_FS_EXTRACT, json.RawMessage(payload), &response); err != nil {
		t.Fatal(err)
	}
	if coordinator.calls != 1 || len(coordinator.effect.Paths) != 2 || response.ArchiveFormat != "zip" {
		t.Fatalf("coordinator = %#v, response = %#v", coordinator, response)
	}
}
