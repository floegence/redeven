package fs

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/flowersec/flowersec-go/framing/jsonframe"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/session"
)

func mustEvalPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", path, err)
	}
	return filepath.Clean(resolved)
}

func writeTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
}

func mustSymlink(t *testing.T, target string, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("Symlink(%q, %q): %v", target, link, err)
	}
}

func entryByName(t *testing.T, entries []fsFileInfo, name string) fsFileInfo {
	t.Helper()
	for _, entry := range entries {
		if entry.Name == name {
			return entry
		}
	}
	t.Fatalf("entry %q not found", name)
	return fsFileInfo{}
}

func callReadFileStream(t *testing.T, svc *Service, path string) (fsReadFileStreamRespMeta, []byte) {
	t.Helper()

	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go svc.ServeReadFileStream(ctx, serverConn, &session.Meta{CanRead: true})

	if err := jsonframe.WriteJSONFrame(clientConn, fsReadFileStreamMeta{Path: path}); err != nil {
		t.Fatalf("WriteJSONFrame(request): %v", err)
	}

	respBytes, err := jsonframe.ReadJSONFrame(clientConn, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		t.Fatalf("ReadJSONFrame(response): %v", err)
	}

	var resp fsReadFileStreamRespMeta
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		t.Fatalf("json.Unmarshal(response): %v", err)
	}

	if !resp.Ok || resp.ContentLen <= 0 {
		return resp, nil
	}

	body, err := io.ReadAll(io.LimitReader(clientConn, resp.ContentLen))
	if err != nil {
		t.Fatalf("ReadAll(body): %v", err)
	}
	return resp, body
}

func TestServiceResolve(t *testing.T) {
	root := t.TempDir()
	s := NewService(root)

	// Empty -> agent home
	p, err := s.resolveExistingDir("")
	if err != nil {
		t.Fatalf("resolve(empty) error: %v", err)
	}
	if mustEvalPath(t, p) != mustEvalPath(t, root) {
		t.Fatalf("resolve(empty) = %q, want %q", p, root)
	}

	child := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	// Existing absolute path inside scope
	p, err = s.resolveExistingDir(child)
	if err != nil {
		t.Fatalf("resolve(existing dir) error: %v", err)
	}
	if mustEvalPath(t, p) != mustEvalPath(t, child) {
		t.Fatalf("resolve(existing dir) = %q, want %q", p, child)
	}

	if _, err := s.resolveExistingDir("/../../.."); err == nil {
		t.Fatalf("expected out-of-scope path to fail")
	}
}

