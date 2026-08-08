package gitrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/floegence/redeven/internal/gitutil"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

const (
	TypeID_GIT_RESOLVE_REPO        uint32 = 1101
	TypeID_GIT_LIST_COMMITS        uint32 = 1102
	TypeID_GIT_GET_COMMIT_DETAIL   uint32 = 1103
	TypeID_GIT_GET_REPO_SUMMARY    uint32 = 1104
	TypeID_GIT_LIST_WORKSPACE      uint32 = 1105
	TypeID_GIT_LIST_BRANCHES       uint32 = 1106
	TypeID_GIT_GET_BRANCH_DIFF     uint32 = 1107
	TypeID_GIT_STAGE_WORKSPACE     uint32 = 1108
	TypeID_GIT_UNSTAGE_WORKSPACE   uint32 = 1109
	TypeID_GIT_COMMIT_WORKSPACE    uint32 = 1110
	TypeID_GIT_FETCH_REPO          uint32 = 1111
	TypeID_GIT_PULL_REPO           uint32 = 1112
	TypeID_GIT_PUSH_REPO           uint32 = 1113
	TypeID_GIT_CHECKOUT_BRANCH     uint32 = 1114
	TypeID_GIT_PREVIEW_DELETE      uint32 = 1115
	TypeID_GIT_DELETE_BRANCH       uint32 = 1116
	TypeID_GIT_PREVIEW_MERGE       uint32 = 1117
	TypeID_GIT_MERGE_BRANCH        uint32 = 1118
	TypeID_GIT_DIFF_CONTENT        uint32 = 1119
	TypeID_GIT_SWITCH_DETACHED     uint32 = 1120
	TypeID_GIT_LIST_STASHES        uint32 = 1121
	TypeID_GIT_GET_STASH_DETAIL    uint32 = 1122
	TypeID_GIT_SAVE_STASH          uint32 = 1123
	TypeID_GIT_PREVIEW_APPLY       uint32 = 1124
	TypeID_GIT_APPLY_STASH         uint32 = 1125
	TypeID_GIT_PREVIEW_DROP        uint32 = 1126
	TypeID_GIT_DROP_STASH          uint32 = 1127
	TypeID_GIT_LIST_WORKSPACE_PAGE uint32 = 1128
	TypeID_GIT_DISCARD_WORKSPACE   uint32 = 1129
	TypeID_GIT_GET_CAPABILITIES    uint32 = 1130
	TypeID_GIT_LIST_PATH_STATUSES  uint32 = 1131

	defaultCommitPageSize = 50
	maxCommitPageSize     = 200

	gitUnavailableReason = "Git is not installed or not available in PATH on this runtime host."
)

var errGitUnavailable = errors.New("git unavailable")

type Service struct {
	scope          *filesystemscope.Registry
	workspaceStore *workspaceSnapshotStore
	runtime        *gitruntime.Runtime
	runtimeSession *gitruntime.Session
	captureMu      sync.Mutex
	captures       map[string]*workspaceCaptureCall
}

func NewService(agentHomeAbs string) *Service {
	scope, err := filesystemscope.NewDefaultRegistry(agentHomeAbs)
	if err != nil {
		panic(err)
	}
	return NewServiceWithScopeAndRuntime(scope, gitruntime.New())
}

func NewServiceWithScope(scope *filesystemscope.Registry) *Service {
	if scope == nil {
		panic("nil filesystem scope")
	}
	return NewServiceWithScopeAndRuntime(scope, gitruntime.New())
}

func NewServiceWithScopeAndRuntime(scope *filesystemscope.Registry, runtime *gitruntime.Runtime) *Service {
	if scope == nil {
		panic("nil filesystem scope")
	}
	if runtime == nil {
		panic("nil git runtime")
	}
	return &Service{
		scope:          scope,
		workspaceStore: newWorkspaceSnapshotStore(),
		runtime:        runtime,
		runtimeSession: runtime.NewSession(),
		captures:       make(map[string]*workspaceCaptureCall),
	}
}

func (s *Service) Close() {
	if s == nil {
		return
	}
	s.workspaceStore.close()
	if s.runtimeSession != nil {
		s.runtimeSession.Close()
	}
}

