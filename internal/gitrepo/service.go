package gitrepo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/framing/jsonframe"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/gitutil"
	"github.com/floegence/redeven-agent/internal/pathutil"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	TypeID_GIT_RESOLVE_REPO      uint32 = 1101
	TypeID_GIT_LIST_COMMITS      uint32 = 1102
	TypeID_GIT_GET_COMMIT_DETAIL uint32 = 1103

	defaultCommitPageSize = 50
	maxCommitPageSize     = 200
	defaultPatchMaxBytes  = 2 * 1024 * 1024
	hardPatchMaxBytes     = 16 * 1024 * 1024
)

type Service struct {
	root string
}

func NewService(root string) *Service {
	root = strings.TrimSpace(root)
	if root == "" {
		root = "."
	}
	if abs, err := filepath.Abs(root); err == nil {
		root = abs
	}
	root = filepath.Clean(root)
	return &Service{root: root}
}

func (s *Service) Register(r *rpc.Router, meta *session.Meta) {
	s.RegisterWithAccessGate(r, meta, nil)
}

func (s *Service) RegisterWithAccessGate(r *rpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	if r == nil || s == nil {
		return
	}

	accessgate.RegisterTyped[resolveRepoReq, resolveRepoResp](r, TypeID_GIT_RESOLVE_REPO, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *resolveRepoReq) (*resolveRepoResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &resolveRepoReq{}
		}
		repo, available, err := s.resolveRepoForPath(ctx, req.Path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, &rpc.Error{Code: 404, Message: "not found"}
			}
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}
		if !available {
			return &resolveRepoResp{Available: false}, nil
		}
		return &resolveRepoResp{
			Available:    true,
			RepoRootPath: repo.repoRootVirtual,
			HeadRef:      repo.headRef,
			HeadCommit:   repo.headCommit,
			Dirty:        repo.dirty,
		}, nil
	})

	accessgate.RegisterTyped[listCommitsReq, listCommitsResp](r, TypeID_GIT_LIST_COMMITS, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listCommitsReq) (*listCommitsResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listCommitsReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		limit := defaultCommitPageSize
		if req.Limit > 0 {
			limit = req.Limit
		}
		if limit > maxCommitPageSize {
			limit = maxCommitPageSize
		}
		if limit <= 0 {
			limit = defaultCommitPageSize
		}
		offset := req.Offset
		if offset < 0 {
			offset = 0
		}
		commits, nextOffset, hasMore, err := s.listCommits(ctx, repo, offset, limit)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return &listCommitsResp{
			RepoRootPath: repo.repoRootVirtual,
			Commits:      commits,
			NextOffset:   nextOffset,
			HasMore:      hasMore,
		}, nil
	})

	accessgate.RegisterTyped[getCommitDetailReq, getCommitDetailResp](r, TypeID_GIT_GET_COMMIT_DETAIL, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getCommitDetailReq) (*getCommitDetailResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getCommitDetailReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		commit := strings.TrimSpace(req.Commit)
		if commit == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing commit"}
		}
		detail, files, err := s.getCommitDetail(ctx, repo, commit)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return &getCommitDetailResp{
			RepoRootPath: repo.repoRootVirtual,
			Commit:       detail,
			Files:        files,
		}, nil
	})
}

func (s *Service) ServeReadCommitPatchStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta) {
	s.ServeReadCommitPatchStreamWithAccessGate(ctx, stream, meta, nil)
}

