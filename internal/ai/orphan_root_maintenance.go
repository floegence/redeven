package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

var (
	ErrCanonicalRootNotOrphaned      = errors.New("canonical Floret root is not orphaned")
	ErrCanonicalRootIdentityConflict = errors.New("canonical Floret root identity conflicts with product settings")
)

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

func (service *Service) setOrphanCanonicalRootIDs(ids []identity.ThreadID) {
	if service == nil {
		return
	}
	service.orphanMu.Lock()
	service.orphanCanonicalRootIDs = make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if value := strings.TrimSpace(id.String()); value != "" {
			service.orphanCanonicalRootIDs[value] = struct{}{}
		}
	}
	service.orphanMu.Unlock()
}

func (service *Service) OrphanCanonicalRootIssueCount() int {
	if service == nil {
		return 0
	}
	service.orphanMu.Lock()
	defer service.orphanMu.Unlock()
	return len(service.orphanCanonicalRootIDs)
}

func (service *Service) orphanRootInventory(ctx context.Context) ([]flruntime.ThreadSummary, []identity.ThreadID, error) {
	if service == nil || service.threadRuntime == nil || service.threadsDB == nil {
		return nil, nil, errors.New("canonical root maintenance is unavailable")
	}
	roots, err := service.threadRuntime.List(ctxOrBackground(ctx), flruntime.ThreadScope{})
	if err != nil {
		return nil, nil, err
	}
	owned := make(map[string]struct{})
	cursor := threadstore.ThreadSettingsRecoveryCursor{}
	for {
		page, next, more, pageErr := service.threadsDB.ListThreadSettingsForRecoveryPage(ctxOrBackground(ctx), cursor, 200)
		if pageErr != nil {
			return nil, nil, pageErr
		}
		for _, settings := range page {
			owned[strings.TrimSpace(settings.ThreadID)] = struct{}{}
		}
		if !more {
			break
		}
		cursor = next
	}
	orphans := make([]identity.ThreadID, 0)
	for _, root := range roots {
		if _, ok := owned[root.ID.String()]; !ok {
			orphans = append(orphans, root.ID)
		}
	}
	return roots, orphans, nil
}

func (service *Service) ReconcileCanonicalRootOwnership(ctx context.Context) (int, error) {
	_, orphans, err := service.orphanRootInventory(ctx)
	if err != nil {
		return 0, err
	}
	service.setOrphanCanonicalRootIDs(orphans)
	return len(orphans), nil
}

func (service *Service) ReviewOrphanCanonicalRoots(ctx context.Context) (OrphanCanonicalRootReview, error) {
	roots, orphans, err := service.orphanRootInventory(ctx)
	if err != nil {
		return OrphanCanonicalRootReview{}, err
	}
	service.setOrphanCanonicalRootIDs(orphans)
	orphanSet := make(map[string]struct{}, len(orphans))
	for _, id := range orphans {
		orphanSet[id.String()] = struct{}{}
	}
	items := make([]OrphanCanonicalRoot, 0, len(orphans))
	for _, root := range roots {
		if _, ok := orphanSet[root.ID.String()]; !ok {
			continue
		}
		status := "idle"
		if root.Activity == flruntime.ThreadActivityActive {
			status = "running"
		} else if root.LastOutcome != nil {
			status = string(*root.LastOutcome)
		}
		items = append(items, OrphanCanonicalRoot{ThreadID: root.ID.String(), Phase: string(root.Activity), Status: status, CanAppendMessage: true, Recoverable: root.Activity == flruntime.ThreadActivityActive})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ThreadID < items[j].ThreadID })
	return OrphanCanonicalRootReview{IssueCount: len(items), Items: items}, nil
}

