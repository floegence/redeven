package gitrepo

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"unicode/utf8"
)

const (
	workspaceStatusMaxTokenBytes = 1 << 20
	workspaceStatusMaxRecords    = 50_000
	workspaceStatusMaxPathBytes  = 8 << 20
)

func (s *Service) readWorkspaceStatus(ctx context.Context, repoRoot string) (workspaceStatusSnapshot, error) {
	var snapshot workspaceStatusSnapshot
	_, err := s.runtime.StreamRead(
		ctx,
		repoRoot,
		nil,
		func(stdout io.Reader) error {
			parsed, parseErr := parseWorkspaceStatusReader(bufio.NewReaderSize(stdout, 64<<10), repoRoot)
			if parseErr == nil {
				snapshot = parsed
			}
			return parseErr
		},
		"--literal-pathspecs",
		"status",
		"--porcelain=v2",
		"--branch",
		"-z",
		"--untracked-files=all",
	)
	if err != nil {
		return workspaceStatusSnapshot{}, err
	}
	return snapshot, nil
}

func parseWorkspaceStatusPorcelainV2(out []byte) workspaceStatusSnapshot {
	snapshot, _ := parseWorkspaceStatusReader(bufio.NewReader(bytes.NewReader(out)), "")
	return snapshot
}

func parseWorkspaceStatusReader(reader *bufio.Reader, repoRoot string) (workspaceStatusSnapshot, error) {
	var snapshot workspaceStatusSnapshot
	recordCount := 0
	pathBytes := 0
	for {
		token, terminated, err := readBoundedNULToken(reader, workspaceStatusMaxTokenBytes)
		if err != nil {
			return workspaceStatusSnapshot{}, err
		}
		if len(token) == 0 && !terminated {
			break
		}
		records, paths, tokenErr := parseWorkspaceStatusToken(&snapshot, token, repoRoot)
		if tokenErr != nil {
			return workspaceStatusSnapshot{}, tokenErr
		}
		if !terminated && records != 0 {
			return workspaceStatusSnapshot{}, errors.New("git status record missing NUL terminator")
		}
		recordCount += records
		pathBytes += paths
		if recordCount > workspaceStatusMaxRecords || pathBytes > workspaceStatusMaxPathBytes || estimateWorkspaceSnapshotBytes(snapshot) > workspaceSnapshotMaxBytes {
			return workspaceStatusSnapshot{}, errWorkspaceInventoryLimit
		}
		if !terminated {
			break
		}
	}
	if snapshot.pendingRenameNew != "" {
		return workspaceStatusSnapshot{}, errors.New("rename record missing source path token")
	}
	snapshot.RecordCount = recordCount
	sortWorkspaceChanges(snapshot.Staged)
	sortWorkspaceChanges(snapshot.Unstaged)
	sortWorkspaceChanges(snapshot.Untracked)
	sortWorkspaceChanges(snapshot.Conflicted)
	return snapshot, nil
}

func readBoundedNULToken(reader *bufio.Reader, maxBytes int) ([]byte, bool, error) {
	if reader == nil {
		return nil, false, io.EOF
	}
	buffer := make([]byte, 0, 4096)
	for {
		fragment, err := reader.ReadSlice(0)
		terminated := len(fragment) > 0 && fragment[len(fragment)-1] == 0
		if terminated {
			fragment = fragment[:len(fragment)-1]
		}
		if len(buffer)+len(fragment) > maxBytes {
			return nil, false, errWorkspaceInventoryLimit
		}
		buffer = append(buffer, fragment...)
		if terminated {
			return buffer, true, nil
		}
		switch {
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			return buffer, false, nil
		case err != nil:
			return nil, false, err
		default:
			return buffer, false, nil
		}
	}
}

