package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

var (
	ErrCanonicalRootNotOrphaned      = errors.New("canonical Floret root is not orphaned")
	ErrCanonicalRootIdentityConflict = errors.New("canonical Floret root identity conflicts with product settings")
)

type floretOrphanRootMaintenanceCoordinator struct {
	inventory floretRootThreadInventory
	delete    floretThreadDeleteAuthority
}

type OrphanCanonicalRoot struct {
	ThreadID         string `json:"thread_id"`
	Phase            string `json:"phase"`
	Status           string `json:"status"`
	CanAppendMessage bool   `json:"can_append_message"`
	Recoverable      bool   `json:"recoverable"`
}

type OrphanCanonicalRootReview struct {
	IssueCount int                   `json:"issue_count"`
	Items      []OrphanCanonicalRoot `json:"items"`
}

type AdoptOrphanCanonicalRootRequest struct {
	ThreadID          string
	EndpointID        string
	NamespacePublicID string
	ModelID           string
	PermissionType    string
	WorkingDir        string
	OperatorPublicID  string
	OperatorEmail     string
}

type DeleteOrphanCanonicalRootRequest struct {
	ThreadID         string
	OperatorPublicID string
}

func (s *Service) setOrphanCanonicalRootIDs(ids []identity.ThreadID) {
	if s == nil {
		return
	}
	next := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		threadID := strings.TrimSpace(string(id))
		if threadID != "" {
			next[threadID] = struct{}{}
		}
	}
	s.recoveryMu.Lock()
	s.orphanCanonicalRootIDs = next
	s.recoveryMu.Unlock()
}

func (s *Service) OrphanCanonicalRootIssueCount() int {
	if s == nil {
		return 0
	}
	s.recoveryMu.RLock()
	defer s.recoveryMu.RUnlock()
	return len(s.orphanCanonicalRootIDs)
}

func (s *Service) ReconcileCanonicalRootOwnership(ctx context.Context) (int, error) {
	if s == nil || s.threadsDB == nil || s.orphanRoots == nil || s.orphanRoots.inventory == nil {
		return 0, errors.New("canonical root maintenance capability is unavailable")
	}
	s.orphanMaintenanceMu.Lock()
	defer s.orphanMaintenanceMu.Unlock()
	reconciliation, err := reconcileFloretRootThreadInventory(ctxOrBackground(ctx), s.threadsDB, s.orphanRoots.inventory)
	if err != nil {
		return 0, err
	}
	s.setOrphanCanonicalRootIDs(reconciliation.OrphanedRootThreadIDs)
	return len(reconciliation.OrphanedRootThreadIDs), nil
}

