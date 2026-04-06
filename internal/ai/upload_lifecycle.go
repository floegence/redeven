package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
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

type persistedUploadBlocks struct {
	Blocks []json.RawMessage `json:"blocks"`
}

type persistedUploadBlock struct {
	Type string `json:"type"`
	URL  string `json:"url"`
	Src  string `json:"src"`
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
		if strings.TrimSpace(next.URL) == "" {
			continue
		}
		normalized = append(normalized, next)
		if info != nil {
			infoByURL[next.URL] = *info
			uploadIDs = append(uploadIDs, info.UploadID)
		}
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
		return out, nil, nil
	}
	uploadID := parseUploadIDFromURL(out.URL)
	if uploadID == "" {
		return out, nil, nil
	}
	rec, err := s.ensureUploadRecord(ctx, endpointID, uploadID)
	if err != nil {
		return out, nil, err
	}
	if rec == nil {
		return out, nil, sql.ErrNoRows
	}
	if out.Name == "" {
		out.Name = strings.TrimSpace(rec.Name)
	}
	if out.MimeType == "" {
		out.MimeType = strings.TrimSpace(rec.MimeType)
	}
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
	uploadsDir := strings.TrimSpace(s.uploadsDir)
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
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	meta, dataPath, readErr := readUpload(uploadsDir, uploadID)
	if readErr != nil {
		return nil, readErr
	}
	createdAt := meta.CreatedAt
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	pctx, cancel = context.WithTimeout(ctxOrBackground(ctx), persistTO)
	err = db.EnsureUpload(pctx, threadstore.UploadRecord{
		UploadID:          uploadID,
		EndpointID:        endpointID,
		StorageRelPath:    filepath.Base(strings.TrimSpace(dataPath)),
		Name:              strings.TrimSpace(meta.Name),
		MimeType:          strings.TrimSpace(meta.MimeType),
		SizeBytes:         meta.Size,
		State:             threadstore.UploadStateStaged,
		CreatedAtUnixMs:   createdAt,
		DeleteAfterUnixMs: createdAt + uploadStagedTTL.Milliseconds(),
	})
	cancel()
	if err != nil {
		return nil, err
	}
	pctx, cancel = context.WithTimeout(ctxOrBackground(ctx), persistTO)
	defer cancel()
	return db.GetUpload(pctx, endpointID, uploadID)
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
	metaPath := filepath.Join(uploadsDir, uploadID+".json")
	for _, path := range []string{dataPath, metaPath} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
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
	n, err := s.sweepPendingUploads(ctx)
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai upload maintenance failed", "reason", reason, "error", err)
		}
		return
	}
	if n > 0 && s.log != nil {
		s.log.Info("ai upload maintenance reclaimed uploads", "reason", reason, "count", n)
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

func (s *Service) backfillLegacyThreadUploadRefs(ctx context.Context, endpointID string, threadID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	beforeID := int64(0)
	for {
		pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		msgs, nextBeforeID, hasMore, err := db.ListMessages(pctx, endpointID, threadID, 500, beforeID)
		cancel()
		if err != nil {
			return err
		}
		for _, msg := range msgs {
			uploadIDs, err := s.collectUploadIDsFromPersistedMessage(ctx, endpointID, msg.MessageJSON)
			if err != nil {
				return err
			}
			if len(uploadIDs) == 0 {
				continue
			}
			pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
			err = db.BindUploadsToRef(pctx, endpointID, threadID, threadstore.UploadRefKindMessage, msg.MessageID, uploadIDs, msg.CreatedAtUnixMs)
			cancel()
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if !hasMore {
			break
		}
		beforeID = nextBeforeID
	}
	for _, lane := range []string{threadstore.FollowupLaneQueued, threadstore.FollowupLaneDraft} {
		pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
		followups, err := db.ListFollowupsByLane(pctx, endpointID, threadID, lane, 500)
		cancel()
		if err != nil {
			return err
		}
		for _, rec := range followups {
			uploadIDs, err := s.collectUploadIDsFromAttachments(ctx, endpointID, unmarshalQueuedTurnAttachments(rec.AttachmentsJSON))
			if err != nil {
				return err
			}
			if len(uploadIDs) == 0 {
				continue
			}
			pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
			err = db.BindUploadsToRef(pctx, endpointID, threadID, threadstore.UploadRefKindQueuedTurn, rec.QueueID, uploadIDs, rec.CreatedAtUnixMs)
			cancel()
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
	}
	return nil
}

func (s *Service) collectUploadIDsFromPersistedMessage(ctx context.Context, endpointID string, raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var carrier persistedUploadBlocks
	if err := json.Unmarshal([]byte(raw), &carrier); err != nil {
		return nil, nil
	}
	uploadIDs := make([]string, 0, len(carrier.Blocks))
	for _, blockRaw := range carrier.Blocks {
		var block persistedUploadBlock
		if err := json.Unmarshal(blockRaw, &block); err != nil {
			continue
		}
		url := strings.TrimSpace(block.URL)
		if url == "" {
			url = strings.TrimSpace(block.Src)
		}
		uploadID := parseUploadIDFromURL(url)
		if uploadID == "" {
			continue
		}
		if _, err := s.ensureUploadRecord(ctx, endpointID, uploadID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				continue
			}
			return nil, err
		}
		uploadIDs = append(uploadIDs, uploadID)
	}
	return uniqueStrings(uploadIDs), nil
}

func (s *Service) collectUploadIDsFromAttachments(ctx context.Context, endpointID string, attachments []RunAttachmentIn) ([]string, error) {
	uploadIDs := make([]string, 0, len(attachments))
	for _, item := range attachments {
		uploadID := parseUploadIDFromURL(item.URL)
		if uploadID == "" {
			continue
		}
		if _, err := s.ensureUploadRecord(ctx, endpointID, uploadID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				continue
			}
			return nil, err
		}
		uploadIDs = append(uploadIDs, uploadID)
	}
	return uniqueStrings(uploadIDs), nil
}