func TestServiceMkdirTarget(t *testing.T) {
	root := t.TempDir()
	s := NewService(root)

	t.Run("creates directory under existing parent", func(t *testing.T) {
		target := filepath.Join(root, "docs")
		created, err := s.mkdirTarget(target, false)
		if err != nil {
			t.Fatalf("mkdirTarget(existing parent): %v", err)
		}
		if mustEvalPath(t, created) != mustEvalPath(t, target) {
			t.Fatalf("mkdirTarget(existing parent) = %q, want %q", created, target)
		}
		info, err := os.Stat(target)
		if err != nil {
			t.Fatalf("Stat(%q): %v", target, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q should be a directory", target)
		}
	})

	t.Run("rejects out of scope target", func(t *testing.T) {
		_, err := s.mkdirTarget("/../../outside", false)
		rpcErr, ok := err.(*rpc.Error)
		if !ok || rpcErr.Code != 400 {
			t.Fatalf("expected rpc 400 error, got %#v", err)
		}
	})

	t.Run("rejects existing directory", func(t *testing.T) {
		existing := filepath.Join(root, "existing")
		if err := os.MkdirAll(existing, 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", existing, err)
		}
		_, err := s.mkdirTarget(existing, false)
		rpcErr, ok := err.(*rpc.Error)
		if !ok || rpcErr.Code != 409 {
			t.Fatalf("expected rpc 409 error, got %#v", err)
		}
	})

	t.Run("creates parents when requested", func(t *testing.T) {
		target := filepath.Join(root, "nested", "dir")
		created, err := s.mkdirTarget(target, true)
		if err != nil {
			t.Fatalf("mkdirTarget(create parents): %v", err)
		}
		if mustEvalPath(t, created) != mustEvalPath(t, target) {
			t.Fatalf("mkdirTarget(create parents) = %q, want %q", created, target)
		}
		info, err := os.Stat(target)
		if err != nil {
			t.Fatalf("Stat(%q): %v", target, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q should be a directory", target)
		}
	})
}

func TestServiceListDirectoryEntriesClassifiesSymlinks(t *testing.T) {
	root := t.TempDir()
	svc := NewService(root)

	plainFile := filepath.Join(root, "plain.txt")
	plainDir := filepath.Join(root, "certs-target")
	writeTestFile(t, plainFile, "hello")
	if err := os.MkdirAll(plainDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", plainDir, err)
	}

	fileLink := filepath.Join(root, "plain-link")
	dirLink := filepath.Join(root, "certs")
	brokenLink := filepath.Join(root, "broken-link")
	mustSymlink(t, plainFile, fileLink)
	mustSymlink(t, plainDir, dirLink)
	mustSymlink(t, filepath.Join(root, "missing-target"), brokenLink)

	entries, err := svc.listDirectoryEntries(root, false)
	if err != nil {
		t.Fatalf("listDirectoryEntries() error = %v", err)
	}

	plainFileEntry := entryByName(t, entries, "plain.txt")
	if plainFileEntry.Path != plainFile {
		t.Fatalf("plain file path = %q, want %q", plainFileEntry.Path, plainFile)
	}
	if plainFileEntry.EntryType != string(fsEntryTypeFile) || plainFileEntry.ResolvedType != string(fsResolvedTypeFile) || plainFileEntry.IsDirectory {
		t.Fatalf("plain file classification = %#v", plainFileEntry)
	}

	plainDirEntry := entryByName(t, entries, "certs-target")
	if plainDirEntry.EntryType != string(fsEntryTypeFolder) || plainDirEntry.ResolvedType != string(fsResolvedTypeFolder) || !plainDirEntry.IsDirectory {
		t.Fatalf("plain directory classification = %#v", plainDirEntry)
	}

	fileLinkEntry := entryByName(t, entries, "plain-link")
	if fileLinkEntry.Path != fileLink {
		t.Fatalf("file link path = %q, want %q", fileLinkEntry.Path, fileLink)
	}
	if fileLinkEntry.EntryType != string(fsEntryTypeSymlink) || fileLinkEntry.ResolvedType != string(fsResolvedTypeFile) || fileLinkEntry.IsDirectory {
		t.Fatalf("file symlink classification = %#v", fileLinkEntry)
	}
	if fileLinkEntry.Size != int64(len("hello")) {
		t.Fatalf("file symlink size = %d, want %d", fileLinkEntry.Size, len("hello"))
	}

	dirLinkEntry := entryByName(t, entries, "certs")
	if dirLinkEntry.EntryType != string(fsEntryTypeSymlink) || dirLinkEntry.ResolvedType != string(fsResolvedTypeFolder) || !dirLinkEntry.IsDirectory {
		t.Fatalf("directory symlink classification = %#v", dirLinkEntry)
	}

	brokenLinkEntry := entryByName(t, entries, "broken-link")
	if brokenLinkEntry.EntryType != string(fsEntryTypeSymlink) || brokenLinkEntry.ResolvedType != string(fsResolvedTypeBroken) || brokenLinkEntry.IsDirectory {
		t.Fatalf("broken symlink classification = %#v", brokenLinkEntry)
	}
}

func TestServiceResolveReadableFilePathRejectsDirectoryTargets(t *testing.T) {
	root := t.TempDir()
	svc := NewService(root)

	plainFile := filepath.Join(root, "plain.txt")
	plainDir := filepath.Join(root, "folder")
	fileLink := filepath.Join(root, "plain-link")
	dirLink := filepath.Join(root, "folder-link")
	brokenLink := filepath.Join(root, "broken-link")

	writeTestFile(t, plainFile, "hello")
	if err := os.MkdirAll(plainDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", plainDir, err)
	}
	mustSymlink(t, plainFile, fileLink)
	mustSymlink(t, plainDir, dirLink)
	mustSymlink(t, filepath.Join(root, "missing-target"), brokenLink)

	resolvedFileLink, info, err := svc.resolveReadableFilePath(fileLink)
	if err != nil {
		t.Fatalf("resolveReadableFilePath(file symlink) error = %v", err)
	}
	if mustEvalPath(t, resolvedFileLink) != mustEvalPath(t, plainFile) {
		t.Fatalf("resolved file symlink path = %q, want %q", resolvedFileLink, plainFile)
	}
	if info == nil || info.IsDir() {
		t.Fatalf("resolveReadableFilePath(file symlink) info = %#v, want regular file", info)
	}

	if _, _, err := svc.resolveReadableFilePath(plainDir); !errors.Is(err, errFSPathIsDirectory) {
		t.Fatalf("resolveReadableFilePath(directory) error = %v, want %v", err, errFSPathIsDirectory)
	}
	if _, _, err := svc.resolveReadableFilePath(dirLink); !errors.Is(err, errFSPathIsDirectory) {
		t.Fatalf("resolveReadableFilePath(directory symlink) error = %v, want %v", err, errFSPathIsDirectory)
	}
	if _, _, err := svc.resolveReadableFilePath(brokenLink); !os.IsNotExist(err) {
		t.Fatalf("resolveReadableFilePath(broken symlink) error = %v, want not found", err)
	}
}

func TestServiceMutationsOperateOnSymlinkLeafs(t *testing.T) {
	root := t.TempDir()
	svc := NewService(root)

	targetFile := filepath.Join(root, "plain.txt")
	writeTestFile(t, targetFile, "hello")

	linkPath := filepath.Join(root, "plain-link")
	mustSymlink(t, targetFile, linkPath)

	copiedPath := filepath.Join(root, "plain-copy")
	newCopiedPath, err := svc.copyEntry(linkPath, copiedPath, false)
	if err != nil {
		t.Fatalf("copyEntry(file symlink) error = %v", err)
	}
	if mustEvalPath(t, newCopiedPath) != mustEvalPath(t, copiedPath) {
		t.Fatalf("copyEntry(file symlink) path = %q, want %q", newCopiedPath, copiedPath)
	}
	if info, err := os.Lstat(copiedPath); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("copied path = %#v, err = %v, want symlink", info, err)
	}
	if copiedTarget, err := os.Readlink(copiedPath); err != nil || copiedTarget != targetFile {
		t.Fatalf("Readlink(%q) = %q, err = %v, want %q", copiedPath, copiedTarget, err, targetFile)
	}

	renamedPath := filepath.Join(root, "plain-link-renamed")
	newRenamedPath, err := svc.renameEntry(linkPath, renamedPath)
	if err != nil {
		t.Fatalf("renameEntry(file symlink) error = %v", err)
	}
	if mustEvalPath(t, newRenamedPath) != mustEvalPath(t, renamedPath) {
		t.Fatalf("renameEntry(file symlink) path = %q, want %q", newRenamedPath, renamedPath)
	}
	if _, err := os.Lstat(linkPath); !os.IsNotExist(err) {
		t.Fatalf("old symlink still exists after rename: %v", err)
	}
	if info, err := os.Lstat(renamedPath); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("renamed path = %#v, err = %v, want symlink", info, err)
	}
	if _, err := os.Stat(targetFile); err != nil {
		t.Fatalf("target file missing after rename: %v", err)
	}

	if err := svc.deleteEntry(renamedPath, false); err != nil {
		t.Fatalf("deleteEntry(file symlink) error = %v", err)
	}
	if _, err := os.Lstat(renamedPath); !os.IsNotExist(err) {
		t.Fatalf("renamed symlink still exists after delete: %v", err)
	}
	if _, err := os.Stat(targetFile); err != nil {
		t.Fatalf("target file missing after delete: %v", err)
	}
}

