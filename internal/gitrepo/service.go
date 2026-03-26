package gitrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
	TypeID_GIT_GET_REPO_SUMMARY  uint32 = 1104
	TypeID_GIT_LIST_WORKSPACE    uint32 = 1105
	TypeID_GIT_LIST_BRANCHES     uint32 = 1106
	TypeID_GIT_GET_BRANCH_DIFF   uint32 = 1107
	TypeID_GIT_STAGE_WORKSPACE   uint32 = 1108
	TypeID_GIT_UNSTAGE_WORKSPACE uint32 = 1109
	TypeID_GIT_COMMIT_WORKSPACE  uint32 = 1110
	TypeID_GIT_FETCH_REPO        uint32 = 1111
	TypeID_GIT_PULL_REPO         uint32 = 1112
	TypeID_GIT_PUSH_REPO         uint32 = 1113
	TypeID_GIT_CHECKOUT_BRANCH   uint32 = 1114
	TypeID_GIT_PREVIEW_DELETE    uint32 = 1115
	TypeID_GIT_DELETE_BRANCH     uint32 = 1116
	TypeID_GIT_PREVIEW_MERGE     uint32 = 1117
	TypeID_GIT_MERGE_BRANCH      uint32 = 1118
	TypeID_GIT_DIFF_CONTENT      uint32 = 1119
	TypeID_GIT_SWITCH_DETACHED   uint32 = 1120
	TypeID_GIT_LIST_STASHES      uint32 = 1121
	TypeID_GIT_GET_STASH_DETAIL  uint32 = 1122
	TypeID_GIT_SAVE_STASH        uint32 = 1123
	TypeID_GIT_PREVIEW_APPLY     uint32 = 1124
	TypeID_GIT_APPLY_STASH       uint32 = 1125
	TypeID_GIT_PREVIEW_DROP      uint32 = 1126
	TypeID_GIT_DROP_STASH        uint32 = 1127

	defaultCommitPageSize = 50
	maxCommitPageSize     = 200

	gitUnavailableReason = "Git is not installed or not available in PATH on this agent."
)

var errGitUnavailable = errors.New("git unavailable")

type Service struct {
	agentHomeAbs string
}