func (s *Service) ServeReadCommitPatchStreamWithAccessGate(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, gate *accessgate.Gate) {
	if stream == nil {
		return
	}
	defer func() { _ = stream.Close() }()

	if err := accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected); err != nil {
		rpcErr, _ := err.(*rpc.Error)
		code := 423
		message := "access password required"
		if rpcErr != nil {
			code = int(rpcErr.Code)
			message = rpcErr.Message
		}
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: code, Message: message},
		})
		return
	}

	if meta == nil || !meta.CanRead {
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: 403, Message: "read permission denied"},
		})
		return
	}

	reqBytes, err := jsonframe.ReadJSONFrame(stream, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		return
	}

	var req readCommitPatchReq
	if err := json.Unmarshal(reqBytes, &req); err != nil {
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: 400, Message: "invalid request"},
		})
		return
	}

	repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
	if err != nil {
		rpcErr := classifyRepoRPCError(err)
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: int(rpcErr.Code), Message: rpcErr.Message},
		})
		return
	}

	commit := strings.TrimSpace(req.Commit)
	if commit == "" {
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: 400, Message: "missing commit"},
		})
		return
	}

	filePath, err := normalizePatchPath(req.FilePath)
	if err != nil {
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: 400, Message: "invalid file_path"},
		})
		return
	}

	maxBytes := normalizePatchMaxBytes(req.MaxBytes)
	patchBytes, truncated, err := s.readCommitPatchBytes(ctx, repo.repoRootReal, commit, filePath, maxBytes)
	if err != nil {
		rpcErr := classifyGitRPCError(err)
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
			Ok:    false,
			Error: &streamError{Code: int(rpcErr.Code), Message: rpcErr.Message},
		})
		return
	}

	if err := jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{
		Ok:         true,
		ContentLen: int64(len(patchBytes)),
		Truncated:  truncated,
	}); err != nil {
		return
	}
	if len(patchBytes) == 0 {
		return
	}
	_, _ = stream.Write(patchBytes)
}

type repoContext struct {
	repoRootReal    string
	repoRootVirtual string
	headRef         string
	headCommit      string
	dirty           bool
}

func (s *Service) resolveRepoForPath(ctx context.Context, virtualPath string) (repoContext, bool, error) {
	resolved, err := pathutil.ResolveVirtualPath(s.root, virtualPath)
	if err != nil {
		return repoContext{}, false, err
	}
	stat, err := os.Stat(resolved.Real)
	if err != nil {
		return repoContext{}, false, err
	}
	targetDir := resolved.Real
	if !stat.IsDir() {
		targetDir = filepath.Dir(resolved.Real)
	}
	repoRootReal, ok := gitutil.ShowTopLevel(ctx, targetDir)
	if !ok {
		return repoContext{}, false, nil
	}
	withinRoot, err := pathutil.IsWithinRoot(repoRootReal, s.root)
	if err != nil {
		return repoContext{}, false, err
	}
	if !withinRoot {
		return repoContext{}, false, nil
	}
	repoRootVirtual, err := pathutil.RealPathToVirtual(s.root, repoRootReal)
	if err != nil {
		return repoContext{}, false, err
	}
	repo, err := s.loadRepoContext(ctx, repoRootReal, repoRootVirtual)
	if err != nil {
		return repoContext{}, false, err
	}
	return repo, true, nil
}

func (s *Service) resolveExplicitRepo(ctx context.Context, repoRootPath string) (repoContext, error) {
	resolved, err := pathutil.ResolveVirtualPath(s.root, repoRootPath)
	if err != nil {
		return repoContext{}, err
	}
	stat, err := os.Stat(resolved.Real)
	if err != nil {
		return repoContext{}, err
	}
	if !stat.IsDir() {
		return repoContext{}, errors.New("repo root must be a directory")
	}
	repoRootReal, ok := gitutil.ShowTopLevel(ctx, resolved.Real)
	if !ok {
		return repoContext{}, errors.New("not a git repository")
	}
	if filepath.Clean(repoRootReal) != filepath.Clean(resolved.Real) {
		return repoContext{}, errors.New("repo_root_path must match worktree root")
	}
	return s.loadRepoContext(ctx, repoRootReal, resolved.Virtual)
}

func (s *Service) loadRepoContext(ctx context.Context, repoRootReal string, repoRootVirtual string) (repoContext, error) {
	headRef := strings.TrimSpace(readGitOptional(ctx, repoRootReal, "symbolic-ref", "--quiet", "--short", "HEAD"))
	if headRef == "" {
		headRef = strings.TrimSpace(readGitOptional(ctx, repoRootReal, "rev-parse", "--abbrev-ref", "HEAD"))
	}
	headCommit := strings.TrimSpace(readGitOptional(ctx, repoRootReal, "rev-parse", "--verify", "HEAD"))
	dirtyRaw := readGitOptional(ctx, repoRootReal, "status", "--porcelain", "--untracked-files=normal")
	return repoContext{
		repoRootReal:    repoRootReal,
		repoRootVirtual: repoRootVirtual,
		headRef:         headRef,
		headCommit:      headCommit,
		dirty:           strings.TrimSpace(dirtyRaw) != "",
	}, nil
}

