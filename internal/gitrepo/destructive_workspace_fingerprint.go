package gitrepo

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	destructiveScanMaxEntries      = 100_000
	destructiveScanMaxPathBytes    = 16 << 20
	destructiveScanMaxHeapBytes    = 32 << 20
	destructiveScanMaxContentBytes = int64(1 << 30)
	destructiveScanTimeout         = 10 * time.Second
)

var errDestructiveWorkspaceScanLimit = errors.New("destructive workspace scan limit exceeded")

type destructiveWorkspaceScanner struct {
	ctx             context.Context
	root            string
	gitDir          string
	identityCurrent func() bool
	hash            hash.Hash
	entries         int
	pathBytes       int
	heapBytes       int
	contentBytes    int64
}

func (s *Service) destructiveWorkspaceFingerprint(ctx context.Context, worktreePath string) (string, error) {
	identity, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, worktreePath)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("not a git repository")
	}
	admission, err := s.runtime.AcquireDestructiveScan(ctx)
	if err != nil {
		return "", err
	}
	defer admission.Release()
	scanCtx, cancel := context.WithTimeout(ctx, destructiveScanTimeout)
	defer cancel()
	scanner := &destructiveWorkspaceScanner{
		ctx:             scanCtx,
		root:            identity.WorktreeRoot,
		gitDir:          identity.GitDir,
		identityCurrent: func() bool { return s.runtime.RepositoryIdentityCurrent(identity) },
		hash:            sha256.New(),
	}
	if !scanner.identityCurrent() {
		return "", errDestructiveWorkspaceScanLimit
	}
	rootDirectory, err := openRootDirectoryNoFollow(identity.WorktreeRoot)
	if err != nil {
		return "", errDestructiveWorkspaceScanLimit
	}
	defer rootDirectory.Close()
	rootInfo, err := rootDirectory.Stat()
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return "", errDestructiveWorkspaceScanLimit
	}
	scanner.writeField("destructive_workspace_fingerprint_v1")
	if err := scanner.scanDirectory(rootDirectory, identity.WorktreeRoot, "", true, rootInfo); err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return "", errDestructiveWorkspaceScanLimit
		}
		return "", err
	}
	if !scanner.identityCurrent() {
		return "", errDestructiveWorkspaceScanLimit
	}
	return hex.EncodeToString(scanner.hash.Sum(nil)), nil
}

func (s *destructiveWorkspaceScanner) scanDirectory(directory *os.File, absPath string, relativePath string, root bool, expected os.FileInfo) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	before, err := directory.Stat()
	if err != nil || !before.IsDir() || expected == nil || !os.SameFile(expected, before) {
		return errDestructiveWorkspaceScanLimit
	}
	s.writeEntry("directory", relativePath, before.Mode())
	entries := make([]os.DirEntry, 0, 256)
	for {
		batch, readErr := directory.ReadDir(256)
		for _, entry := range batch {
			name := entry.Name()
			childRelative := name
			if relativePath != "" {
				childRelative = relativePath + "/" + name
			}
			if err := s.admitEntry(childRelative, name); err != nil {
				return err
			}
			entries = append(entries, entry)
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return errDestructiveWorkspaceScanLimit
		}
	}
	sort.Slice(entries, func(i int, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		name := entry.Name()
		childRelative := name
		if relativePath != "" {
			childRelative = relativePath + "/" + name
		}
		childAbs := filepath.Join(absPath, name)
		expectedChild, err := entry.Info()
		if err != nil || !entryTypeMatches(entry.Type(), expectedChild.Mode()) {
			return errDestructiveWorkspaceScanLimit
		}
		if root && name == ".git" {
			if err := s.verifyGitControlEntry(directory, name, childAbs, expectedChild); err != nil {
				return err
			}
			continue
		}
		if err := s.scanEntry(directory, name, childAbs, childRelative, expectedChild); err != nil {
			return err
		}
	}
	after, err := directory.Stat()
	if err != nil || !os.SameFile(before, after) || before.ModTime() != after.ModTime() || before.Mode() != after.Mode() {
		return errDestructiveWorkspaceScanLimit
	}
	pathAfter, err := os.Lstat(absPath)
	if err != nil || pathAfter.Mode()&os.ModeSymlink != 0 || !pathAfter.IsDir() || !os.SameFile(before, pathAfter) {
		return errDestructiveWorkspaceScanLimit
	}
	return s.ctx.Err()
}