func (s *Service) ReviewOrphanCanonicalRoots(ctx context.Context) (OrphanCanonicalRootReview, error) {
	if s == nil || s.threadsDB == nil || s.orphanRoots == nil || s.orphanRoots.inventory == nil {
		return OrphanCanonicalRootReview{}, errors.New("canonical root maintenance capability is unavailable")
	}
	s.orphanMaintenanceMu.Lock()
	defer s.orphanMaintenanceMu.Unlock()
	reconciliation, summaries, err := inspectFloretRootThreadInventory(ctxOrBackground(ctx), s.threadsDB, s.orphanRoots.inventory)
	if err != nil {
		return OrphanCanonicalRootReview{}, err
	}
	s.setOrphanCanonicalRootIDs(reconciliation.OrphanedRootThreadIDs)
	items := make([]OrphanCanonicalRoot, 0, len(reconciliation.OrphanedRootThreadIDs))
	for _, id := range reconciliation.OrphanedRootThreadIDs {
		summary, ok := summaries[id]
		if !ok {
			return OrphanCanonicalRootReview{}, errors.New("canonical root review lost an inventory identity")
		}
		items = append(items, OrphanCanonicalRoot{
			ThreadID: string(summary.ID), Phase: string(summary.Phase), Status: string(summary.Status),
			CanAppendMessage: summary.CanAppendMessage, Recoverable: summary.Recoverable,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ThreadID < items[j].ThreadID })
	return OrphanCanonicalRootReview{IssueCount: len(items), Items: items}, nil
}

func (s *Service) AdoptOrphanCanonicalRoot(ctx context.Context, req AdoptOrphanCanonicalRootRequest) (int, error) {
	if s == nil || s.threadsDB == nil || s.orphanRoots == nil || s.orphanRoots.inventory == nil {
		return 0, errors.New("canonical root maintenance capability is unavailable")
	}
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.NamespacePublicID = strings.TrimSpace(req.NamespacePublicID)
	req.ModelID = strings.TrimSpace(req.ModelID)
	req.PermissionType = strings.ToLower(strings.TrimSpace(req.PermissionType))
	req.WorkingDir = strings.TrimSpace(req.WorkingDir)
	req.OperatorPublicID = strings.TrimSpace(req.OperatorPublicID)
	req.OperatorEmail = strings.TrimSpace(req.OperatorEmail)
	if req.ThreadID == "" || req.EndpointID == "" || req.NamespacePublicID == "" || req.ModelID == "" || req.PermissionType == "" || req.WorkingDir == "" || req.OperatorPublicID == "" {
		return 0, errors.New("orphan adoption requires complete explicit settings and operator identity")
	}
	if s.cfg == nil {
		return 0, errors.New("orphan adoption requires an active model profile")
	}
	if _, _, ok := s.cfg.ProviderModelByID(req.ModelID); !ok {
		return 0, errors.New("orphan adoption model is not configured for this environment")
	}
	switch req.PermissionType {
	case config.AIPermissionReadonly, config.AIPermissionApprovalRequired, config.AIPermissionFullAccess:
	default:
		return 0, errors.New("orphan adoption permission is invalid")
	}
	if _, err := s.resolveRunModel(ctxOrBackground(ctx), s.cfg, req.ModelID, "", nil); err != nil {
		return 0, fmt.Errorf("resolve explicit model: %w", err)
	}
	resolved, err := s.scope.Resolve(req.WorkingDir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil {
		return 0, fmt.Errorf("resolve explicit working directory: %w", err)
	}
	if resolved.LogicalAbs != req.WorkingDir {
		return 0, errors.New("working directory must use its canonical absolute path")
	}
	s.orphanMaintenanceMu.Lock()
	defer s.orphanMaintenanceMu.Unlock()
	reconciliation, _, err := inspectFloretRootThreadInventory(ctxOrBackground(ctx), s.threadsDB, s.orphanRoots.inventory)
	if err != nil {
		return 0, err
	}
	if !containsFloretThreadID(reconciliation.OrphanedRootThreadIDs, req.ThreadID) {
		existing, lookupErr := s.threadsDB.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), req.ThreadID)
		if lookupErr != nil {
			return 0, lookupErr
		}
		if existing != nil && orphanAdoptionMatches(*existing, req) {
			s.setOrphanCanonicalRootIDs(reconciliation.OrphanedRootThreadIDs)
			return len(reconciliation.OrphanedRootThreadIDs), nil
		}
		if existing != nil {
			return 0, ErrCanonicalRootIdentityConflict
		}
		return 0, ErrCanonicalRootNotOrphaned
	}
	settings := threadstore.ThreadSettings{
		ThreadID: req.ThreadID, EndpointID: req.EndpointID, NamespacePublicID: req.NamespacePublicID,
		ModelID: req.ModelID, PermissionType: req.PermissionType, WorkingDir: req.WorkingDir,
		CreatedByUserPublicID: req.OperatorPublicID, CreatedByUserEmail: req.OperatorEmail,
		UpdatedByUserPublicID: req.OperatorPublicID, UpdatedByUserEmail: req.OperatorEmail,
	}
	if err := s.threadsDB.AdoptCanonicalRootSettings(ctxOrBackground(ctx), settings); err != nil {
		return 0, err
	}
	after, err := reconcileFloretRootThreadInventory(ctxOrBackground(ctx), s.threadsDB, s.orphanRoots.inventory)
	if err != nil {
		return 0, fmt.Errorf("verify orphan adoption: %w", err)
	}
	s.setOrphanCanonicalRootIDs(after.OrphanedRootThreadIDs)
	return len(after.OrphanedRootThreadIDs), nil
}