func (service *Service) AdoptOrphanCanonicalRoot(ctx context.Context, req AdoptOrphanCanonicalRootRequest) (int, error) {
	if service == nil || service.threadRuntime == nil || service.threadsDB == nil {
		return 0, errors.New("canonical root maintenance is unavailable")
	}
	req.ThreadID, req.EndpointID = strings.TrimSpace(req.ThreadID), strings.TrimSpace(req.EndpointID)
	req.NamespacePublicID, req.ModelID = strings.TrimSpace(req.NamespacePublicID), strings.TrimSpace(req.ModelID)
	req.PermissionType, req.WorkingDir = strings.ToLower(strings.TrimSpace(req.PermissionType)), strings.TrimSpace(req.WorkingDir)
	req.OperatorPublicID, req.OperatorEmail = strings.TrimSpace(req.OperatorPublicID), strings.TrimSpace(req.OperatorEmail)
	if req.ThreadID == "" || req.EndpointID == "" || req.NamespacePublicID == "" || req.ModelID == "" || req.PermissionType == "" || req.WorkingDir == "" || req.OperatorPublicID == "" {
		return 0, errors.New("orphan adoption requires complete explicit settings and operator identity")
	}
	if service.cfg == nil {
		return 0, errors.New("orphan adoption requires an active model profile")
	}
	if _, _, ok := service.cfg.ProviderModelByID(req.ModelID); !ok {
		return 0, errors.New("orphan adoption model is not configured")
	}
	switch req.PermissionType {
	case config.AIPermissionReadonly, config.AIPermissionApprovalRequired, config.AIPermissionFullAccess:
	default:
		return 0, errors.New("orphan adoption permission is invalid")
	}
	resolved, err := service.scope.Resolve(req.WorkingDir, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true})
	if err != nil || resolved.LogicalAbs != req.WorkingDir {
		return 0, fmt.Errorf("resolve explicit working directory: %w", err)
	}
	_, orphans, err := service.orphanRootInventory(ctx)
	if err != nil {
		return 0, err
	}
	if !containsFloretThreadID(orphans, req.ThreadID) {
		existing, lookupErr := service.threadsDB.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), req.ThreadID)
		if lookupErr != nil {
			return 0, lookupErr
		}
		if existing != nil && orphanAdoptionMatches(*existing, req) {
			return len(orphans), nil
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
	if err := service.threadsDB.AdoptCanonicalRootSettings(ctxOrBackground(ctx), settings); err != nil {
		return 0, err
	}
	return service.ReconcileCanonicalRootOwnership(ctx)
}

func (service *Service) DeleteOrphanCanonicalRoot(ctx context.Context, req DeleteOrphanCanonicalRootRequest) (int, error) {
	if service == nil || service.threadRuntime == nil {
		return 0, errors.New("canonical root maintenance is unavailable")
	}
	req.ThreadID, req.OperatorPublicID = strings.TrimSpace(req.ThreadID), strings.TrimSpace(req.OperatorPublicID)
	if req.ThreadID == "" || req.OperatorPublicID == "" {
		return 0, errors.New("orphan deletion requires canonical thread and operator identity")
	}
	_, orphans, err := service.orphanRootInventory(ctx)
	if err != nil {
		return 0, err
	}
	if !containsFloretThreadID(orphans, req.ThreadID) {
		return 0, ErrCanonicalRootNotOrphaned
	}
	err = service.threadRuntime.Delete(ctxOrBackground(ctx), flruntime.DeleteThreadInput{
		ThreadID: identity.ThreadID(req.ThreadID), RequestKey: flruntime.RequestKey("orphan-root-delete-" + req.ThreadID),
	})
	if err != nil && !errors.Is(err, flruntime.ErrThreadNotFound) && !errors.Is(err, flruntime.ErrThreadDeleted) {
		return 0, err
	}
	return service.ReconcileCanonicalRootOwnership(ctx)
}

func containsFloretThreadID(ids []identity.ThreadID, threadID string) bool {
	for _, id := range ids {
		if id.String() == strings.TrimSpace(threadID) {
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