func (s *Service) acquireRepoMutation(ctx context.Context, repo repoContext) (context.Context, func(), error) {
	identity := repo.identity
	if identity.WorktreeKey == "" {
		resolved, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, repo.repoRootReal)
		if err != nil {
			return ctx, nil, err
		}
		if !ok {
			return ctx, nil, errors.New("not a git repository")
		}
		identity = resolved
	}
	lease, err := s.runtime.AcquireMutation(ctx, identity)
	if err != nil {
		return ctx, nil, err
	}
	s.workspaceStore.invalidate(identity.WorktreeKey)
	return lease.Context(ctx), func() {
		s.workspaceStore.invalidate(identity.WorktreeKey)
		lease.Release()
	}, nil
}

type repoReadLeaseContext struct {
	commonRepoKey string
	epoch         uint64
}

type repoReadLeaseContextKey struct{}

func (s *Service) acquireRepoRead(ctx context.Context, repo repoContext) (context.Context, func(), error) {
	identity := repo.identity
	if identity.WorktreeKey == "" {
		resolved, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, repo.repoRootReal)
		if err != nil {
			return ctx, nil, err
		}
		if !ok {
			return ctx, nil, errors.New("not a git repository")
		}
		identity = resolved
	}
	lease, err := s.runtime.AcquireRead(ctx, identity)
	if err != nil {
		return ctx, nil, err
	}
	leaseCtx := lease.Context(ctx)
	leaseCtx = context.WithValue(leaseCtx, repoReadLeaseContextKey{}, repoReadLeaseContext{commonRepoKey: identity.CommonRepoKey, epoch: lease.Epoch()})
	return leaseCtx, lease.Release, nil
}

func repoReadEpochFromContext(ctx context.Context, identity gitruntime.RepositoryIdentity) (uint64, bool) {
	lease, ok := ctx.Value(repoReadLeaseContextKey{}).(repoReadLeaseContext)
	return lease.epoch, ok && lease.commonRepoKey == identity.CommonRepoKey
}

func (s *Service) Register(r *sessionrpc.Router, meta *session.Meta) {
	s.RegisterWithAccessGate(r, meta, nil)
}