func readGitOptional(ctx context.Context, repoRoot string, args ...string) string {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, args...)
	if err != nil {
		return ""
	}
	return string(out)
}

func (s *Service) listCommits(ctx context.Context, repo repoContext, offset int, limit int) ([]gitCommitSummary, int, bool, error) {
	if strings.TrimSpace(repo.headCommit) == "" {
		return nil, 0, false, nil
	}
	format := "%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b%x1e"
	out, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil,
		"log",
		"--date-order",
		"--max-count="+strconv.Itoa(limit+1),
		"--skip="+strconv.Itoa(offset),
		"--format="+format,
		"HEAD",
	)
	if err != nil {
		return nil, 0, false, err
	}
	commits := parseCommitLogOutput(out)
	hasMore := len(commits) > limit
	if hasMore {
		commits = commits[:limit]
	}
	nextOffset := 0
	if hasMore {
		nextOffset = offset + limit
	}
	return commits, nextOffset, hasMore, nil
}

func (s *Service) getCommitDetail(ctx context.Context, repo repoContext, commit string) (gitCommitDetail, []gitCommitFileSummary, error) {
	format := "%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%B%x1e"
	metaOut, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "show", "-s", "--format="+format, commit)
	if err != nil {
		return gitCommitDetail{}, nil, err
	}
	details := parseCommitDetailOutput(metaOut)
	if len(details) == 0 {
		return gitCommitDetail{}, nil, errors.New("commit not found")
	}
	statusOut, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", "-C", commit)
	if err != nil {
		return gitCommitDetail{}, nil, err
	}
	numstatOut, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "show", "--format=", "--numstat", "--root", "-M", "-C", commit)
	if err != nil {
		return gitCommitDetail{}, nil, err
	}
	files := mergeCommitFileSummaries(parseNameStatusOutput(statusOut), parseNumstatOutput(numstatOut))
	return details[0], files, nil
}

func parseCommitLogOutput(out []byte) []gitCommitSummary {
	records := strings.Split(string(out), "\x1e")
	items := make([]gitCommitSummary, 0, len(records))
	for _, record := range records {
		record = strings.TrimSuffix(record, "\n")
		record = strings.TrimSpace(record)
		if record == "" {
			continue
		}
		fields := strings.Split(record, "\x00")
		if len(fields) < 8 {
			continue
		}
		authorTimeUnix, _ := strconv.ParseInt(strings.TrimSpace(fields[5]), 10, 64)
		bodyPreview := summarizeCommitBody(fields[7])
		items = append(items, gitCommitSummary{
			Hash:         strings.TrimSpace(fields[0]),
			ShortHash:    strings.TrimSpace(fields[1]),
			Parents:      splitParents(fields[2]),
			AuthorName:   strings.TrimSpace(fields[3]),
			AuthorEmail:  strings.TrimSpace(fields[4]),
			AuthorTimeMs: authorTimeUnix * 1000,
			Subject:      strings.TrimSpace(fields[6]),
			BodyPreview:  bodyPreview,
		})
	}
	return items
}

func parseCommitDetailOutput(out []byte) []gitCommitDetail {
	records := strings.Split(string(out), "\x1e")
	items := make([]gitCommitDetail, 0, len(records))
	for _, record := range records {
		record = strings.TrimSuffix(record, "\n")
		record = strings.TrimSpace(record)
		if record == "" {
			continue
		}
		fields := strings.Split(record, "\x00")
		if len(fields) < 8 {
			continue
		}
		authorTimeUnix, _ := strconv.ParseInt(strings.TrimSpace(fields[5]), 10, 64)
		items = append(items, gitCommitDetail{
			Hash:         strings.TrimSpace(fields[0]),
			ShortHash:    strings.TrimSpace(fields[1]),
			Parents:      splitParents(fields[2]),
			AuthorName:   strings.TrimSpace(fields[3]),
			AuthorEmail:  strings.TrimSpace(fields[4]),
			AuthorTimeMs: authorTimeUnix * 1000,
			Subject:      strings.TrimSpace(fields[6]),
			Body:         strings.TrimSpace(fields[7]),
		})
	}
	return items
}