func (s *destructiveWorkspaceScanner) scanEntry(parent *os.File, name string, absPath string, relativePath string, info os.FileInfo) error {
	switch {
	case info.Mode().IsRegular():
		return s.scanRegularFile(parent, name, absPath, relativePath, info)
	case info.IsDir():
		directory, err := openDirectoryAtNoFollow(parent, name)
		if err != nil {
			return errDestructiveWorkspaceScanLimit
		}
		defer directory.Close()
		return s.scanDirectory(directory, absPath, relativePath, false, info)
	case info.Mode()&os.ModeSymlink != 0:
		target, err := readlinkAtNoFollow(parent, name, 1<<20)
		if err != nil {
			return errDestructiveWorkspaceScanLimit
		}
		if s.heapBytes > destructiveScanMaxHeapBytes-len(target) {
			return errDestructiveWorkspaceScanLimit
		}
		after, err := os.Lstat(absPath)
		if err != nil || !os.SameFile(info, after) || info.ModTime() != after.ModTime() || info.Mode() != after.Mode() {
			return errDestructiveWorkspaceScanLimit
		}
		s.writeEntry("symlink", relativePath, info.Mode())
		s.writeField(target)
		return nil
	default:
		return errDestructiveWorkspaceScanLimit
	}
}

func (s *destructiveWorkspaceScanner) scanRegularFile(parent *os.File, name string, absPath string, relativePath string, before os.FileInfo) error {
	file, err := openRegularAtNoFollow(parent, name)
	if err != nil {
		return errDestructiveWorkspaceScanLimit
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return errDestructiveWorkspaceScanLimit
	}
	if opened.Size() < 0 || opened.Size() > destructiveScanMaxContentBytes-s.contentBytes {
		return errDestructiveWorkspaceScanLimit
	}
	s.writeEntry("file", relativePath, opened.Mode())
	s.writeUint64(uint64(opened.Size()))
	buffer := make([]byte, 64<<10)
	for {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		n, readErr := file.Read(buffer)
		if n > 0 {
			if int64(n) > destructiveScanMaxContentBytes-s.contentBytes {
				return errDestructiveWorkspaceScanLimit
			}
			s.contentBytes += int64(n)
			_, _ = s.hash.Write(buffer[:n])
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return errDestructiveWorkspaceScanLimit
		}
	}
	after, err := file.Stat()
	if err != nil || !os.SameFile(opened, after) || opened.Size() != after.Size() || opened.ModTime() != after.ModTime() || opened.Mode() != after.Mode() {
		return errDestructiveWorkspaceScanLimit
	}
	pathAfter, err := os.Lstat(absPath)
	if err != nil || !pathAfter.Mode().IsRegular() || !os.SameFile(opened, pathAfter) {
		return errDestructiveWorkspaceScanLimit
	}
	return nil
}