func TestServiceCopyDirPreservesSymlinkChildren(t *testing.T) {
	root := t.TempDir()
	svc := NewService(root)

	targetFile := filepath.Join(root, "target.txt")
	writeTestFile(t, targetFile, "hello")

	sourceDir := filepath.Join(root, "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", sourceDir, err)
	}
	mustSymlink(t, targetFile, filepath.Join(sourceDir, "target-link"))

	destDir := filepath.Join(root, "copied")
	if _, err := svc.copyEntry(sourceDir, destDir, false); err != nil {
		t.Fatalf("copyEntry(directory) error = %v", err)
	}

	copiedLink := filepath.Join(destDir, "target-link")
	if info, err := os.Lstat(copiedLink); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("copied directory child = %#v, err = %v, want symlink", info, err)
	}
	if copiedTarget, err := os.Readlink(copiedLink); err != nil || copiedTarget != targetFile {
		t.Fatalf("Readlink(%q) = %q, err = %v, want %q", copiedLink, copiedTarget, err, targetFile)
	}
}

func TestServiceServeReadFileStreamRejectsDirectoryTargets(t *testing.T) {
	root := t.TempDir()
	svc := NewService(root)

	plainFile := filepath.Join(root, "plain.txt")
	plainDir := filepath.Join(root, "folder")
	fileLink := filepath.Join(root, "plain-link")
	dirLink := filepath.Join(root, "folder-link")

	writeTestFile(t, plainFile, "hello")
	if err := os.MkdirAll(plainDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q): %v", plainDir, err)
	}
	mustSymlink(t, plainFile, fileLink)
	mustSymlink(t, plainDir, dirLink)

	fileResp, body := callReadFileStream(t, svc, fileLink)
	if !fileResp.Ok {
		t.Fatalf("file symlink stream response = %#v, want ok", fileResp)
	}
	if string(body) != "hello" {
		t.Fatalf("file symlink stream body = %q, want %q", string(body), "hello")
	}

	dirResp, _ := callReadFileStream(t, svc, dirLink)
	if dirResp.Ok || dirResp.Error == nil || dirResp.Error.Code != 400 || dirResp.Error.Message != "path is a directory" {
		t.Fatalf("directory symlink stream response = %#v, want directory error", dirResp)
	}

	plainDirResp, _ := callReadFileStream(t, svc, plainDir)
	if plainDirResp.Ok || plainDirResp.Error == nil || plainDirResp.Error.Code != 400 || plainDirResp.Error.Message != "path is a directory" {
		t.Fatalf("directory stream response = %#v, want directory error", plainDirResp)
	}
}