func (s *Service) RegisterWithAccessGate(r *sessionrpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	if r == nil || s == nil {
		return
	}

	registerGitTyped[resolveRepoReq, resolveRepoResp](r, TypeID_GIT_RESOLVE_REPO, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *resolveRepoReq) (*resolveRepoResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &resolveRepoReq{}
		}
		result, err := s.resolveRepoForPath(ctx, req.Path)
		if err != nil {
			return nil, classifyRepoRPCError(err)
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

	registerGitTyped[listCommitsReq, listCommitsResp](r, TypeID_GIT_LIST_COMMITS, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listCommitsReq) (*listCommitsResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listCommitsReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
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

	registerGitTyped[getCommitDetailReq, getCommitDetailResp](r, TypeID_GIT_GET_COMMIT_DETAIL, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getCommitDetailReq) (*getCommitDetailResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getCommitDetailReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		commit := strings.TrimSpace(req.Commit)
		if commit == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "missing commit"}
		}
		detail, presentation, files, err := s.getCommitDetail(ctx, repo, commit)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return &getCommitDetailResp{
			RepoRootPath: repo.repoRootReal,
			Commit:       detail,
			Presentation: presentation,
			Files:        files,
		}, nil
	})

	registerGitTyped[getRepoSummaryReq, getRepoSummaryResp](r, TypeID_GIT_GET_REPO_SUMMARY, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getRepoSummaryReq) (*getRepoSummaryResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getRepoSummaryReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		summary, err := s.getRepoSummary(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return summary, nil
	})

	registerGitTyped[listWorkspaceChangesReq, listWorkspaceChangesResp](r, TypeID_GIT_LIST_WORKSPACE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listWorkspaceChangesReq) (*listWorkspaceChangesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listWorkspaceChangesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		status, err := s.listWorkspaceChanges(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		if !workspaceBusinessResponseFits(status) {
			return nil, classifyGitRPCError(errWorkspacePaginationRequired)
		}
		return status, nil
	})

	registerGitTyped[listWorkspacePageReq, listWorkspacePageResp](r, TypeID_GIT_LIST_WORKSPACE_PAGE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listWorkspacePageReq) (*listWorkspacePageResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listWorkspacePageReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		resp, err := s.listWorkspacePage(ctx, repo, req.Section, req.DirectoryPath, req.Offset, req.Limit, req.ExpectedWorkspaceRevision)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		if !workspaceBusinessResponseFits(resp) {
			return nil, classifyGitRPCError(errWorkspaceResponseBudget)
		}
		return resp, nil
	})

	registerGitTyped[listStashesReq, listStashesResp](r, TypeID_GIT_LIST_STASHES, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listStashesReq) (*listStashesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listStashesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		resp, err := s.listStashes(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[getStashDetailReq, getStashDetailResp](r, TypeID_GIT_GET_STASH_DETAIL, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getStashDetailReq) (*getStashDetailResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getStashDetailReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		resp, err := s.getStashDetail(ctx, repo, req.ID)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[listBranchesReq, listBranchesResp](r, TypeID_GIT_LIST_BRANCHES, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *listBranchesReq) (*listBranchesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listBranchesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		branches, err := s.listBranches(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return branches, nil
	})

	registerGitTyped[getBranchCompareReq, getBranchCompareResp](r, TypeID_GIT_GET_BRANCH_DIFF, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getBranchCompareReq) (*getBranchCompareResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getBranchCompareReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		compare, err := s.getBranchCompare(ctx, repo, req.BaseRef, req.TargetRef, req.Limit)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return compare, nil
	})

	registerGitTyped[getDiffContentReq, getDiffContentResp](r, TypeID_GIT_DIFF_CONTENT, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getDiffContentReq) (*getDiffContentResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &getDiffContentReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		if strings.TrimSpace(req.SourceKind) == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "missing source kind"}
		}
		if req.File.Path == "" && req.File.OldPath == "" && req.File.NewPath == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "missing diff file"}
		}
		resp, err := s.getDiffContent(ctx, repo, *req)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[stageWorkspaceReq, stageWorkspaceResp](r, TypeID_GIT_STAGE_WORKSPACE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *stageWorkspaceReq) (*stageWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &stageWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		result, err := s.stageWorkspace(ctx, repo, workspaceMutationSelection{
			Section:       req.Section,
			DirectoryPath: req.DirectoryPath,
			Paths:         req.Paths,
		})
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return &stageWorkspaceResp{
			RepoRootPath: repo.repoRootReal,
			Result:       result,
		}, nil
	})

	registerGitTyped[unstageWorkspaceReq, unstageWorkspaceResp](r, TypeID_GIT_UNSTAGE_WORKSPACE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *unstageWorkspaceReq) (*unstageWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &unstageWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		result, err := s.unstageWorkspace(ctx, repo, workspaceMutationSelection{
			Section:       req.Section,
			DirectoryPath: req.DirectoryPath,
			Paths:         req.Paths,
		})
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return &unstageWorkspaceResp{
			RepoRootPath: repo.repoRootReal,
			Result:       result,
		}, nil
	})

	registerGitTyped[discardWorkspaceReq, discardWorkspaceResp](r, TypeID_GIT_DISCARD_WORKSPACE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *discardWorkspaceReq) (*discardWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &discardWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		result, err := s.discardWorkspace(ctx, repo, workspaceMutationSelection{
			Section:       req.Section,
			DirectoryPath: req.DirectoryPath,
			Paths:         req.Paths,
		})
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return &discardWorkspaceResp{
			RepoRootPath: repo.repoRootReal,
			Result:       result,
		}, nil
	})

	registerGitTyped[commitWorkspaceReq, commitWorkspaceResp](r, TypeID_GIT_COMMIT_WORKSPACE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *commitWorkspaceReq) (*commitWorkspaceResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &commitWorkspaceReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.commitWorkspace(ctx, repo, req.Message)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[saveStashReq, saveStashResp](r, TypeID_GIT_SAVE_STASH, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *saveStashReq) (*saveStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &saveStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.saveStash(ctx, repo, *req)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[fetchRepoReq, fetchRepoResp](r, TypeID_GIT_FETCH_REPO, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *fetchRepoReq) (*fetchRepoResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &fetchRepoReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.fetchRepo(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[pullRepoReq, pullRepoResp](r, TypeID_GIT_PULL_REPO, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *pullRepoReq) (*pullRepoResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &pullRepoReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.pullRepo(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[pushRepoReq, pushRepoResp](r, TypeID_GIT_PUSH_REPO, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *pushRepoReq) (*pushRepoResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &pushRepoReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.pushRepo(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[checkoutBranchReq, checkoutBranchResp](r, TypeID_GIT_CHECKOUT_BRANCH, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *checkoutBranchReq) (*checkoutBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &checkoutBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.checkoutBranch(ctx, repo, req.Name, req.FullName, req.Kind)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[switchDetachedReq, switchDetachedResp](r, TypeID_GIT_SWITCH_DETACHED, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *switchDetachedReq) (*switchDetachedResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &switchDetachedReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.switchDetached(ctx, repo, req.TargetRef)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[previewApplyStashReq, previewApplyStashResp](r, TypeID_GIT_PREVIEW_APPLY, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewApplyStashReq) (*previewApplyStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewApplyStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseRead()
		resp, err := s.previewApplyStash(ctx, repo, req.ID, req.RemoveAfterApply)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[applyStashReq, applyStashResp](r, TypeID_GIT_APPLY_STASH, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *applyStashReq) (*applyStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &applyStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.applyStash(ctx, repo, req.ID, req.RemoveAfterApply, req.PlanFingerprint)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[previewDropStashReq, previewDropStashResp](r, TypeID_GIT_PREVIEW_DROP, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewDropStashReq) (*previewDropStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewDropStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseRead()
		resp, err := s.previewDropStash(ctx, repo, req.ID)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[dropStashReq, dropStashResp](r, TypeID_GIT_DROP_STASH, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *dropStashReq) (*dropStashResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &dropStashReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.dropStash(ctx, repo, req.ID, req.PlanFingerprint)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[previewDeleteBranchReq, previewDeleteBranchResp](r, TypeID_GIT_PREVIEW_DELETE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewDeleteBranchReq) (*previewDeleteBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewDeleteBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseRead()
		resp, err := s.previewDeleteBranch(ctx, repo, req.Name, req.FullName, req.Kind)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[deleteBranchReq, deleteBranchResp](r, TypeID_GIT_DELETE_BRANCH, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *deleteBranchReq) (*deleteBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &deleteBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		readCtx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		topologyPaths, err := s.deleteBranchTopologyPaths(readCtx, repo, req.Name, req.FullName, req.Kind)
		releaseRead()
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		options := deleteBranchOptions{
			Name:                         req.Name,
			FullName:                     req.FullName,
			Kind:                         req.Kind,
			DeleteMode:                   req.DeleteMode,
			ConfirmBranchName:            req.ConfirmBranchName,
			RemoveLinkedWorktree:         req.RemoveLinkedWorktree,
			DiscardLinkedWorktreeChanges: req.DiscardLinkedWorktreeChanges,
			PlanFingerprint:              req.PlanFingerprint,
		}
		var resp *deleteBranchResp
		s.workspaceStore.invalidate(repo.identity.WorktreeKey)
		err = s.runtime.CoordinateTopologyMutation(ctx, gitruntime.FilesystemEffect{
			Paths:           topologyPaths,
			ChangesTopology: true,
		}, func(lockedCtx context.Context) error {
			lockedRepo, loadErr := s.loadRepoContext(lockedCtx, repo.repoRootReal)
			if loadErr != nil {
				return loadErr
			}
			lockedPaths, pathsErr := s.deleteBranchTopologyPaths(lockedCtx, lockedRepo, req.Name, req.FullName, req.Kind)
			if pathsErr != nil {
				return pathsErr
			}
			if !sameDeleteBranchTopologyPaths(topologyPaths, lockedPaths) {
				return gitruntime.ErrResourceLimit
			}
			var deleteErr error
			resp, deleteErr = s.deleteBranch(lockedCtx, lockedRepo, options)
			return deleteErr
		})
		s.workspaceStore.invalidate(repo.identity.WorktreeKey)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[previewMergeBranchReq, previewMergeBranchResp](r, TypeID_GIT_PREVIEW_MERGE, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *previewMergeBranchReq) (*previewMergeBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &previewMergeBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseRead()
		resp, err := s.previewMergeBranch(ctx, repo, req.Name, req.FullName, req.Kind)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[mergeBranchReq, mergeBranchResp](r, TypeID_GIT_MERGE_BRANCH, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *mergeBranchReq) (*mergeBranchResp, error) {
		if meta == nil || !meta.CanWrite {
			return nil, &sessionrpc.Error{Code: 403, Message: "write permission denied"}
		}
		if req == nil {
			req = &mergeBranchReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseMutation, err := s.acquireRepoMutation(ctx, repo)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		defer releaseMutation()
		resp, err := s.mergeBranch(ctx, repo, req.Name, req.FullName, req.Kind, req.PlanFingerprint)
		if err != nil {
			return nil, classifyGitMutationRPCError(err)
		}
		return resp, nil
	})

	registerGitTyped[getCapabilitiesReq, getCapabilitiesResp](r, TypeID_GIT_GET_CAPABILITIES, s.runtime, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *getCapabilitiesReq) (*getCapabilitiesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		return &getCapabilitiesResp{
			WorkspaceRevisionV1:       true,
			WorkspacePathStatusV1:     true,
			WorkspaceDirectoryScopeV1: true,
			StashSectionDiffV1:        true,
		}, nil
	})

	registerGitPathStatusTyped(r, s.runtime, gate, meta, func(ctx context.Context, req *listWorkspacePathStatusesReq) (*listWorkspacePathStatusesResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &sessionrpc.Error{Code: 403, Message: "read permission denied"}
		}
		if req == nil {
			req = &listWorkspacePathStatusesReq{}
		}
		repo, err := s.resolveExplicitRepo(ctx, req.RepoRootPath)
		if err != nil {
			return nil, classifyRepoRPCError(err)
		}
		ctx, releaseRead, err := s.acquireRepoRead(ctx, repo)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		defer releaseRead()
		resp, err := s.listWorkspacePathStatuses(ctx, repo, req.Paths, req.ExpectedWorkspaceRevision)
		if err != nil {
			return nil, classifyGitRPCError(err)
		}
		if !workspaceBusinessResponseFits(resp) {
			return nil, classifyGitRPCError(errWorkspaceResponseBudget)
		}
		return resp, nil
	})
}

type repoContext struct {
	repoRootReal string
	headRef      string
	headCommit   string
	dirty        bool
	identity     gitruntime.RepositoryIdentity
}

type repoResolveResult struct {
	Repo              repoContext
	Available         bool
	GitAvailable      bool
	UnavailableReason string
}

func (s *Service) resolveRepoForPath(ctx context.Context, path string) (repoResolveResult, error) {
	if strings.TrimSpace(path) == "" {
		path = s.scope.DefaultRootPath()
	}
	resolved, err := s.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true})
	if err != nil {
		return repoResolveResult{}, err
	}
	stat, err := os.Stat(resolved.RealAbs)
	if err != nil {
		return repoResolveResult{}, err
	}
	targetDir := resolved.RealAbs
	if !stat.IsDir() {
		targetDir = filepath.Dir(resolved.RealAbs)
	}
	identity, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, targetDir)
	if err != nil {
		if gitutil.IsGitUnavailable(err) {
			return repoResolveResult{
				GitAvailable:      false,
				UnavailableReason: gitUnavailableReason,
			}, nil
		}
		return repoResolveResult{}, err
	}
	if !ok {
		return repoResolveResult{
			GitAvailable:      true,
			UnavailableReason: "Current path is not inside a Git repository.",
		}, nil
	}
	repoRootReal := identity.WorktreeRoot
	if _, ok := s.scope.Contains(repoRootReal); !ok {
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
	if strings.TrimSpace(repoRootPath) == "" {
		return "", errors.New("missing repo_root_path")
	}
	resolved, err := s.scope.Resolve(repoRootPath, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		return "", err
	}
	repoRootReal := resolved.RealAbs
	stat, err := os.Stat(repoRootReal)
	if err != nil {
		return "", err
	}
	if !stat.IsDir() {
		return "", errors.New("repo root must be a directory")
	}
	identity, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, repoRootReal)
	if err != nil {
		if gitutil.IsGitUnavailable(err) {
			return "", errGitUnavailable
		}
		return "", err
	}
	if !ok {
		return "", errors.New("not a git repository")
	}
	if filepath.Clean(identity.WorktreeRoot) != filepath.Clean(repoRootReal) {
		return "", errors.New("repo_root_path must match worktree root")
	}
	return repoRootReal, nil
}

func (s *Service) loadRepoContext(ctx context.Context, repoRootReal string) (repoContext, error) {
	identity, ok, err := s.runtime.ResolveRepositoryIdentity(ctx, repoRootReal)
	if err != nil {
		return repoContext{}, err
	}
	if !ok || filepath.Clean(identity.WorktreeRoot) != filepath.Clean(repoRootReal) {
		return repoContext{}, errors.New("not a git repository")
	}
	if err := s.runtimeSession.RetainRepository(ctx, identity); err != nil {
		return repoContext{}, err
	}
	headRef := strings.TrimSpace(s.readGitOptional(ctx, repoRootReal, "symbolic-ref", "--quiet", "--short", "HEAD"))
	if headRef == "" {
		headRef = strings.TrimSpace(s.readGitOptional(ctx, repoRootReal, "rev-parse", "--abbrev-ref", "HEAD"))
	}
	headCommit := strings.TrimSpace(s.readGitOptional(ctx, repoRootReal, "rev-parse", "--verify", "HEAD"))
	dirtyRaw := s.readGitOptional(ctx, repoRootReal, "status", "--porcelain", "--untracked-files=normal")
	return repoContext{
		repoRootReal: repoRootReal,
		headRef:      headRef,
		headCommit:   headCommit,
		dirty:        strings.TrimSpace(dirtyRaw) != "",
		identity:     identity,
	}, nil
}

func (s *Service) readGitOptional(ctx context.Context, repoRoot string, args ...string) string {
	out, err := s.runGitRead(ctx, repoRoot, args...)
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
	out, err := s.runGitRead(ctx, repo.repoRootReal,
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

func (s *Service) getCommitDetail(ctx context.Context, repo repoContext, commit string) (gitCommitDetail, gitCommitDiffPresentation, []gitCommitFileSummary, error) {
	format := "%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%B%x1e"
	metaOut, err := s.runGitRead(ctx, repo.repoRootReal, "show", "-s", "--format="+format, commit)
	if err != nil {
		return gitCommitDetail{}, gitCommitDiffPresentation{}, nil, err
	}
	details := parseCommitDetailOutput(metaOut)
	if len(details) == 0 {
		return gitCommitDetail{}, gitCommitDiffPresentation{}, nil, errors.New("commit not found")
	}
	presentation := buildCommitDiffPresentation(details[0])
	nameStatusArgs, numstatArgs := buildCommitDiffMetadataArgs(commit, presentation)
	files, err := s.readGitDiffMetadataOnListedEntries(ctx, repo.repoRootReal, nameStatusArgs, numstatArgs)
	if err != nil {
		return gitCommitDetail{}, gitCommitDiffPresentation{}, nil, err
	}
	return details[0], presentation, files, nil
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

func classifyRepoRPCError(err error) *sessionrpc.Error {
	if err == nil {
		return &sessionrpc.Error{Code: 500, Message: "internal error"}
	}
	if errors.Is(err, errGitUnavailable) {
		return &sessionrpc.Error{Code: 503, Message: gitUnavailableReason}
	}
	if errors.Is(err, gitruntime.ErrResourceLimit) || errors.Is(err, gitruntime.ErrRequestBudget) ||
		errors.Is(err, gitruntime.ErrResponseBudget) || errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) {
		return classifyGitRPCError(err)
	}
	var commandErr *gitruntime.CommandError
	if errors.As(err, &commandErr) {
		return classifyGitRPCError(err)
	}
	if errors.Is(err, os.ErrNotExist) {
		return &sessionrpc.Error{Code: 404, Message: "not found"}
	}
	message := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(message, "must match worktree root"):
		return &sessionrpc.Error{Code: 400, Message: "invalid repo_root_path"}
	case strings.Contains(message, "not a git repository"):
		return &sessionrpc.Error{Code: 404, Message: "repository not found"}
	default:
		return &sessionrpc.Error{Code: 400, Message: "invalid repo_root_path"}
	}
}

func classifyGitRPCError(err error) *sessionrpc.Error {
	if err == nil {
		return &sessionrpc.Error{Code: 500, Message: "internal error"}
	}
	if errors.Is(err, errGitUnavailable) || gitutil.IsGitUnavailable(err) {
		return &sessionrpc.Error{Code: 503, Message: gitUnavailableReason}
	}
	switch {
	case errors.Is(err, context.Canceled):
		return &sessionrpc.Error{Code: 499, Message: "request canceled"}
	case errors.Is(err, context.DeadlineExceeded):
		return &sessionrpc.Error{Code: 504, Message: "git request timed out"}
	case errors.Is(err, errWorkspaceSnapshotStale):
		return &sessionrpc.Error{Code: GitErrorWorkspaceSnapshotStale, Message: "workspace snapshot is stale"}
	case errors.Is(err, errWorkspaceInventoryLimit):
		return &sessionrpc.Error{Code: GitErrorWorkspaceInventoryLimit, Message: "workspace inventory exceeds resource limit"}
	case errors.Is(err, errWorkspacePathEncoding):
		return &sessionrpc.Error{Code: GitErrorWorkspacePathEncoding, Message: "workspace path is not valid UTF-8"}
	case errors.Is(err, errWorkspacePaginationRequired):
		return &sessionrpc.Error{Code: GitErrorWorkspacePaginationRequired, Message: "workspace pagination is required"}
	case errors.Is(err, errWorkspaceResponseBudget):
		return &sessionrpc.Error{Code: GitErrorWorkspaceResponseBudget, Message: "workspace response exceeds resource budget"}
	case errors.Is(err, errDestructiveWorkspaceScanLimit):
		return &sessionrpc.Error{Code: GitErrorDestructiveWorkspaceScanLimit, Message: "destructive workspace scan exceeds safety limit"}
	case errors.Is(err, gitruntime.ErrResourceLimit):
		return &sessionrpc.Error{Code: GitErrorResourceLimit, Message: "git runtime resource limit exceeded"}
	case errors.Is(err, gitruntime.ErrRequestBudget):
		return &sessionrpc.Error{Code: GitErrorRequestBudget, Message: "git request exceeds resource budget"}
	case errors.Is(err, gitruntime.ErrResponseBudget):
		return &sessionrpc.Error{Code: GitErrorResponseBudget, Message: "git response exceeds resource budget"}
	case errors.Is(err, errWorktreePorcelainZUnsupported):
		return &sessionrpc.Error{Code: 501, Message: "git worktree porcelain-z is unsupported"}
	}
	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "unknown revision"):
		return &sessionrpc.Error{Code: 404, Message: "commit not found"}
	case strings.Contains(lower, "bad object"):
		return &sessionrpc.Error{Code: 404, Message: "commit not found"}
	case strings.Contains(lower, "ambiguous argument"):
		return &sessionrpc.Error{Code: 404, Message: "commit not found"}
	case strings.Contains(lower, "pathspec") && strings.Contains(lower, "did not match"):
		return &sessionrpc.Error{Code: 404, Message: "file not found in commit"}
	case strings.Contains(lower, "invalid git path"):
		return &sessionrpc.Error{Code: 400, Message: "invalid path"}
	case strings.Contains(lower, "invalid source kind"):
		return &sessionrpc.Error{Code: 400, Message: "invalid source kind"}
	case strings.Contains(lower, "missing source kind"):
		return &sessionrpc.Error{Code: 400, Message: "missing source kind"}
	case strings.Contains(lower, "missing workspace section"):
		return &sessionrpc.Error{Code: 400, Message: "missing workspace section"}
	case strings.Contains(lower, "missing commit"):
		return &sessionrpc.Error{Code: 400, Message: "missing commit"}
	case strings.Contains(lower, "missing diff file"):
		return &sessionrpc.Error{Code: 400, Message: "missing diff file"}
	case strings.Contains(lower, "missing ref"):
		return &sessionrpc.Error{Code: 400, Message: "missing ref"}
	case strings.Contains(lower, "stash id is required"):
		return &sessionrpc.Error{Code: 400, Message: "stash id is required"}
	case strings.Contains(lower, "stash not found"):
		return &sessionrpc.Error{Code: 404, Message: "stash not found"}
	case strings.Contains(lower, "file not found in diff"):
		return &sessionrpc.Error{Code: 404, Message: "file not found in diff"}
	case strings.Contains(lower, "ambiguous stash section"):
		return &sessionrpc.Error{Code: 400, Message: "ambiguous stash section"}
	case strings.Contains(lower, "invalid stash section"):
		return &sessionrpc.Error{Code: 400, Message: "invalid stash section"}
	case strings.Contains(lower, "not a git repository"):
		return &sessionrpc.Error{Code: 404, Message: "repository not found"}
	default:
		return &sessionrpc.Error{Code: 500, Message: message}
	}
}

func classifyGitMutationRPCError(err error) *sessionrpc.Error {
	if err == nil {
		return &sessionrpc.Error{Code: 500, Message: "internal error"}
	}
	if errors.Is(err, gitruntime.ErrResourceLimit) || errors.Is(err, gitruntime.ErrRequestBudget) || errors.Is(err, gitruntime.ErrResponseBudget) ||
		errors.Is(err, errWorkspaceInventoryLimit) || errors.Is(err, errWorkspacePathEncoding) || errors.Is(err, errDestructiveWorkspaceScanLimit) {
		return classifyGitRPCError(err)
	}
	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "commit message is required"):
		return &sessionrpc.Error{Code: 400, Message: "commit message is required"}
	case strings.Contains(lower, "no staged changes to commit"):
		return &sessionrpc.Error{Code: 400, Message: "no staged changes to commit"}
	case strings.Contains(lower, "no local changes to stash"):
		return &sessionrpc.Error{Code: 400, Message: "no local changes to stash"}
	case strings.Contains(lower, "invalid git path"):
		return &sessionrpc.Error{Code: 400, Message: "invalid path"}
	case strings.Contains(lower, "please tell me who you are"):
		return &sessionrpc.Error{Code: 400, Message: "git user.name and user.email are required before committing"}
	case strings.Contains(lower, "unable to auto-detect email address"):
		return &sessionrpc.Error{Code: 400, Message: "git user.name and user.email are required before committing"}
	case strings.Contains(lower, "nothing to commit"):
		return &sessionrpc.Error{Code: 400, Message: "no staged changes to commit"}
	case strings.Contains(lower, "target branch does not exist"):
		return &sessionrpc.Error{Code: 404, Message: "target branch does not exist"}
	case strings.Contains(lower, "target commit does not exist"):
		return &sessionrpc.Error{Code: 404, Message: "target commit does not exist"}
	case strings.Contains(lower, "remote branches cannot be deleted here"):
		return &sessionrpc.Error{Code: 400, Message: "remote branches cannot be deleted here"}
	case strings.Contains(lower, "cannot delete the current branch"):
		return &sessionrpc.Error{Code: 400, Message: "cannot delete the current branch"}
	case strings.Contains(lower, "invalid delete mode"):
		return &sessionrpc.Error{Code: 400, Message: "invalid delete mode"}
	case strings.Contains(lower, "delete plan fingerprint is required"):
		return &sessionrpc.Error{Code: 400, Message: "delete plan fingerprint is required"}
	case strings.Contains(lower, "branch name confirmation does not match"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "delete plan is stale"):
		return &sessionrpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "merge plan fingerprint is required"):
		return &sessionrpc.Error{Code: 400, Message: "merge plan fingerprint is required"}
	case strings.Contains(lower, "merge plan is stale"):
		return &sessionrpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "stash apply plan fingerprint is required"):
		return &sessionrpc.Error{Code: 400, Message: "stash apply plan fingerprint is required"}
	case strings.Contains(lower, "stash apply plan is stale"):
		return &sessionrpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "stash drop plan fingerprint is required"):
		return &sessionrpc.Error{Code: 400, Message: "stash drop plan fingerprint is required"}
	case strings.Contains(lower, "stash drop plan is stale"):
		return &sessionrpc.Error{Code: 409, Message: message}
	case strings.Contains(lower, "linked worktree removal must be confirmed"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "discard confirmation is required"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "not accessible from this agent"), strings.Contains(lower, "not accessible from this runtime host"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "attach head to a local branch before merging"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "select a different branch to merge"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current workspace must be clean before merging"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current workspace must be clean before applying a stash"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current workspace must be clean before switching to detached head"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "finish the current"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "unrelated histories support"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "target branch does not have a readable head commit"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "current files would be overwritten by this stash"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "this stash cannot be applied cleanly on the current head"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "merge is blocked"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "checked out in worktree"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "checked out at"):
		return &sessionrpc.Error{Code: 400, Message: message}
	case strings.Contains(lower, "not fully merged"):
		return &sessionrpc.Error{Code: 400, Message: message}
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
	RepoRootPath  string   `json:"repo_root_path"`
	Section       string   `json:"section,omitempty"`
	DirectoryPath string   `json:"directory_path,omitempty"`
	Paths         []string `json:"paths,omitempty"`
}

type stageWorkspaceResp struct {
	RepoRootPath string                     `json:"repo_root_path"`
	Result       gitWorkspaceMutationResult `json:"result"`
}

type unstageWorkspaceReq struct {
	RepoRootPath  string   `json:"repo_root_path"`
	Section       string   `json:"section,omitempty"`
	DirectoryPath string   `json:"directory_path,omitempty"`
	Paths         []string `json:"paths,omitempty"`
}

type unstageWorkspaceResp struct {
	RepoRootPath string                     `json:"repo_root_path"`
	Result       gitWorkspaceMutationResult `json:"result"`
}

type discardWorkspaceReq struct {
	RepoRootPath  string   `json:"repo_root_path"`
	Section       string   `json:"section,omitempty"`
	DirectoryPath string   `json:"directory_path,omitempty"`
	Paths         []string `json:"paths,omitempty"`
}

type discardWorkspaceResp struct {
	RepoRootPath string                     `json:"repo_root_path"`
	Result       gitWorkspaceMutationResult `json:"result"`
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
	RepoRootPath string                    `json:"repo_root_path"`
	Commit       gitCommitDetail           `json:"commit"`
	Presentation gitCommitDiffPresentation `json:"presentation,omitempty"`
	Files        []gitCommitFileSummary    `json:"files"`
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
