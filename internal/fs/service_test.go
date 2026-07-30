package fs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/flowersec/flowersec-go/framing/jsonframe"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/gitruntime"
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

func TestListDirectoryRPCErrorClassification(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantCode    uint32
		wantMessage string
	}{
		{name: "outside scope", err: filesystemscope.ErrPathOutsideScope, wantCode: 403, wantMessage: fsErrorPathOutsideScope},
		{name: "root read denied", err: filesystemscope.ErrReadDenied, wantCode: 403, wantMessage: fsErrorReadPermissionDenied},
		{name: "host permission denied", err: fmt.Errorf("read directory: %w", os.ErrPermission), wantCode: 403, wantMessage: fsErrorHostFilesystemDenied},
		{name: "not found", err: fmt.Errorf("resolve directory: %w", os.ErrNotExist), wantCode: 404, wantMessage: fsErrorNotFound},
		{name: "not directory", err: filesystemscope.ErrPathNotDirectory, wantCode: 400, wantMessage: fsErrorPathNotDirectory},
		{name: "invalid path", err: errors.New("malformed path"), wantCode: 400, wantMessage: fsErrorInvalidPath},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := listDirectoryRPCError(test.err)
			if got.Code != test.wantCode || got.Message != test.wantMessage {
				t.Fatalf("listDirectoryRPCError(%v) = %#v, want code %d message %q", test.err, got, test.wantCode, test.wantMessage)
			}
		})
	}
}

type recordingMutationCoordinator struct {
	ctx    context.Context
	effect gitruntime.FilesystemEffect
	calls  int
	before func(gitruntime.FilesystemEffect) error
}

type mutationContextKey struct{}

func (c *recordingMutationCoordinator) CoordinateFilesystemMutation(ctx context.Context, effect gitruntime.FilesystemEffect, fn func() error) error {
	c.ctx = ctx
	c.effect = effect
	c.calls++
	if c.before != nil {
		if err := c.before(effect); err != nil {
			return err
		}
	}
	return fn()
}

func TestCoordinateMutationUsesRPCContextAndEffect(t *testing.T) {
	coordinator := &recordingMutationCoordinator{}
	scope, err := filesystemscope.NewDefaultRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewServiceWithCoordinator(scope, coordinator)
	ctx := context.WithValue(context.Background(), mutationContextKey{}, "request")
	target := filepath.Join(t.TempDir(), "file.txt")
	called := false
	if err := svc.coordinateMutation(ctx, gitruntime.FilesystemEffect{Paths: []string{target}}, func() error {
		called = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !called || coordinator.calls != 1 || coordinator.ctx != ctx || len(coordinator.effect.Paths) != 1 || coordinator.effect.Paths[0] != target {
		t.Fatalf("coordination = %#v, called=%v", coordinator, called)
	}
}

func TestMutationRPCsFailClosedWithoutCoordinator(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.txt")
	writeTestFile(t, source, "source")
	svc := NewService(root)
	router := rpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true, CanWrite: true})

	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := rpc.NewServer(serverConn, router)
	go func() { _ = server.Serve(ctx) }()
	client := rpc.NewClient(clientConn)

	requests := []struct {
		name    string
		typeID  uint32
		request any
	}{
		{name: "write", typeID: TypeID_FS_WRITE, request: fsWriteFileReq{Path: filepath.Join(root, "write.txt"), Content: "write"}},
		{name: "mkdir", typeID: TypeID_FS_MKDIR, request: fsMkdirReq{Path: filepath.Join(root, "directory")}},
		{name: "delete", typeID: TypeID_FS_DELETE, request: fsDeleteReq{Path: source}},
		{name: "rename", typeID: TypeID_FS_RENAME, request: fsRenameReq{OldPath: source, NewPath: filepath.Join(root, "renamed.txt")}},
		{name: "copy", typeID: TypeID_FS_COPY, request: fsCopyReq{SourcePath: source, DestPath: filepath.Join(root, "copied.txt")}},
	}
	for _, test := range requests {
		t.Run(test.name, func(t *testing.T) {
			payload, err := json.Marshal(test.request)
			if err != nil {
				t.Fatal(err)
			}
			_, rpcErr, callErr := client.Call(ctx, test.typeID, payload)
			if callErr != nil {
				t.Fatalf("Call error = %v", callErr)
			}
			if rpcErr == nil || rpcErr.Code != gitruntime.ErrorResourceLimit {
				t.Fatalf("RPC error = %#v, want resource limit", rpcErr)
			}
		})
	}

	if content, err := os.ReadFile(source); err != nil || string(content) != "source" {
		t.Fatalf("source changed after rejected mutations: content=%q error=%v", content, err)
	}
	for _, path := range []string{"write.txt", "directory", "renamed.txt", "copied.txt"} {
		if _, err := os.Lstat(filepath.Join(root, path)); !os.IsNotExist(err) {
			t.Fatalf("rejected mutation created %q: %v", path, err)
		}
	}
}

