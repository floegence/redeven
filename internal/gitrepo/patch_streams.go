package gitrepo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/framing/jsonframe"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/gitutil"
	"github.com/floegence/redeven-agent/internal/session"
)

func (s *Service) ServeReadWorkspacePatchStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta) {
	s.ServeReadWorkspacePatchStreamWithAccessGate(ctx, stream, meta, nil)
}

func (s *Service) ServeReadWorkspacePatchStreamWithAccessGate(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, gate *accessgate.Gate) {
	if stream == nil {
		return
	}
	defer func() { _ = stream.Close() }()
	if err := accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected); err != nil {
		writePatchAccessError(stream, err)
		return
	}
	reqBytes, err := jsonframe.ReadJSONFrame(stream, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		return
	}
	var req readWorkspacePatchReq
	if err := json.Unmarshal(reqBytes, &req); err != nil {
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{Ok: false, Error: &streamError{Code: 400, Message: "invalid request"}})
		return
	}
	repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
	if err != nil {
		writePatchStreamError(stream, classifyRepoRPCError(err))
		return
	}
	section := strings.TrimSpace(req.Section)
	filePath, err := normalizePatchPath(req.FilePath)
	if err != nil {
		writePatchStreamError(stream, &rpc.Error{Code: 400, Message: "invalid file_path"})
		return
	}
	maxBytes := normalizePatchMaxBytes(req.MaxBytes)
	args, err := workspacePatchArgs(section, filePath)
	if err != nil {
		writePatchStreamError(stream, &rpc.Error{Code: 400, Message: err.Error()})
		return
	}
	patchBytes, truncated, err := readPatchBytesWithArgs(ctx, repo.repoRootReal, maxBytes, args...)
	if err != nil {
		writePatchStreamError(stream, classifyGitRPCError(err))
		return
	}
	writePatchStreamPayload(stream, patchBytes, truncated)
}

func (s *Service) ServeReadComparePatchStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta) {
	s.ServeReadComparePatchStreamWithAccessGate(ctx, stream, meta, nil)
}

func (s *Service) ServeReadComparePatchStreamWithAccessGate(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, gate *accessgate.Gate) {
	if stream == nil {
		return
	}
	defer func() { _ = stream.Close() }()
	if err := accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected); err != nil {
		writePatchAccessError(stream, err)
		return
	}
	reqBytes, err := jsonframe.ReadJSONFrame(stream, jsonframe.DefaultMaxJSONFrameBytes)
	if err != nil {
		return
	}
	var req readComparePatchReq
	if err := json.Unmarshal(reqBytes, &req); err != nil {
		_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{Ok: false, Error: &streamError{Code: 400, Message: "invalid request"}})
		return
	}
	repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
	if err != nil {
		writePatchStreamError(stream, classifyRepoRPCError(err))
		return
	}
	baseRef, err := normalizeGitRef(req.BaseRef)
	if err != nil {
		writePatchStreamError(stream, &rpc.Error{Code: 400, Message: "invalid base_ref"})
		return
	}
	targetRef, err := normalizeGitRef(req.TargetRef)
	if err != nil {
		writePatchStreamError(stream, &rpc.Error{Code: 400, Message: "invalid target_ref"})
		return
	}
	filePath, err := normalizePatchPath(req.FilePath)
	if err != nil {
		writePatchStreamError(stream, &rpc.Error{Code: 400, Message: "invalid file_path"})
		return
	}
	maxBytes := normalizePatchMaxBytes(req.MaxBytes)
	args := []string{"diff", "--patch", "--find-renames", "--find-copies", "--no-ext-diff", baseRef + "..." + targetRef}
	if filePath != "" {
		args = append(args, "--", filePath)
	}
	patchBytes, truncated, err := readPatchBytesWithArgs(ctx, repo.repoRootReal, maxBytes, args...)
	if err != nil {
		writePatchStreamError(stream, classifyGitRPCError(err))
		return
	}
	writePatchStreamPayload(stream, patchBytes, truncated)
}

func workspacePatchArgs(section string, filePath string) ([]string, error) {
	base := []string{"diff", "--patch", "--find-renames", "--find-copies", "--no-ext-diff"}
	switch section {
	case "staged":
		base = append(base, "--cached")
	case "unstaged":
	case "conflicted":
		base = append(base, "--cc")
	default:
		return nil, errors.New("invalid section")
	}
	if filePath != "" {
		base = append(base, "--", filePath)
	}
	return base, nil
}

func writePatchAccessError(stream io.Writer, err error) {
	rpcErr, _ := err.(*rpc.Error)
	code := 423
	message := "access password required"
	if rpcErr != nil {
		code = int(rpcErr.Code)
		if strings.TrimSpace(rpcErr.Message) != "" {
			message = rpcErr.Message
		}
	}
	_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{Ok: false, Error: &streamError{Code: code, Message: message}})
}

func writePatchStreamError(stream io.Writer, rpcErr *rpc.Error) {
	if rpcErr == nil {
		rpcErr = &rpc.Error{Code: 500, Message: "internal error"}
	}
	_ = jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{Ok: false, Error: &streamError{Code: int(rpcErr.Code), Message: rpcErr.Message}})
}

func writePatchStreamPayload(stream io.Writer, patchBytes []byte, truncated bool) {
	if err := jsonframe.WriteJSONFrame(stream, readCommitPatchRespMeta{Ok: true, ContentLen: int64(len(patchBytes)), Truncated: truncated}); err != nil {
		return
	}
	if len(patchBytes) == 0 {
		return
	}
	_, _ = stream.Write(patchBytes)
}

func readPatchBytesWithArgs(ctx context.Context, repoRoot string, maxBytes int64, args ...string) ([]byte, bool, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
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
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = waitErr.Error()
		}
		return nil, false, errors.New(message)
	}
	return out.Bytes(), false, nil
}