func splitParents(raw string) []string {
	parts := strings.Fields(strings.TrimSpace(raw))
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}

func summarizeCommitBody(raw string) string {
	collapsed := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
	if collapsed == "" {
		return ""
	}
	if len(collapsed) <= 180 {
		return collapsed
	}
	return collapsed[:180] + "…"
}

type numstatEntry struct {
	path      string
	oldPath   string
	newPath   string
	additions int
	deletions int
	isBinary  bool
}

func parseNameStatusOutput(out []byte) []gitCommitFileSummary {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	items := make([]gitCommitFileSummary, 0, len(lines))
	seen := make(map[string]struct{})
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}
		rawStatus := strings.TrimSpace(parts[0])
		changeCode := byte(0)
		if rawStatus != "" {
			changeCode = rawStatus[0]
		}
		summary := gitCommitFileSummary{}
		switch changeCode {
		case 'A':
			summary.ChangeType = "added"
			summary.Path = strings.TrimSpace(parts[1])
			summary.NewPath = summary.Path
			summary.PatchPath = summary.Path
		case 'D':
			summary.ChangeType = "deleted"
			summary.Path = strings.TrimSpace(parts[1])
			summary.OldPath = summary.Path
			summary.PatchPath = summary.Path
		case 'R':
			if len(parts) < 3 {
				continue
			}
			summary.ChangeType = "renamed"
			summary.OldPath = strings.TrimSpace(parts[1])
			summary.NewPath = strings.TrimSpace(parts[2])
			summary.Path = summary.NewPath
			summary.PatchPath = summary.NewPath
		case 'C':
			if len(parts) < 3 {
				continue
			}
			summary.ChangeType = "copied"
			summary.OldPath = strings.TrimSpace(parts[1])
			summary.NewPath = strings.TrimSpace(parts[2])
			summary.Path = summary.NewPath
			summary.PatchPath = summary.NewPath
		default:
			summary.ChangeType = "modified"
			summary.Path = strings.TrimSpace(parts[1])
			summary.NewPath = summary.Path
			summary.PatchPath = summary.Path
		}
		key := summary.ChangeType + ":" + summary.Path + ":" + summary.OldPath + ":" + summary.NewPath
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		items = append(items, summary)
	}
	return items
}

func parseNumstatOutput(out []byte) []numstatEntry {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	entries := make([]numstatEntry, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		entry := numstatEntry{}
		if strings.TrimSpace(parts[0]) == "-" || strings.TrimSpace(parts[1]) == "-" {
			entry.isBinary = true
		} else {
			entry.additions, _ = strconv.Atoi(strings.TrimSpace(parts[0]))
			entry.deletions, _ = strconv.Atoi(strings.TrimSpace(parts[1]))
		}
		oldPath, newPath := parseNumstatPaths(parts[2])
		entry.oldPath = oldPath
		entry.newPath = newPath
		entry.path = newPath
		if entry.path == "" {
			entry.path = oldPath
		}
		entries = append(entries, entry)
	}
	return entries
}

func parseNumstatPaths(raw string) (string, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	if !strings.Contains(raw, " => ") {
		return raw, raw
	}
	open := strings.Index(raw, "{")
	close := strings.LastIndex(raw, "}")
	if open >= 0 && close > open {
		inside := raw[open+1 : close]
		if strings.Contains(inside, " => ") {
			parts := strings.SplitN(inside, " => ", 2)
			prefix := raw[:open]
			suffix := raw[close+1:]
			return prefix + parts[0] + suffix, prefix + parts[1] + suffix
		}
	}
	parts := strings.SplitN(raw, " => ", 2)
	if len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return raw, raw
}