func TestFilesystemWriteEffectAlwaysChangesTopology(t *testing.T) {
	for _, target := range []string{
		filepath.Join("repo", "src", "app.go"),
		filepath.Join("repo", ".git", "config"),
		filepath.Join("separate-git-dir", "config.worktree"),
		filepath.Join("separate-git-dir", "worktrees", "linked", "gitdir"),
	} {
		effect := filesystemWriteEffect(target)
		if !effect.ChangesTopology || len(effect.Paths) != 1 || effect.Paths[0] != target {
			t.Fatalf("filesystemWriteEffect(%q) = %#v, want topology-exclusive exact path", target, effect)
		}
	}
}

func TestMutationRPCsBindEffectToCoordinatedCanonicalPaths(t *testing.T) {
	tests := []struct {
		name    string
		typeID  uint32
		prepare func(t *testing.T, repoA string, repoB string)
		request func(alias string) any
		assert  func(t *testing.T, repoA string, repoB string)
	}{
		{
			name:   "write",
			typeID: TypeID_FS_WRITE,
			request: func(alias string) any {
				return fsWriteFileReq{Path: filepath.Join(alias, "written.txt"), Content: "repo-a"}
			},
			assert: func(t *testing.T, repoA string, repoB string) {
				assertFileContent(t, filepath.Join(repoA, "written.txt"), "repo-a")
				assertPathMissing(t, filepath.Join(repoB, "written.txt"))
			},
		},
		{
			name:   "mkdir",
			typeID: TypeID_FS_MKDIR,
			request: func(alias string) any {
				return fsMkdirReq{Path: filepath.Join(alias, "created")}
			},
			assert: func(t *testing.T, repoA string, repoB string) {
				if info, err := os.Stat(filepath.Join(repoA, "created")); err != nil || !info.IsDir() {
					t.Fatalf("coordinated directory missing: info=%#v error=%v", info, err)
				}
				assertPathMissing(t, filepath.Join(repoB, "created"))
			},
		},
		{
			name:   "delete",
			typeID: TypeID_FS_DELETE,
			prepare: func(t *testing.T, repoA string, repoB string) {
				writeTestFile(t, filepath.Join(repoA, "victim.txt"), "repo-a")
				writeTestFile(t, filepath.Join(repoB, "victim.txt"), "repo-b")
			},
			request: func(alias string) any {
				return fsDeleteReq{Path: filepath.Join(alias, "victim.txt")}
			},
			assert: func(t *testing.T, repoA string, repoB string) {
				assertPathMissing(t, filepath.Join(repoA, "victim.txt"))
				assertFileContent(t, filepath.Join(repoB, "victim.txt"), "repo-b")
			},
		},
		{
			name:   "rename",
			typeID: TypeID_FS_RENAME,
			prepare: func(t *testing.T, repoA string, repoB string) {
				writeTestFile(t, filepath.Join(repoA, "source.txt"), "repo-a")
				writeTestFile(t, filepath.Join(repoB, "source.txt"), "repo-b")
			},
			request: func(alias string) any {
				return fsRenameReq{OldPath: filepath.Join(alias, "source.txt"), NewPath: filepath.Join(alias, "renamed.txt")}
			},
			assert: func(t *testing.T, repoA string, repoB string) {
				assertPathMissing(t, filepath.Join(repoA, "source.txt"))
				assertFileContent(t, filepath.Join(repoA, "renamed.txt"), "repo-a")
				assertFileContent(t, filepath.Join(repoB, "source.txt"), "repo-b")
				assertPathMissing(t, filepath.Join(repoB, "renamed.txt"))
			},
		},
		{
			name:   "copy",
			typeID: TypeID_FS_COPY,
			prepare: func(t *testing.T, repoA string, repoB string) {
				writeTestFile(t, filepath.Join(repoA, "source.txt"), "repo-a")
				writeTestFile(t, filepath.Join(repoB, "source.txt"), "repo-b")
			},
			request: func(alias string) any {
				return fsCopyReq{SourcePath: filepath.Join(alias, "source.txt"), DestPath: filepath.Join(alias, "copied.txt")}
			},
			assert: func(t *testing.T, repoA string, repoB string) {
				assertFileContent(t, filepath.Join(repoA, "copied.txt"), "repo-a")
				assertPathMissing(t, filepath.Join(repoB, "copied.txt"))
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			repoA := filepath.Join(root, "repo-a")
			repoB := filepath.Join(root, "repo-b")
			alias := filepath.Join(root, "active")
			for _, path := range []string{repoA, repoB} {
				if err := os.MkdirAll(path, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			mustSymlink(t, repoA, alias)
			canonicalRepoA := mustEvalPath(t, repoA)
			if test.prepare != nil {
				test.prepare(t, repoA, repoB)
			}

			coordinator := &recordingMutationCoordinator{before: func(effect gitruntime.FilesystemEffect) error {
				for _, effectPath := range effect.Paths {
					rel, err := filepath.Rel(canonicalRepoA, effectPath)
					if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
						return fmt.Errorf("effect path %q is not bound to repo A", effectPath)
					}
				}
				if err := os.Remove(alias); err != nil {
					return err
				}
				return os.Symlink(repoB, alias)
			}}
			scope, err := filesystemscope.NewDefaultRegistry(root)
			if err != nil {
				t.Fatal(err)
			}
			svc := NewServiceWithCoordinator(scope, coordinator)
			callMutationRPC(t, svc, test.typeID, test.request(alias))
			if coordinator.calls != 1 {
				t.Fatalf("coordinator calls = %d, want 1", coordinator.calls)
			}
			test.assert(t, repoA, repoB)
		})
	}
}

func callMutationRPC(t *testing.T, svc *Service, typeID uint32, request any) {
	t.Helper()
	router := rpc.NewRouter()
	svc.Register(router, &session.Meta{CanRead: true, CanWrite: true})
	serverConn, clientConn := net.Pipe()
	defer serverConn.Close()
	defer clientConn.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := rpc.NewServer(serverConn, router)
	go func() { _ = server.Serve(ctx) }()
	client := rpc.NewClient(clientConn)
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	_, rpcErr, callErr := client.Call(ctx, typeID, payload)
	if callErr != nil {
		t.Fatalf("Call error = %v", callErr)
	}
	if rpcErr != nil {
		t.Fatalf("RPC error = %#v", rpcErr)
	}
}

func assertFileContent(t *testing.T, path string, want string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil || string(content) != want {
		t.Fatalf("ReadFile(%q) = %q, %v, want %q", path, content, err, want)
	}
}

func assertPathMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("path %q exists or returned unexpected error: %v", path, err)
	}
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

	p, err = s.resolveExistingDir("/")
	if err != nil {
		t.Fatalf("resolve(computer root) error: %v", err)
	}
	if p != "/" {
		t.Fatalf("resolve(computer root) = %q, want /", p)
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

	t.Run("rejects read-only computer root target", func(t *testing.T) {
		_, err := s.mkdirTarget("/../../outside", false)
		rpcErr, ok := err.(*rpc.Error)
		if !ok || rpcErr.Code != 403 {
			t.Fatalf("expected rpc 403 error, got %#v", err)
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

func TestServiceMutationsRequireWritableSourceRoot(t *testing.T) {
	home := t.TempDir()
	readonlyRoot := t.TempDir()
	writableRoot := t.TempDir()
	writeTestFile(t, filepath.Join(readonlyRoot, "source.txt"), "source")
	writeTestFile(t, filepath.Join(readonlyRoot, "delete.txt"), "delete")
	writeTestFile(t, filepath.Join(writableRoot, "source.txt"), "source")

	scope, err := filesystemscope.NewRegistry(&config.Config{
		AgentHomeDir: home,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "write",
			Roots: []config.FilesystemRootPolicy{
				{
					ID:          "read",
					Label:       "Read",
					Path:        readonlyRoot,
					Kind:        config.FilesystemRootCustom,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: false},
				},
				{
					ID:          "write",
					Label:       "Write",
					Path:        writableRoot,
					Kind:        config.FilesystemRootCustom,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	svc := NewServiceWithScope(scope)

	if err := svc.deleteEntry(filepath.Join(readonlyRoot, "source.txt"), false); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatalf("deleteEntry(readonly source) error = %v, want %v", err, filesystemscope.ErrWriteDenied)
	}
	if _, err := svc.renameEntry(filepath.Join(readonlyRoot, "source.txt"), filepath.Join(writableRoot, "renamed.txt")); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatalf("renameEntry(readonly source) error = %v, want %v", err, filesystemscope.ErrWriteDenied)
	}
	if _, err := svc.copyEntry(filepath.Join(readonlyRoot, "source.txt"), filepath.Join(writableRoot, "copied.txt"), false); err != nil {
		t.Fatalf("copyEntry(readonly source to writable dest) error = %v", err)
	}
	if _, err := svc.resolveTargetPath(filepath.Join(readonlyRoot, "new.txt")); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatalf("resolveTargetPath(readonly root) error = %v, want %v", err, filesystemscope.ErrWriteDenied)
	}
	if _, err := svc.mkdirTarget(filepath.Join(readonlyRoot, "new-dir"), false); err == nil {
		t.Fatalf("mkdirTarget(readonly root) error = nil, want write denied")
	} else if rpcErr, ok := err.(*rpc.Error); !ok || rpcErr.Code != 403 || rpcErr.Message != "write permission denied" {
		t.Fatalf("mkdirTarget(readonly root) error = %#v, want rpc 403 write permission denied", err)
	}
	if _, err := svc.renameEntry(filepath.Join(writableRoot, "source.txt"), filepath.Join(readonlyRoot, "renamed.txt")); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatalf("renameEntry(readonly destination) error = %v, want %v", err, filesystemscope.ErrWriteDenied)
	}
	if _, err := svc.copyEntry(filepath.Join(writableRoot, "source.txt"), filepath.Join(readonlyRoot, "copied.txt"), false); !errors.Is(err, filesystemscope.ErrWriteDenied) {
		t.Fatalf("copyEntry(readonly destination) error = %v, want %v", err, filesystemscope.ErrWriteDenied)
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
