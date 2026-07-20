package ai

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path"
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
	sqliteCompactionTimeout    = 30 * time.Second
)

type resolvedUploadAttachment struct {
	UploadID string
	URL      string
	Name     string
	MimeType string
	Size     int64
}

func parseUploadIDFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, uploadURLPrefix) {
		return ""
	}
	raw = strings.TrimPrefix(raw, uploadURLPrefix)
	raw = strings.Trim(path.Clean("/"+raw), "/")
	return strings.TrimSpace(raw)
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

func (s *Service) normalizeInputAttachments(ctx context.Context, endpointID string, input RunInput) (RunInput, map[string]resolvedUploadAttachment, []string, error) {
	input.Attachments = append([]RunAttachmentIn(nil), input.Attachments...)
	contextAction, err := normalizeAskFlowerContextActionEnvelope(input.ContextAction)
	if err != nil {
		return input, nil, nil, err
	}
	input.ContextAction = contextAction
	if len(input.Attachments) == 0 {
		return input, nil, nil, nil
	}
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return input, nil, nil, errors.New("missing endpoint_id")
	}
	infoByURL := make(map[string]resolvedUploadAttachment)
	uploadIDs := make([]string, 0, len(input.Attachments))
	normalized := make([]RunAttachmentIn, 0, len(input.Attachments))
	for _, item := range input.Attachments {
		next, info, err := s.resolveAttachmentInfo(ctx, endpointID, item)
		if err != nil {
			return input, nil, nil, err
		}
		normalized = append(normalized, next)
		infoByURL[next.URL] = *info
		uploadIDs = append(uploadIDs, info.UploadID)
	}
	input.Attachments = normalized
	return input, infoByURL, uniqueStrings(uploadIDs), nil
}

func (s *Service) resolveAttachmentInfo(ctx context.Context, endpointID string, item RunAttachmentIn) (RunAttachmentIn, *resolvedUploadAttachment, error) {
	out := RunAttachmentIn{
		Name:     strings.TrimSpace(item.Name),
		MimeType: strings.TrimSpace(item.MimeType),
		URL:      strings.TrimSpace(item.URL),
	}
	if out.URL == "" {
		return out, nil, errors.New("attachment URL is required")
	}
	uploadID := parseUploadIDFromURL(out.URL)
	if uploadID == "" {
		return out, nil, errors.New("attachment must reference a Redeven upload")
	}
	rec, err := s.ensureUploadRecord(ctx, endpointID, uploadID)
	if err != nil {
		return out, nil, err
	}
	if rec == nil {
		return out, nil, sql.ErrNoRows
	}
	out.Name = strings.TrimSpace(rec.Name)
	out.MimeType = strings.TrimSpace(rec.MimeType)
	info := &resolvedUploadAttachment{
		UploadID: strings.TrimSpace(rec.UploadID),
		URL:      out.URL,
		Name:     strings.TrimSpace(rec.Name),
		MimeType: strings.TrimSpace(rec.MimeType),
		Size:     rec.SizeBytes,
	}
	return out, info, nil
}

func (s *Service) ensureUploadRecord(ctx context.Context, endpointID string, uploadID string) (*threadstore.UploadRecord, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	uploadID = strings.TrimSpace(uploadID)
	if endpointID == "" || uploadID == "" {
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
	rec, err := db.GetUpload(pctx, endpointID, uploadID)
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
	n, err := s.sweepPendingUploads(ctx)
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai upload maintenance failed", "reason", reason, "error", err)
		}
	} else if n > 0 && s.log != nil {
		s.log.Info("ai upload maintenance reclaimed uploads", "reason", reason, "count", n)
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