func mergeCommitFileSummaries(base []gitCommitFileSummary, stats []numstatEntry) []gitCommitFileSummary {
	if len(base) == 0 && len(stats) == 0 {
		return nil
	}
	statByKey := make(map[string]numstatEntry, len(stats)*3)
	for _, stat := range stats {
		if stat.path != "" {
			statByKey[stat.path] = stat
		}
		if stat.oldPath != "" {
			statByKey[stat.oldPath] = stat
		}
		if stat.newPath != "" {
			statByKey[stat.newPath] = stat
		}
	}
	if len(base) == 0 {
		base = make([]gitCommitFileSummary, 0, len(stats))
		for _, stat := range stats {
			changeType := "modified"
			if stat.oldPath != "" && stat.newPath != "" && stat.oldPath != stat.newPath {
				changeType = "renamed"
			}
			base = append(base, gitCommitFileSummary{
				ChangeType: changeType,
				Path:       stat.path,
				OldPath:    stat.oldPath,
				NewPath:    stat.newPath,
				PatchPath:  preferredPatchPath(changeType, stat.oldPath, stat.newPath, stat.path),
			})
		}
	}
	for index := range base {
		candidates := []string{base[index].Path, base[index].NewPath, base[index].OldPath}
		for _, candidate := range candidates {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" {
				continue
			}
			stat, ok := statByKey[candidate]
			if !ok {
				continue
			}
			base[index].Additions = stat.additions
			base[index].Deletions = stat.deletions
			base[index].IsBinary = stat.isBinary
			if base[index].OldPath == "" {
				base[index].OldPath = stat.oldPath
			}
			if base[index].NewPath == "" {
				base[index].NewPath = stat.newPath
			}
			if base[index].Path == "" {
				base[index].Path = stat.path
			}
			if base[index].PatchPath == "" {
				base[index].PatchPath = preferredPatchPath(base[index].ChangeType, base[index].OldPath, base[index].NewPath, base[index].Path)
			}
			break
		}
	}
	return base
}

func preferredPatchPath(changeType string, oldPath string, newPath string, pathValue string) string {
	switch strings.TrimSpace(changeType) {
	case "deleted":
		if oldPath != "" {
			return oldPath
		}
	case "renamed", "copied", "added", "modified":
		if newPath != "" {
			return newPath
		}
	}
	if pathValue != "" {
		return pathValue
	}
	if newPath != "" {
		return newPath
	}
	return oldPath
}

func normalizePatchPath(raw string) (string, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" {
		return "", nil
	}
	if strings.HasPrefix(raw, "/") {
		return "", errors.New("absolute path is not allowed")
	}
	normalized := path.Clean(raw)
	if normalized == "." || normalized == "" {
		return "", nil
	}
	if normalized == ".." || strings.HasPrefix(normalized, "../") {
		return "", errors.New("path escapes repository")
	}
	return normalized, nil
}

func normalizePatchMaxBytes(value int64) int64 {
	if value <= 0 {
		return defaultPatchMaxBytes
	}
	if value > hardPatchMaxBytes {
		return hardPatchMaxBytes
	}
	return value
}

func (s *Service) readCommitPatchBytes(ctx context.Context, repoRoot string, commit string, filePath string, maxBytes int64) ([]byte, bool, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	args := []string{"show", "--format=", "--patch", "--find-renames", "--find-copies", "--no-ext-diff", commit}
	if filePath != "" {
		args = append(args, "--", filePath)
	}
	cmd, err := gitutil.CommandContext(ctx, repoRoot, nil, args...)
	if err != nil {
		return nil, false, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, false, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, false, err
	}

	buf := make([]byte, 32*1024)
	var out bytes.Buffer
	truncated := false
	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			remaining := maxBytes - int64(out.Len())
			if remaining <= 0 {
				truncated = true
				cancel()
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
				break
			}
			if int64(n) > remaining {
				_, _ = out.Write(buf[:remaining])
				truncated = true
				cancel()
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
				break
			}
			_, _ = out.Write(buf[:n])
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			return nil, false, readErr
		}
	}

	waitErr := cmd.Wait()
	if truncated {
		return out.Bytes(), true, nil
	}
	if waitErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = waitErr.Error()
		}
		return nil, false, errors.New(msg)
	}
	return out.Bytes(), false, nil
}