func parseWorkspaceStatusToken(snapshot *workspaceStatusSnapshot, token []byte, repoRoot string) (int, int, error) {
	if snapshot.pendingRenameNew != "" {
		oldPath, _, err := validateWorkspaceStatusPath(token, repoRoot)
		if err != nil {
			return 0, 0, err
		}
		newPath := snapshot.pendingRenameNew
		xy := snapshot.pendingRenameXY
		snapshot.pendingRenameNew = ""
		snapshot.pendingRenameXY = ""
		applyTrackedWorkspaceRecord(snapshot, xy, preferredWorkspacePath(oldPath, newPath), oldPath, newPath)
		return 1, len(oldPath) + len(newPath), nil
	}
	for bytes.HasPrefix(token, []byte("# ")) {
		newline := bytes.IndexByte(token, '\n')
		if newline < 0 {
			parseWorkspaceHeader(snapshot, string(token[2:]))
			return 0, 0, nil
		}
		parseWorkspaceHeader(snapshot, string(token[2:newline]))
		token = token[newline+1:]
	}
	if len(token) == 0 {
		return 0, 0, nil
	}
	switch {
	case bytes.HasPrefix(token, []byte("1 ")):
		fields := bytes.SplitN(token, []byte{' '}, 9)
		if len(fields) != 9 {
			return 0, 0, errors.New("invalid ordinary git status record")
		}
		pathValue, directory, err := validateWorkspaceStatusPath(fields[8], repoRoot)
		if err != nil {
			return 0, 0, err
		}
		if directory {
			appendWorkspaceDirectoryBoundary(snapshot, pathValue)
		} else {
			applyTrackedWorkspaceRecord(snapshot, string(fields[1]), pathValue, "", pathValue)
		}
		return 1, len(pathValue), nil
	case bytes.HasPrefix(token, []byte("2 ")):
		fields := bytes.SplitN(token, []byte{' '}, 10)
		if len(fields) != 10 {
			return 0, 0, errors.New("invalid rename git status record")
		}
		newPath, directory, err := validateWorkspaceStatusPath(fields[9], repoRoot)
		if err != nil {
			return 0, 0, err
		}
		if directory {
			return 0, 0, errors.New("rename target cannot be a directory boundary")
		}
		snapshot.pendingRenameXY = string(fields[1])
		snapshot.pendingRenameNew = newPath
		return 0, 0, nil
	case bytes.HasPrefix(token, []byte("u ")):
		fields := bytes.SplitN(token, []byte{' '}, 11)
		if len(fields) != 11 {
			return 0, 0, errors.New("invalid conflicted git status record")
		}
		pathValue, _, err := validateWorkspaceStatusPath(fields[10], repoRoot)
		if err != nil {
			return 0, 0, err
		}
		item := gitWorkspaceChange{Section: "conflicted", EntryKind: "file", gitDiffFileSummary: gitDiffFileSummary{ChangeType: "conflicted", Path: pathValue, DisplayPath: pathValue}}
		finalizeWorkspaceStatusChange(&item)
		snapshot.Conflicted = append(snapshot.Conflicted, item)
		return 1, len(pathValue), nil
	case bytes.HasPrefix(token, []byte("? ")):
		pathValue, directory, err := validateWorkspaceStatusPath(token[2:], repoRoot)
		if err != nil {
			return 0, 0, err
		}
		item := gitWorkspaceChange{Section: "untracked", EntryKind: "file", gitDiffFileSummary: gitDiffFileSummary{ChangeType: "added", Path: pathValue, NewPath: pathValue, DisplayPath: pathValue}}
		if directory {
			item.EntryKind = "directory"
			item.DirectoryPath = pathValue
		}
		finalizeWorkspaceStatusChange(&item)
		snapshot.Untracked = append(snapshot.Untracked, item)
		return 1, len(pathValue), nil
	case bytes.HasPrefix(token, []byte("! ")):
		return 1, 0, nil
	default:
		return 0, 0, errors.New("invalid git status token")
	}
}

func validateWorkspaceStatusPath(raw []byte, repoRoot string) (string, bool, error) {
	if len(raw) == 0 || !utf8.Valid(raw) {
		return "", false, errWorkspacePathEncoding
	}
	directory := raw[len(raw)-1] == '/'
	if directory {
		raw = raw[:len(raw)-1]
	}
	pathValue, err := normalizeGitPathspec(string(raw))
	if err != nil || pathValue == "" {
		return "", false, errors.New("invalid git status path")
	}
	if repoRoot != "" {
		info, statErr := os.Lstat(filepath.Join(repoRoot, filepath.FromSlash(pathValue)))
		if statErr == nil && info.IsDir() {
			directory = true
		}
	}
	return pathValue, directory, nil
}

func appendWorkspaceDirectoryBoundary(snapshot *workspaceStatusSnapshot, pathValue string) {
	item := gitWorkspaceChange{Section: "untracked", EntryKind: "directory", DirectoryPath: pathValue, gitDiffFileSummary: gitDiffFileSummary{ChangeType: "added", Path: pathValue, NewPath: pathValue, DisplayPath: pathValue}}
	finalizeWorkspaceStatusChange(&item)
	snapshot.Untracked = append(snapshot.Untracked, item)
}

func finalizeWorkspaceStatusChange(item *gitWorkspaceChange) {
	if item == nil {
		return
	}
	item.ParentPath = workspaceChangeParentPath(*item)
	item.MutationPaths = workspaceChangePathCandidates(*item)
}