func (s *destructiveWorkspaceScanner) verifyGitControlEntry(parent *os.File, name string, gitEntry string, info os.FileInfo) error {
	if !s.identityCurrent() || info == nil || info.Mode()&os.ModeSymlink != 0 {
		return errDestructiveWorkspaceScanLimit
	}
	if info.IsDir() {
		directory, err := openDirectoryAtNoFollow(parent, name)
		if err != nil {
			return errDestructiveWorkspaceScanLimit
		}
		defer directory.Close()
		opened, err := directory.Stat()
		if err != nil || !opened.IsDir() || !os.SameFile(info, opened) {
			return errDestructiveWorkspaceScanLimit
		}
		gitDirInfo, statErr := os.Stat(s.gitDir)
		pathAfter, pathErr := os.Lstat(gitEntry)
		if statErr != nil || pathErr != nil || pathAfter.Mode()&os.ModeSymlink != 0 ||
			!os.SameFile(opened, gitDirInfo) || !os.SameFile(opened, pathAfter) || !s.identityCurrent() {
			return errDestructiveWorkspaceScanLimit
		}
		return nil
	}
	if !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return errDestructiveWorkspaceScanLimit
	}
	file, err := openRegularAtNoFollow(parent, name)
	if err != nil {
		return errDestructiveWorkspaceScanLimit
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) || opened.Size() > 1<<20 {
		return errDestructiveWorkspaceScanLimit
	}
	data, err := readFileBounded(file, 1<<20)
	if err != nil {
		return errDestructiveWorkspaceScanLimit
	}
	openedAfter, openedAfterErr := file.Stat()
	after, err := os.Lstat(gitEntry)
	if openedAfterErr != nil || err != nil || openedAfter == nil || !os.SameFile(opened, openedAfter) || !os.SameFile(opened, after) ||
		opened.Size() != openedAfter.Size() || opened.ModTime() != openedAfter.ModTime() || opened.Mode() != openedAfter.Mode() ||
		after.Mode()&os.ModeSymlink != 0 {
		return errDestructiveWorkspaceScanLimit
	}
	line := strings.TrimSuffix(string(data), "\n")
	line = strings.TrimSuffix(line, "\r")
	if strings.ContainsAny(line, "\r\n") || !strings.HasPrefix(line, "gitdir: ") {
		return errDestructiveWorkspaceScanLimit
	}
	target := strings.TrimPrefix(line, "gitdir: ")
	if target == "" {
		return errDestructiveWorkspaceScanLimit
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(s.root, target)
	}
	canonical, err := filepath.EvalSymlinks(target)
	if err != nil || filepath.Clean(canonical) != filepath.Clean(s.gitDir) || !s.identityCurrent() {
		return errDestructiveWorkspaceScanLimit
	}
	targetInfo, err := os.Stat(canonical)
	if err != nil {
		return errDestructiveWorkspaceScanLimit
	}
	knownInfo, err := os.Stat(s.gitDir)
	if err != nil || !os.SameFile(targetInfo, knownInfo) || !s.identityCurrent() {
		return errDestructiveWorkspaceScanLimit
	}
	return nil
}

func (s *destructiveWorkspaceScanner) admitEntry(relativePath string, name string) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	entryHeap := len(relativePath) + len(name) + 256
	if s.entries >= destructiveScanMaxEntries || len(relativePath) > destructiveScanMaxPathBytes-s.pathBytes || entryHeap > destructiveScanMaxHeapBytes-s.heapBytes {
		return errDestructiveWorkspaceScanLimit
	}
	s.entries++
	s.pathBytes += len(relativePath)
	s.heapBytes += entryHeap
	return nil
}

func readFileBounded(file *os.File, limit int) ([]byte, error) {
	if file == nil || limit < 0 {
		return nil, errDestructiveWorkspaceScanLimit
	}
	data := make([]byte, 0, min(limit, 4096))
	buffer := make([]byte, 4096)
	for {
		n, err := file.Read(buffer)
		if n > 0 {
			if n > limit-len(data) {
				return nil, errDestructiveWorkspaceScanLimit
			}
			data = append(data, buffer[:n]...)
		}
		if errors.Is(err, io.EOF) {
			return data, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

func entryTypeMatches(entryType os.FileMode, actual os.FileMode) bool {
	if entryType == 0 {
		return true
	}
	return entryType.Type() == actual.Type()
}

func (s *destructiveWorkspaceScanner) writeEntry(kind string, relativePath string, mode os.FileMode) {
	s.writeField(kind)
	s.writeField(relativePath)
	s.writeUint64(uint64(mode.Perm()))
}

func (s *destructiveWorkspaceScanner) writeField(value string) {
	s.writeUint64(uint64(len(value)))
	_, _ = s.hash.Write([]byte(value))
}

func (s *destructiveWorkspaceScanner) writeUint64(value uint64) {
	var encoded [8]byte
	binary.BigEndian.PutUint64(encoded[:], value)
	_, _ = s.hash.Write(encoded[:])
}