func classifyRepoRPCError(err error) *rpc.Error {
	if err == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	if errors.Is(err, os.ErrNotExist) {
		return &rpc.Error{Code: 404, Message: "not found"}
	}
	message := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(message, "must match worktree root"):
		return &rpc.Error{Code: 400, Message: "invalid repo_root_path"}
	case strings.Contains(message, "not a git repository"):
		return &rpc.Error{Code: 404, Message: "repository not found"}
	default:
		return &rpc.Error{Code: 400, Message: "invalid repo_root_path"}
	}
}

func classifyGitRPCError(err error) *rpc.Error {
	if err == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "unknown revision"):
		return &rpc.Error{Code: 404, Message: "commit not found"}
	case strings.Contains(lower, "bad object"):
		return &rpc.Error{Code: 404, Message: "commit not found"}
	case strings.Contains(lower, "ambiguous argument"):
		return &rpc.Error{Code: 404, Message: "commit not found"}
	case strings.Contains(lower, "pathspec") && strings.Contains(lower, "did not match"):
		return &rpc.Error{Code: 404, Message: "file not found in commit"}
	case strings.Contains(lower, "not a git repository"):
		return &rpc.Error{Code: 404, Message: "repository not found"}
	default:
		return &rpc.Error{Code: 500, Message: message}
	}
}

type resolveRepoReq struct {
	Path string `json:"path"`
}

type resolveRepoResp struct {
	Available    bool   `json:"available"`
	RepoRootPath string `json:"repo_root_path,omitempty"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
	Dirty        bool   `json:"dirty,omitempty"`
}

type listCommitsReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Offset       int    `json:"offset,omitempty"`
	Limit        int    `json:"limit,omitempty"`
}

type listCommitsResp struct {
	RepoRootPath string             `json:"repo_root_path"`
	Commits      []gitCommitSummary `json:"commits"`
	NextOffset   int                `json:"next_offset,omitempty"`
	HasMore      bool               `json:"has_more,omitempty"`
}

type getCommitDetailReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Commit       string `json:"commit"`
}

type getCommitDetailResp struct {
	RepoRootPath string                 `json:"repo_root_path"`
	Commit       gitCommitDetail        `json:"commit"`
	Files        []gitCommitFileSummary `json:"files"`
}

type gitCommitSummary struct {
	Hash         string   `json:"hash"`
	ShortHash    string   `json:"short_hash"`
	Parents      []string `json:"parents,omitempty"`
	AuthorName   string   `json:"author_name,omitempty"`
	AuthorEmail  string   `json:"author_email,omitempty"`
	AuthorTimeMs int64    `json:"author_time_ms,omitempty"`
	Subject      string   `json:"subject,omitempty"`
	BodyPreview  string   `json:"body_preview,omitempty"`
}

type gitCommitDetail struct {
	Hash         string   `json:"hash"`
	ShortHash    string   `json:"short_hash"`
	Parents      []string `json:"parents,omitempty"`
	AuthorName   string   `json:"author_name,omitempty"`
	AuthorEmail  string   `json:"author_email,omitempty"`
	AuthorTimeMs int64    `json:"author_time_ms,omitempty"`
	Subject      string   `json:"subject,omitempty"`
	Body         string   `json:"body,omitempty"`
}

type gitCommitFileSummary struct {
	ChangeType string `json:"change_type,omitempty"`
	Path       string `json:"path,omitempty"`
	OldPath    string `json:"old_path,omitempty"`
	NewPath    string `json:"new_path,omitempty"`
	PatchPath  string `json:"patch_path,omitempty"`
	Additions  int    `json:"additions,omitempty"`
	Deletions  int    `json:"deletions,omitempty"`
	IsBinary   bool   `json:"is_binary,omitempty"`
}

type readCommitPatchReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Commit       string `json:"commit"`
	FilePath     string `json:"file_path,omitempty"`
	MaxBytes     int64  `json:"max_bytes,omitempty"`
}

type readCommitPatchRespMeta struct {
	Ok         bool         `json:"ok"`
	ContentLen int64        `json:"content_len,omitempty"`
	Truncated  bool         `json:"truncated,omitempty"`
	Error      *streamError `json:"error,omitempty"`
}

type streamError struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}