func NewService(agentHomeAbs string) *Service {
	resolved, err := pathutil.CanonicalizeExistingDirAbs(agentHomeAbs)
	if err != nil {
		panic(err)
	}
	return &Service{agentHomeAbs: resolved}
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
		result, err := s.resolveRepoForPath(ctx, req.Path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil, &rpc.Error{Code: 404, Message: "not found"}
			}
			return nil, &rpc.Error{Code: 400, Message: "invalid path"}
		}
		if !result.Available {
			return &resolveRepoResp{
				Available:         false,
				GitAvailable:      result.GitAvailable,
				UnavailableReason: result.UnavailableReason,
			}, nil
		}
		return &resolveRepoResp{
			Available:    true,
			GitAvailable: true,
			RepoRootPath: result.Repo.repoRootReal,
			HeadRef:      result.Repo.headRef,
			HeadCommit:   result.Repo.headCommit,
			Dirty:        result.Repo.dirty,
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
		commits, nextOffset, hasMore, err := s.listCommits(ctx, repo, req.Ref, offset, limit)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return &listCommitsResp{
			RepoRootPath: repo.repoRootReal,
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
			RepoRootPath: repo.repoRootReal,
			Commit:       detail,
			Files:        files,
		}, nil
	})

	accessgate.RegisterTyped[getRepoSummaryReq, getRepoSummaryResp](r, TypeID_GIT_GET_REPO_SUMMARY, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getRepoSummaryReq) (*getRepoSummaryResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getRepoSummaryReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		summary, err := s.getRepoSummary(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return summary, nil
	})

	accessgate.RegisterTyped[listWorkspaceChangesReq, listWorkspaceChangesResp](r, TypeID_GIT_LIST_WORKSPACE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listWorkspaceChangesReq) (*listWorkspaceChangesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listWorkspaceChangesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		status, err := s.listWorkspaceChanges(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return status, nil
	})

	accessgate.RegisterTyped[listStashesReq, listStashesResp](r, TypeID_GIT_LIST_STASHES, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listStashesReq) (*listStashesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listStashesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.listStashes(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[getStashDetailReq, getStashDetailResp](r, TypeID_GIT_GET_STASH_DETAIL, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getStashDetailReq) (*getStashDetailResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getStashDetailReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.getStashDetail(ctx, repo, req.ID)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[listBranchesReq, listBranchesResp](r, TypeID_GIT_LIST_BRANCHES, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listBranchesReq) (*listBranchesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listBranchesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		branches, err := s.listBranches(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return branches, nil
	})

	accessgate.RegisterTyped[getBranchCompareReq, getBranchCompareResp](r, TypeID_GIT_GET_BRANCH_DIFF, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getBranchCompareReq) (*getBranchCompareResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getBranchCompareReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		compare, err := s.getBranchCompare(ctx, repo, req.BaseRef, req.TargetRef, req.Limit)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return compare, nil
	})

	accessgate.RegisterTyped[getDiffContentReq, getDiffContentResp](r, TypeID_GIT_DIFF_CONTENT, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getDiffContentReq) (*getDiffContentResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getDiffContentReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		if strings.TrimSpace(req.SourceKind) == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing source kind"}
		}
		if strings.TrimSpace(req.File.Path) == "" && strings.TrimSpace(req.File.OldPath) == "" && strings.TrimSpace(req.File.NewPath) == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing diff file"}
		}
		resp, err := s.getDiffContent(ctx, repo, *req)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[stageWorkspaceReq, stageWorkspaceResp](r, TypeID_GIT_STAGE_WORKSPACE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *stageWorkspaceReq) (*stageWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &stageWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		if err := s.stageWorkspacePaths(ctx, repo, req.Paths); err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return &stageWorkspaceResp{RepoRootPath: repo.repoRootReal}, nil
	})

	accessgate.RegisterTyped[unstageWorkspaceReq, unstageWorkspaceResp](r, TypeID_GIT_UNSTAGE_WORKSPACE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *unstageWorkspaceReq) (*unstageWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &unstageWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		if err := s.unstageWorkspacePaths(ctx, repo, req.Paths); err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return &unstageWorkspaceResp{RepoRootPath: repo.repoRootReal}, nil
	})

	accessgate.RegisterTyped[commitWorkspaceReq, commitWorkspaceResp](r, TypeID_GIT_COMMIT_WORKSPACE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *commitWorkspaceReq) (*commitWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &commitWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.commitWorkspace(ctx, repo, req.Message)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[saveStashReq, saveStashResp](r, TypeID_GIT_SAVE_STASH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *saveStashReq) (*saveStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &saveStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.saveStash(ctx, repo, *req)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[fetchRepoReq, fetchRepoResp](r, TypeID_GIT_FETCH_REPO, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *fetchRepoReq) (*fetchRepoResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &fetchRepoReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.fetchRepo(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[pullRepoReq, pullRepoResp](r, TypeID_GIT_PULL_REPO, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *pullRepoReq) (*pullRepoResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &pullRepoReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.pullRepo(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[pushRepoReq, pushRepoResp](r, TypeID_GIT_PUSH_REPO, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *pushRepoReq) (*pushRepoResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &pushRepoReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.pushRepo(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[checkoutBranchReq, checkoutBranchResp](r, TypeID_GIT_CHECKOUT_BRANCH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *checkoutBranchReq) (*checkoutBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &checkoutBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.checkoutBranch(ctx, repo, req.Name, req.FullName, req.Kind)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[switchDetachedReq, switchDetachedResp](r, TypeID_GIT_SWITCH_DETACHED, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *switchDetachedReq) (*switchDetachedResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &switchDetachedReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.switchDetached(ctx, repo, req.TargetRef)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[previewApplyStashReq, previewApplyStashResp](r, TypeID_GIT_PREVIEW_APPLY, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewApplyStashReq) (*previewApplyStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewApplyStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.previewApplyStash(ctx, repo, req.ID, req.RemoveAfterApply)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[applyStashReq, applyStashResp](r, TypeID_GIT_APPLY_STASH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *applyStashReq) (*applyStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &applyStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.applyStash(ctx, repo, req.ID, req.RemoveAfterApply, req.PlanFingerprint)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[previewDropStashReq, previewDropStashResp](r, TypeID_GIT_PREVIEW_DROP, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewDropStashReq) (*previewDropStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewDropStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.previewDropStash(ctx, repo, req.ID)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[dropStashReq, dropStashResp](r, TypeID_GIT_DROP_STASH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *dropStashReq) (*dropStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &dropStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.dropStash(ctx, repo, req.ID, req.PlanFingerprint)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[previewDeleteBranchReq, previewDeleteBranchResp](r, TypeID_GIT_PREVIEW_DELETE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewDeleteBranchReq) (*previewDeleteBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewDeleteBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.previewDeleteBranch(ctx, repo, req.Name, req.FullName, req.Kind)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[deleteBranchReq, deleteBranchResp](r, TypeID_GIT_DELETE_BRANCH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *deleteBranchReq) (*deleteBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &deleteBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.deleteBranch(
			ctx,
			repo,
			deleteBranchOptions{
				Name:                         req.Name,
				FullName:                     req.FullName,
				Kind:                         req.Kind,
				DeleteMode:                   req.DeleteMode,
				ConfirmBranchName:            req.ConfirmBranchName,
				RemoveLinkedWorktree:         req.RemoveLinkedWorktree,
				DiscardLinkedWorktreeChanges: req.DiscardLinkedWorktreeChanges,
				PlanFingerprint:              req.PlanFingerprint,
			},
		)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[previewMergeBranchReq, previewMergeBranchResp](r, TypeID_GIT_PREVIEW_MERGE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewMergeBranchReq) (*previewMergeBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewMergeBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.previewMergeBranch(ctx, repo, req.Name, req.FullName, req.Kind)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	accessgate.RegisterTyped[mergeBranchReq, mergeBranchResp](r, TypeID_GIT_MERGE_BRANCH, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *mergeBranchReq) (*mergeBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &rpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &mergeBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		resp, err := s.mergeBranch(ctx, repo, req.Name, req.FullName, req.Kind, req.PlanFingerprint)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})
}

type repoContext struct {
	repoRootReal string
	headRef      string
	headCommit   string
	dirty        bool
}

type repoResolveResult struct {
	Repo              repoContext
	Available         bool
	GitAvailable      bool
	UnavailableReason string
}

func (s *Service) resolveRepoForPath(ctx context.Context, path string) (repoResolveResult, error) {
	if strings.TrimSpace(path) == "" {
		path = s.agentHomeAbs
	}
	resolved, err := pathutil.ResolveExistingScopedPath(path, s.agentHomeAbs)
	if err != nil {
		return repoResolveResult{}, err
	}
	stat, err := os.Stat(resolved)
	if err != nil {
		return repoResolveResult{}, err
	}
	targetDir := resolved
	if !stat.IsDir() {
		targetDir = filepath.Dir(resolved)
	}
	repoRootReal, err := resolveGitTopLevel(ctx, targetDir)
	if err != nil {
		if errors.Is(err, errGitUnavailable) {
			return repoResolveResult{
				GitAvailable:      false,
				UnavailableReason: gitUnavailableReason,
			}, nil
		}
		return repoResolveResult{
			GitAvailable:      true,
			UnavailableReason: "Current path is not inside a Git repository.",
		}, nil
	}
	if eval, err := filepath.EvalSymlinks(repoRootReal); err == nil {
		repoRootReal = filepath.Clean(eval)
	}
	withinRoot, err := pathutil.IsWithinScope(repoRootReal, s.agentHomeAbs)
	if err != nil {
		return repoResolveResult{}, err
	}
	if !withinRoot {
		return repoResolveResult{
			GitAvailable:      true,
			UnavailableReason: "Current path is not inside a Git repository.",
		}, nil
	}
	repo, err := s.loadRepoContext(ctx, repoRootReal)
	if err != nil {
		return repoResolveResult{}, err
	}
	return repoResolveResult{
		Repo:         repo,
		Available:    true,
		GitAvailable: true,
	}, nil
}

func (s *Service) resolveExplicitRepo(ctx context.Context, repoRootPath string) (repoContext, error) {
	repoRootReal, err := s.validateRepoRootPath(ctx, repoRootPath)
	if err != nil {
		return repoContext{}, err
	}
	return s.loadRepoContext(ctx, repoRootReal)
}

func (s *Service) validateRepoRootPath(ctx context.Context, repoRootPath string) (string, error) {
	repoRootReal := filepath.Clean(strings.TrimSpace(repoRootPath))
	if repoRootReal == "" {
		return "", errors.New("missing repo_root_path")
	}
	stat, err := os.Stat(repoRootReal)
	if err != nil {
		return "", err
	}
	if !stat.IsDir() {
		return "", errors.New("repo root must be a directory")
	}
	if eval, err := filepath.EvalSymlinks(repoRootReal); err == nil {
		repoRootReal = filepath.Clean(eval)
	}
	withinRoot, err := pathutil.IsWithinScope(repoRootReal, s.agentHomeAbs)
	if err != nil {
		return "", err
	}
	if !withinRoot {
		return "", errors.New("path escapes root")
	}
	topLevel, err := resolveGitTopLevel(ctx, repoRootReal)
	if err != nil {
		if errors.Is(err, errGitUnavailable) {
			return "", err
		}
		return "", errors.New("not a git repository")
	}
	if filepath.Clean(topLevel) != filepath.Clean(repoRootReal) {
		return "", errors.New("repo_root_path must match worktree root")
	}
	return repoRootReal, nil
}

func resolveGitTopLevel(ctx context.Context, dir string) (string, error) {
	topLevel, err := gitutil.ResolveTopLevel(ctx, dir)
	if err != nil {
		if gitutil.IsGitUnavailable(err) {
			return "", errGitUnavailable
		}
		return "", err
	}
	return topLevel, nil
}

func (s *Service) loadRepoContext(ctx context.Context, repoRootReal string) (repoContext, error) {
	headRef := strings.TrimSpace(readGitOptional(ctx, repoRootReal, "symbolic-ref", "--quiet", "--short", "HEAD"))
	if headRef == "" {
		headRef = strings.TrimSpace(readGitOptional(ctx, repoRootReal, "rev-parse", "--abbrev-ref", "HEAD"))
	}
	headCommit := strings.TrimSpace(readGitOptional(ctx, repoRootReal, "rev-parse", "--verify", "HEAD"))
	dirtyRaw := readGitOptional(ctx, repoRootReal, "status", "--porcelain", "--untracked-files=normal")
	return repoContext{
		repoRootReal: repoRootReal,
		headRef:      headRef,
		headCommit:   headCommit,
		dirty:        strings.TrimSpace(dirtyRaw) != "",
	}, nil
}

func readGitOptional(ctx context.Context, repoRoot string, args ...string) string {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, args...)
	if err != nil {
		return ""
	}
	return string(out)
}

func (s *Service) listCommits(ctx context.Context, repo repoContext, ref string, offset int, limit int) ([]gitCommitSummary, int, bool, error) {
	resolvedRef, err := normalizeGitRefOrDefault(ref, "HEAD")
	if err != nil {
		return nil, 0, false, err
	}
	if strings.TrimSpace(repo.headCommit) == "" && resolvedRef == "HEAD" {
		return nil, 0, false, nil
	}
	format := "%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b%x1e"
	out, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil,
		"log",
		"--date-order",
		"--max-count="+strconv.Itoa(limit+1),
		"--skip="+strconv.Itoa(offset),
		"--format="+format,
		resolvedRef,
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
	files, err := s.readGitDiffMetadata(ctx, repo.repoRootReal,
		[]string{
			"show",
			"--format=",
			"--name-status",
			"-z",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			"--root",
			commit,
		},
		[]string{
			"show",
			"--format=",
			"--numstat",
			"-z",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			"--root",
			commit,
		},
	)
	if err != nil {
		return gitCommitDetail{}, nil, err
	}
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

func classifyRepoRPCError(err error) *rpc.Error {
	if err == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	if errors.Is(err, errGitUnavailable) {
		return &rpc.Error{Code: 503, Message: gitUnavailableReason}
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
	if errors.Is(err, errGitUnavailable) || gitutil.IsGitUnavailable(err) {
		return &rpc.Error{Code: 503, Message: gitUnavailableReason}
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
	case strings.Contains(lower, "invalid git path"):
		return &rpc.Error{Code: 400, Message: "invalid path"}
	case strings.Contains(lower, "invalid source kind"):
		return &rpc.Error{Code: 400, Message: "invalid source kind"}
	case strings.Contains(lower, "missing source kind"):
		return &rpc.Error{Code: 400, Message: "missing source kind"}
	case strings.Contains(lower, "missing workspace section"):
		return &rpc.Error{Code: 400, Message: "missing workspace section"}
	case strings.Contains(lower, "missing commit"):
		return &rpc.Error{Code: 400, Message: "missing commit"}
	case strings.Contains(lower, "missing diff file"):
		return &rpc.Error{Code: 400, Message: "missing diff file"}
	case strings.Contains(lower, "missing ref"):
		return &rpc.Error{Code: 400, Message: "missing ref"}
	case strings.Contains(lower, "stash id is required"):
		return &rpc.Error{Code: 400, Message: "stash id is required"}
	case strings.Contains(lower, "stash not found"):
		return &rpc.Error{Code: 404, Message: "stash not found"}
	case strings.Contains(lower, "file not found in diff"):
		return &rpc.Error{Code: 404, Message: "file not found in diff"}
	case strings.Contains(lower, "not a git repository"):
		return &rpc.Error{Code: 404, Message: "repository not found"}
	default:
		return &rpc.Error{Code: 500, Message: message}
	}
}

func classifyGitMutationRPCError(err error) *rpc.Error {
	if err == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "commit message is required"):
		return &rpc.Error{Code: 400, Message: "commit message is required"}
	case strings.Contains(lower, "no staged changes to commit"):
		return &rpc.Error{Code: 400, Message: "no staged changes to commit"}
	case strings.Contains(lower, "no local changes to stash"):
		return &rpc.Error{Code: 400, Message: "no local changes to stash"}
	case strings.Contains(lower, "cannot unstage before the first commit"):
		return &rpc.Error{Code: 400, Message: "cannot unstage before the first commit"}
	case strings.Contains(lower, "invalid git path"):
		return &rpc.Error{Code: 400, Message: "invalid path"}
	case strings.Contains(lower, "please tell me who you are"):
		return &rpc.Error{Code: 400, Message: "git user.name and user.email are required before committing"}
	case strings.Contains(lower, "unable to auto-detect email address"):
		return &rpc.Error{Code: 400, Message: "git user.name and user.email are required before committing"}
	case strings.Contains(lower, "nothing to commit"):
		return &rpc.Error{Code: 400, Message: "no staged changes to commit"}
	case strings.Contains(lower, "target branch does not exist"):
		return &rpc.Error{Code: 404, Message: "target branch does not exist"}
	case strings.Contains(lower, "target commit does not exist"):
		return &rpc.Error{Code: 404, Message: "target commit does not exist"}
	case strings.Contains(lower, "remote branches cannot be deleted here"):
		return &rpc.Error{Code: 400, Message: "remote branches cannot be deleted here"}
	case strings.Contains(lower, "cannot delete the current branch"):
		return &rpc.Error{Code: 400, Message: "cannot delete the current branch"}
	case strings.Contains(lower, "invalid delete mode"):
		return &rpc.Error{Code: 400, Message: "invalid delete mode"}
	case strings.Contains(lower, "delete plan fingerprint is required"):
		return &rpc.Error{Code: 400, Message: "delete plan fingerprint is required"}
	case strings.Contains(lower, "branch name confirmation does not match"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "delete plan is stale"):
		return &rpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "merge plan fingerprint is required"):
		return &rpc.Error{Code: 400, Message: "merge plan fingerprint is required"}
	case strings.Contains(lower, "merge plan is stale"):
		return &rpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "stash apply plan fingerprint is required"):
		return &rpc.Error{Code: 400, Message: "stash apply plan fingerprint is required"}
	case strings.Contains(lower, "stash apply plan is stale"):
		return &rpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "stash drop plan fingerprint is required"):
		return &rpc.Error{Code: 400, Message: "stash drop plan fingerprint is required"}
	case strings.Contains(lower, "stash drop plan is stale"):
		return &rpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "linked worktree removal must be confirmed"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "discard confirmation is required"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "not accessible from this agent"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "attach head to a local branch before merging"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "select a different branch to merge"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current workspace must be clean before merging"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current workspace must be clean before applying a stash"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current workspace must be clean before switching to detached head"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "finish the current"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "unrelated histories support"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "target branch does not have a readable head commit"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current files would be overwritten by this stash"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "this stash cannot be applied cleanly on the current head"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "merge is blocked"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "checked out in worktree"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "checked out at"):
		return &rpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "not fully merged"):
		return &rpc.Error{Code: 400, Message: message}
	default:
		return classifyGitRPCError(err)
	}
}

type resolveRepoReq struct {
	Path string `json:"path"`
}

type resolveRepoResp struct {
	Available         bool   `json:"available"`
	GitAvailable      bool   `json:"git_available"`
	UnavailableReason string `json:"unavailable_reason,omitempty"`
	RepoRootPath      string `json:"repo_root_path,omitempty"`
	HeadRef           string `json:"head_ref,omitempty"`
	HeadCommit        string `json:"head_commit,omitempty"`
	Dirty             bool   `json:"dirty,omitempty"`
}

type listCommitsReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Ref          string `json:"ref,omitempty"`
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

type stageWorkspaceReq struct {
	RepoRootPath string   `json:"repo_root_path"`
	Paths        []string `json:"paths,omitempty"`
}

type stageWorkspaceResp struct {
	RepoRootPath string `json:"repo_root_path"`
}

type unstageWorkspaceReq struct {
	RepoRootPath string   `json:"repo_root_path"`
	Paths        []string `json:"paths,omitempty"`
}

type unstageWorkspaceResp struct {
	RepoRootPath string `json:"repo_root_path"`
}

type commitWorkspaceReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Message      string `json:"message"`
}

type commitWorkspaceResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
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