func (s *Service) DeleteOrphanCanonicalRoot(ctx context.Context, req DeleteOrphanCanonicalRootRequest) (int, error) {
	if s == nil || s.threadsDB == nil || s.orphanRoots == nil || s.orphanRoots.inventory == nil || s.orphanRoots.delete == nil {
		return 0, errors.New("canonical root maintenance capability is unavailable")
	}
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.OperatorPublicID = strings.TrimSpace(req.OperatorPublicID)
	if req.ThreadID == "" || req.OperatorPublicID == "" {
		return 0, errors.New("orphan deletion requires canonical thread and operator identity")
	}
	s.orphanMaintenanceMu.Lock()
	defer s.orphanMaintenanceMu.Unlock()
	reconciliation, err := reconcileFloretRootThreadInventory(ctxOrBackground(ctx), s.threadsDB, s.orphanRoots.inventory)
	if err != nil {
		return 0, err
	}
	if !containsFloretThreadID(reconciliation.OrphanedRootThreadIDs, req.ThreadID) {
		if !containsFloretThreadID(reconciliation.RootThreadIDs, req.ThreadID) {
			s.setOrphanCanonicalRootIDs(reconciliation.OrphanedRootThreadIDs)
			return len(reconciliation.OrphanedRootThreadIDs), nil
		}
		return 0, ErrCanonicalRootNotOrphaned
	}
	requestID := identity.LogicalRequestID("orphan-root-delete-" + req.ThreadID)
	if err := s.orphanRoots.delete.DeleteThread(ctxOrBackground(ctx), identity.ThreadID(req.ThreadID), flruntime.DeleteThreadCommand{LogicalRequestID: requestID}); err != nil && !errors.Is(err, flruntime.ErrThreadNotFound) && !errors.Is(err, flruntime.ErrThreadDeleted) {
		return 0, err
	}
	after, err := reconcileFloretRootThreadInventory(ctxOrBackground(ctx), s.threadsDB, s.orphanRoots.inventory)
	if err != nil {
		return 0, fmt.Errorf("verify orphan deletion: %w", err)
	}
	s.setOrphanCanonicalRootIDs(after.OrphanedRootThreadIDs)
	return len(after.OrphanedRootThreadIDs), nil
}

func inspectFloretRootThreadInventory(ctx context.Context, db floretStartupRecoverySettingsStore, inventory floretRootThreadInventory) (floretRootThreadInventoryReconciliation, map[identity.ThreadID]flruntime.ThreadSummary, error) {
	reconciliation, err := reconcileFloretRootThreadInventory(ctx, db, inventory)
	if err != nil {
		return floretRootThreadInventoryReconciliation{}, nil, err
	}
	summaries := make(map[identity.ThreadID]flruntime.ThreadSummary, len(reconciliation.RootThreadIDs))
	var cursor string
	for {
		page, err := inventory.ListRootThreads(ctx, floretListRootThreadsRequest{Cursor: cursor, Limit: 200})
		if err != nil {
			return floretRootThreadInventoryReconciliation{}, nil, err
		}
		for _, snapshot := range page.Threads {
			if _, duplicate := summaries[snapshot.ID]; duplicate {
				return floretRootThreadInventoryReconciliation{}, nil, errors.New("canonical root review contains duplicate identity")
			}
			summaries[snapshot.ID] = flruntime.ThreadSummary{
				ID: snapshot.ID, Title: snapshot.Title, TitleStatus: snapshot.TitleStatus, TitleSource: snapshot.TitleSource,
				TitleUpdatedAt: snapshot.TitleUpdatedAt, TitleError: snapshot.TitleError, TitleGeneration: snapshot.TitleGeneration,
				CreatedAt: snapshot.CreatedAt, UpdatedAt: snapshot.UpdatedAt, Phase: snapshot.Phase, Status: snapshot.Status,
				LatestTurnID: snapshot.LatestTurnID, WaitingPrompt: snapshot.WaitingPrompt, Recoverable: snapshot.Recoverable,
				CanAppendMessage: snapshot.CanAppendMessage, CanRetry: snapshot.CanRetry,
			}
		}
		if !page.HasMore {
			break
		}
		if page.NextCursor == "" || page.NextCursor == cursor {
			return floretRootThreadInventoryReconciliation{}, nil, errors.New("canonical root review pagination did not advance")
		}
		cursor = page.NextCursor
	}
	return reconciliation, summaries, nil
}

func containsFloretThreadID(ids []identity.ThreadID, threadID string) bool {
	for _, id := range ids {
		if string(id) == threadID {
			return true
		}
	}
	return false
}

func orphanAdoptionMatches(settings threadstore.ThreadSettings, req AdoptOrphanCanonicalRootRequest) bool {
	return settings.ThreadID == req.ThreadID && settings.EndpointID == req.EndpointID &&
		settings.NamespacePublicID == req.NamespacePublicID && settings.ModelID == req.ModelID &&
		settings.PermissionType == req.PermissionType && settings.WorkingDir == req.WorkingDir
}
