package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
	uploadURLPrefix            = "/_redeven_proxy/api/ai/uploads/"
	uploadStagedTTL            = 24 * time.Hour
	uploadCleanupRetryDelay    = 15 * time.Minute
	uploadCleanupSweepInterval = 15 * time.Minute
	uploadCleanupSweepTimeout  = 30 * time.Second
	uploadCleanupBatchSize     = 50
	uploadAttemptRecoveryTTL   = 24 * time.Hour
	sqliteCompactionTimeout    = 30 * time.Second
)

type resolvedUploadAttachment struct {
	UploadID string
	Name     string
	MimeType string
	Size     int64
}

func uniqueStrings(items []string) []string {
	out := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, raw := range items {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func normalizeUploadID(raw string) (string, error) {
	uploadID := strings.TrimSpace(raw)
	if !validUploadID(uploadID) || uploadID != raw {
		return "", errors.New("invalid attachment_id")
	}
	return uploadID, nil
}

func (s *Service) normalizeInputAttachments(ctx context.Context, owner UploadOwner, input RunInput) (RunInput, map[string]resolvedUploadAttachment, []string, error) {
	input.Attachments = append([]RunAttachmentIn(nil), input.Attachments...)
	contextAction, err := normalizeAskFlowerContextActionEnvelope(input.ContextAction)
	if err != nil {
		return input, nil, nil, err
	}
	input.ContextAction = contextAction
	if len(input.Attachments) == 0 {
		return input, nil, nil, nil
	}
	if strings.TrimSpace(owner.EndpointID) == "" || len(strings.TrimSpace(owner.OwnerUserHash)) != sha256.Size*2 {
		return input, nil, nil, errors.New("authenticated attachment owner is incomplete")
	}
	infoByID := make(map[string]resolvedUploadAttachment)
	uploadIDs := make([]string, 0, len(input.Attachments))
	normalized := make([]RunAttachmentIn, 0, len(input.Attachments))
	for _, item := range input.Attachments {
		next, info, err := s.resolveAttachmentInfo(ctx, owner, item)
		if err != nil {
			return input, nil, nil, err
		}
		normalized = append(normalized, next)
		infoByID[next.AttachmentID] = *info
		uploadIDs = append(uploadIDs, info.UploadID)
	}
	input.Attachments = normalized
	return input, infoByID, uniqueStrings(uploadIDs), nil
}

func (s *Service) prepareInputAttachmentAdmission(
	ctx context.Context,
	owner UploadOwner,
	stagingScope *threadstore.UploadStagingScope,
	modelID string,
	input RunInput,
) (RunInput, []string, threadstore.AttachmentAdmission, error) {
	contract := threadstore.AttachmentAdmission{OwnerUserHash: owner.OwnerUserHash}
	if len(input.Attachments) > threadstore.AttachmentAdmissionMaxCount {
		return input, nil, contract, errors.New("attachment count exceeds turn limit")
	}
	seen := make(map[string]struct{}, len(input.Attachments))
	for _, attachment := range input.Attachments {
		id := strings.TrimSpace(attachment.AttachmentID)
		if _, exists := seen[id]; exists {
			return input, nil, contract, errors.New("duplicate attachment identity")
		}
		seen[id] = struct{}{}
	}

	var (
		normalized RunInput
		infoByID   map[string]resolvedUploadAttachment
		uploadIDs  []string
		err        error
	)
	if stagingScope != nil {
		normalized, infoByID, uploadIDs, err = s.normalizeInputAttachmentsForStaging(ctx, owner, *stagingScope, input)
	} else {
		normalized, infoByID, uploadIDs, err = s.normalizeInputAttachments(ctx, owner, input)
	}
	if err != nil {
		return input, nil, contract, err
	}
	capability := s.AttachmentCapabilities(ctxOrBackground(ctx), strings.TrimSpace(modelID))
	contract.CapabilityRevision = capability.Revision
	contract.MaxCount = capability.MaxCount
	contract.MaxTurnBytes = capability.MaxTurnBytes
	contract.SupportsLongText = capability.SupportsLongText
	contract.Routes = make(map[string]string, len(capability.MediaTypes))
	for _, route := range capability.MediaTypes {
		contract.Routes[strings.ToLower(strings.TrimSpace(route.MediaType))] = strings.TrimSpace(route.Mode)
	}
	if capability.MaxCount != threadstore.AttachmentAdmissionMaxCount || capability.MaxTurnBytes != threadstore.AttachmentAdmissionMaxTurnBytes {
		return input, nil, contract, errors.New("invalid attachment admission capability")
	}
	if len(uploadIDs) == 0 {
		return normalized, uploadIDs, contract, nil
	}
	if strings.TrimSpace(capability.ModelID) != strings.TrimSpace(modelID) {
		return input, nil, contract, errors.New("attachment model capability changed")
	}
	var totalBytes int64
	for _, attachment := range normalized.Attachments {
		info, ok := infoByID[attachment.AttachmentID]
		if !ok || info.Size < 0 || info.Size > capability.MaxTurnBytes-totalBytes {
			return input, nil, contract, errors.New("attachment bytes exceed turn limit")
		}
		totalBytes += info.Size
		route := contract.Routes[strings.ToLower(strings.TrimSpace(info.MimeType))]
		if route != "native_full_content" && route != "tool_read" {
			return input, nil, contract, errors.New("attachment media route is unsupported for model")
		}
	}
	return normalized, uploadIDs, contract, nil
}

func (s *Service) normalizeInputAttachmentsForStaging(ctx context.Context, owner UploadOwner, scope threadstore.UploadStagingScope, input RunInput) (RunInput, map[string]resolvedUploadAttachment, []string, error) {
	input.Attachments = append([]RunAttachmentIn(nil), input.Attachments...)
	contextAction, err := normalizeAskFlowerContextActionEnvelope(input.ContextAction)
	if err != nil {
		return input, nil, nil, err
	}
	input.ContextAction = contextAction
	if len(input.Attachments) == 0 {
		return input, nil, nil, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return input, nil, nil, errors.New("threads store not ready")
	}
	infoByID := make(map[string]resolvedUploadAttachment, len(input.Attachments))
	uploadIDs := make([]string, 0, len(input.Attachments))
	normalized := make([]RunAttachmentIn, 0, len(input.Attachments))
	for _, item := range input.Attachments {
		uploadID, normalizeErr := normalizeUploadID(item.AttachmentID)
		if normalizeErr != nil {
			return input, nil, nil, normalizeErr
		}
		rec, loadErr := db.GetStagingOwnedUpload(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, scope.StagingScopeID, uploadID)
		if loadErr != nil || rec == nil {
			return input, nil, nil, errors.New("attachment is not owned by the upload staging scope")
		}
		normalized = append(normalized, RunAttachmentIn{AttachmentID: uploadID})
		infoByID[uploadID] = resolvedUploadAttachment{
			UploadID: uploadID,
			Name:     strings.TrimSpace(rec.Name), MimeType: strings.TrimSpace(rec.DetectedMediaType), Size: rec.SizeBytes,
		}
		uploadIDs = append(uploadIDs, uploadID)
	}
	input.Attachments = normalized
	return input, infoByID, uploadIDs, nil
}

func (s *Service) resolveAttachmentInfo(ctx context.Context, owner UploadOwner, item RunAttachmentIn) (RunAttachmentIn, *resolvedUploadAttachment, error) {
	uploadID, err := normalizeUploadID(item.AttachmentID)
	if err != nil {
		return RunAttachmentIn{}, nil, err
	}
	rec, err := s.ensureUserOwnedUploadRecord(ctx, owner, uploadID)
	if err != nil {
		return RunAttachmentIn{}, nil, err
	}
	if rec == nil {
		return RunAttachmentIn{}, nil, sql.ErrNoRows
	}
	out := RunAttachmentIn{AttachmentID: uploadID}
	info := &resolvedUploadAttachment{
		UploadID: strings.TrimSpace(rec.UploadID),
		Name:     strings.TrimSpace(rec.Name),
		MimeType: strings.TrimSpace(rec.DetectedMediaType),
		Size:     rec.SizeBytes,
	}
	return out, info, nil
}

func (s *Service) ensureUserOwnedUploadRecord(ctx context.Context, owner UploadOwner, uploadID string) (*threadstore.UploadRecord, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	uploadID, err := normalizeUploadID(uploadID)
	if err != nil || strings.TrimSpace(owner.EndpointID) == "" || len(strings.TrimSpace(owner.OwnerUserHash)) != sha256.Size*2 {
		return nil, errors.New("invalid request")
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	rec, err := db.GetUserOwnedUpload(pctx, owner.EndpointID, owner.OwnerUserHash, uploadID)
	cancel()
	if err == nil {
		return rec, nil
	}
	return nil, err
}

func ctxOrBackground(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}

func (s *Service) processUploadCleanupCandidates(ctx context.Context, recs []threadstore.UploadRecord) (int64, error) {
	if s == nil || len(recs) == 0 {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return 0, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	deletedIDs := make([]string, 0, len(recs))
	retryIDs := make([]string, 0, len(recs))
	for _, rec := range recs {
		if err := s.removeUploadArtifacts(rec); err != nil {
			retryIDs = append(retryIDs, strings.TrimSpace(rec.UploadID))
			if s.log != nil {
				s.log.Warn("ai upload cleanup delete failed", "upload_id", strings.TrimSpace(rec.UploadID), "error", err)
			}
			continue
		}
		deletedIDs = append(deletedIDs, strings.TrimSpace(rec.UploadID))
	}
	var finalized int64
	if len(deletedIDs) > 0 {
		pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		n, err := db.FinalizeDeletedUploads(pctx, deletedIDs)
		cancel()
		if err != nil {
			return finalized, err
		}
		finalized = n
	}
	if len(retryIDs) > 0 {
		pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		err := db.RescheduleUploadDeletion(pctx, retryIDs, time.Now().Add(uploadCleanupRetryDelay).UnixMilli())
		cancel()
		if err != nil {
			return finalized, err
		}
	}
	if finalized > 0 {
		s.scheduleThreadstoreCompaction("upload_cleanup")
	}
	return finalized, nil
}

func (s *Service) removeUploadArtifacts(rec threadstore.UploadRecord) error {
	if s == nil {
		return errors.New("nil service")
	}
	s.mu.Lock()
	uploadsDir := strings.TrimSpace(s.uploadsDir)
	s.mu.Unlock()
	if uploadsDir == "" {
		return errors.New("uploads not ready")
	}
	uploadID := strings.TrimSpace(rec.UploadID)
	if uploadID == "" {
		return errors.New("missing upload_id")
	}
	dataRelPath := strings.TrimSpace(rec.StorageRelPath)
	if dataRelPath == "" {
		dataRelPath = uploadID + ".data"
	}
	dataPath := filepath.Join(uploadsDir, filepath.Base(dataRelPath))
	if err := os.Remove(dataPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Service) sweepPendingUploads(ctx context.Context) (int64, error) {
	if s == nil {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return 0, nil
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	var total int64
	for {
		pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		recs, err := db.PrepareExpiredUploadsForDeletion(pctx, time.Now().UnixMilli(), uploadCleanupBatchSize)
		cancel()
		if err != nil {
			return total, err
		}
		if len(recs) == 0 {
			return total, nil
		}
		n, err := s.processUploadCleanupCandidates(ctx, recs)
		total += n
		if err != nil {
			return total, err
		}
		if len(recs) < uploadCleanupBatchSize {
			return total, nil
		}
	}
}

func (s *Service) sweepExpiredUploadStagingScopes(ctx context.Context) (int64, error) {
	if s == nil {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return 0, nil
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	var released int64
	for {
		pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		cleanup, count, err := db.ReleaseExpiredUploadStagingScopes(pctx, time.Now().UnixMilli(), uploadCleanupBatchSize)
		cancel()
		if err != nil {
			return released, err
		}
		if _, err := s.processUploadCleanupCandidates(ctx, cleanup); err != nil {
			return released, err
		}
		released += int64(count)
		if count < uploadCleanupBatchSize {
			return released, nil
		}
	}
}

func (s *Service) sweepOrphanUploadArtifacts(ctx context.Context) (int64, error) {
	if s == nil {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	uploadsDir := strings.TrimSpace(s.uploadsDir)
	s.mu.Unlock()
	if db == nil || uploadsDir == "" {
		return 0, nil
	}
	now := time.Now()
	if _, err := db.ExpireStaleUploadAttempts(ctxOrBackground(ctx), now.Add(-uploadAttemptRecoveryTTL).UnixMilli()); err != nil {
		return 0, err
	}
	protected, err := db.ProtectedUploadArtifactNames(ctxOrBackground(ctx))
	if err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(uploadsDir)
	if err != nil {
		return 0, err
	}
	var removed int64
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if _, ok := protected[name]; ok {
			continue
		}
		uploadID := ""
		switch {
		case strings.HasSuffix(name, ".data.tmp"):
			uploadID = strings.TrimSuffix(name, ".data.tmp")
		case strings.HasSuffix(name, ".data"):
			uploadID = strings.TrimSuffix(name, ".data")
		default:
			continue
		}
		if !validUploadID(uploadID) {
			continue
		}
		if err := os.Remove(filepath.Join(uploadsDir, name)); err != nil && !os.IsNotExist(err) {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func (s *Service) interruptUploadAttemptsFromPreviousProcess(ctx context.Context) (int64, error) {
	if s == nil {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	uploadsDir := strings.TrimSpace(s.uploadsDir)
	s.mu.Unlock()
	if db == nil || uploadsDir == "" {
		return 0, nil
	}
	attempts, err := db.InterruptReceivingUploadAttempts(ctxOrBackground(ctx), time.Now().UnixMilli())
	if err != nil {
		return 0, err
	}
	for _, attempt := range attempts {
		uploadID := strings.TrimSpace(attempt.UploadID)
		if !validUploadID(uploadID) {
			return 0, errors.New("interrupted upload has invalid identity")
		}
		for _, suffix := range []string{".data.tmp", ".data"} {
			if err := os.Remove(filepath.Join(uploadsDir, uploadID+suffix)); err != nil && !os.IsNotExist(err) {
				return 0, err
			}
		}
	}
	return int64(len(attempts)), nil
}

func (s *Service) startBackgroundMaintenance() {
	if s == nil {
		return
	}
	s.mu.Lock()
	stopCh := s.maintenanceStopCh
	doneCh := s.maintenanceDoneCh
	s.mu.Unlock()
	if stopCh == nil || doneCh == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(uploadCleanupSweepInterval)
		defer ticker.Stop()
		defer close(doneCh)
		s.runBackgroundMaintenance("startup")
		for {
			select {
			case <-ticker.C:
				s.runBackgroundMaintenance("periodic")
			case <-stopCh:
				return
			}
		}
	}()
}

func (s *Service) runBackgroundMaintenance(reason string) {
	if s == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), uploadCleanupSweepTimeout)
	defer cancel()
	creates, createErr := s.replayPendingThreadCreateOperations(ctx)
	if createErr != nil {
		if s.log != nil {
			s.log.Warn("ai thread create replay failed", "reason", reason, "error", createErr)
		}
	} else if creates > 0 && s.log != nil {
		s.log.Info("ai thread create replay completed", "reason", reason, "count", creates)
	}
	deletes, deleteErr := s.replayPendingThreadDeletes(ctx, threadDeleteReplayBatchSize)
	if deleteErr != nil {
		if s.log != nil {
			s.log.Warn("ai thread delete replay failed", "reason", reason, "error", deleteErr)
		}
	} else if deletes > 0 && s.log != nil {
		s.log.Info("ai thread delete replay completed", "reason", reason, "count", deletes)
	}
	expiredScopes, expiredScopeErr := s.sweepExpiredUploadStagingScopes(ctx)
	if expiredScopeErr != nil {
		if s.log != nil {
			s.log.Warn("ai upload staging maintenance failed", "reason", reason, "error", expiredScopeErr)
		}
	} else if expiredScopes > 0 && s.log != nil {
		s.log.Info("ai upload staging maintenance released scopes", "reason", reason, "count", expiredScopes)
	}
	n, err := s.sweepPendingUploads(ctx)
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai upload maintenance failed", "reason", reason, "error", err)
		}
	} else if n > 0 && s.log != nil {
		s.log.Info("ai upload maintenance reclaimed uploads", "reason", reason, "count", n)
	}
	orphans, orphanErr := s.sweepOrphanUploadArtifacts(ctx)
	if orphanErr != nil {
		if s.log != nil {
			s.log.Warn("ai upload orphan recovery failed", "reason", reason, "error", orphanErr)
		}
	} else if orphans > 0 && s.log != nil {
		s.log.Info("ai upload orphan recovery reclaimed artifacts", "reason", reason, "count", orphans)
	}
	forks, forkErr := s.replayPendingThreadForkOperations(ctx)
	if forkErr != nil {
		if s.log != nil {
			s.log.Warn("ai thread fork replay failed", "reason", reason, "error", forkErr)
		}
	} else if forks > 0 && s.log != nil {
		s.log.Info("ai thread fork replay completed", "reason", reason, "count", forks)
	}
	broadcasts, broadcastErr := s.publishUnbroadcastThreadForkOperations(ctx)
	if broadcastErr != nil {
		if s.log != nil {
			s.log.Warn("ai thread fork broadcast recovery failed", "reason", reason, "error", broadcastErr)
		}
	} else if broadcasts > 0 && s.log != nil {
		s.log.Info("ai thread fork broadcast recovery completed", "reason", reason, "count", broadcasts)
	}
}

func (s *Service) scheduleThreadstoreCompaction(reason string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.compactionScheduled || s.threadsDB == nil {
		s.mu.Unlock()
		return
	}
	s.compactionScheduled = true
	s.mu.Unlock()
	go func() {
		defer func() {
			s.mu.Lock()
			s.compactionScheduled = false
			s.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), sqliteCompactionTimeout)
		defer cancel()
		s.mu.Lock()
		db := s.threadsDB
		s.mu.Unlock()
		if db == nil {
			return
		}
		plan, err := db.MaybeCompact(ctx)
		if err != nil {
			if s.log != nil {
				s.log.Warn("ai threadstore compaction failed", "reason", reason, "error", err)
			}
			return
		}
		if plan.ShouldCompact && s.log != nil {
			s.log.Info("ai threadstore compacted", "reason", reason, "free_bytes", plan.FreeBytes, "freelist_pages", plan.FreelistCount, "incremental", plan.UseIncremental)
		}
	}()
}
