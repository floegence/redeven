package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

const uploadStagingScopeTTL = 24 * time.Hour

type UploadStagingScopeResponse struct {
	StagingScopeID  string `json:"staging_scope_id"`
	TargetID        string `json:"target_id"`
	ExpiresAtUnixMs int64  `json:"expires_at_unix_ms"`
	Capability      string `json:"-"`
}

func newOpaqueUploadStagingValue(prefix string, bytes int) (string, error) {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func uploadStagingCapabilityHash(secret string) string {
	digest := sha256.Sum256([]byte("redeven-upload-staging-capability-v1\x00" + strings.TrimSpace(secret)))
	return hex.EncodeToString(digest[:])
}

func validUploadStagingTargetID(targetID string) bool {
	targetID = strings.TrimSpace(targetID)
	return targetID != "" && len(targetID) <= 200 && !strings.ContainsAny(targetID, "\r\n\x00")
}

func (s *Service) CreateUploadStagingScope(ctx context.Context, owner UploadOwner, targetID string) (UploadStagingScopeResponse, error) {
	targetID = strings.TrimSpace(targetID)
	if s == nil || owner.EndpointID == "" || len(owner.OwnerUserHash) != 64 || !validUploadStagingTargetID(targetID) {
		return UploadStagingScopeResponse{}, NewUploadError(UploadErrorInvalidRequest, false, errors.New("invalid upload staging scope request"))
	}
	scopeID, err := newOpaqueUploadStagingValue("ustg_", 18)
	if err != nil {
		return UploadStagingScopeResponse{}, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to allocate upload staging scope"))
	}
	capability, err := newOpaqueUploadStagingValue("ustgc_", 32)
	if err != nil {
		return UploadStagingScopeResponse{}, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to allocate upload staging capability"))
	}
	now := time.Now().UnixMilli()
	record := threadstore.UploadStagingScope{
		StagingScopeID: scopeID, EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash,
		TargetID: targetID, CapabilityHash: uploadStagingCapabilityHash(capability),
		CreatedAtUnixMs: now, ExpiresAtUnixMs: now + uploadStagingScopeTTL.Milliseconds(),
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return UploadStagingScopeResponse{}, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	if err := db.CreateUploadStagingScope(ctxOrBackground(ctx), record); err != nil {
		return UploadStagingScopeResponse{}, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to create upload staging scope"))
	}
	return UploadStagingScopeResponse{StagingScopeID: scopeID, TargetID: targetID, ExpiresAtUnixMs: record.ExpiresAtUnixMs, Capability: capability}, nil
}

func (s *Service) authorizeUploadStagingScope(ctx context.Context, owner UploadOwner, stagingScopeID, capability string) (threadstore.UploadStagingScope, error) {
	stagingScopeID = strings.TrimSpace(stagingScopeID)
	capability = strings.TrimSpace(capability)
	if s == nil || owner.EndpointID == "" || len(owner.OwnerUserHash) != 64 || stagingScopeID == "" || capability == "" {
		return threadstore.UploadStagingScope{}, NewUploadError(UploadErrorNotFound, false, errors.New("upload staging scope not found"))
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return threadstore.UploadStagingScope{}, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	scope, err := db.AuthorizeUploadStagingScope(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, stagingScopeID, uploadStagingCapabilityHash(capability), time.Now().UnixMilli())
	if err != nil {
		return threadstore.UploadStagingScope{}, NewUploadError(UploadErrorNotFound, false, errors.New("upload staging scope not found"))
	}
	return scope, nil
}

func (s *Service) ReleaseUploadStagingScope(ctx context.Context, owner UploadOwner, stagingScopeID, capability string) error {
	scope, err := s.authorizeUploadStagingScope(ctx, owner, stagingScopeID, capability)
	if err != nil {
		return err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	cleanup, err := db.ReleaseUploadStagingScope(ctxOrBackground(ctx), scope, time.Now().UnixMilli())
	if err != nil {
		return NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to release upload staging scope"))
	}
	if _, err := s.processUploadCleanupCandidates(ctxOrBackground(ctx), cleanup); err != nil {
		return NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment deletion is pending"))
	}
	return nil
}

func (s *Service) OpenStagingUpload(ctx context.Context, owner UploadOwner, stagingScopeID, capability, uploadID string) (*OpenUploadResult, error) {
	scope, err := s.authorizeUploadStagingScope(ctx, owner, stagingScopeID, capability)
	if err != nil || !validUploadID(strings.TrimSpace(uploadID)) {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	s.mu.Lock()
	dir := strings.TrimSpace(s.uploadsDir)
	db := s.threadsDB
	s.mu.Unlock()
	if dir == "" || db == nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	rec, err := db.GetStagingOwnedUpload(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, scope.StagingScopeID, strings.TrimSpace(uploadID))
	if err != nil || rec == nil {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	filePath := filepath.Join(dir, filepath.Base(rec.StorageRelPath))
	if err := verifyUploadArtifact(rec, filePath); err != nil {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("attachment failed integrity validation"))
	}
	return &OpenUploadResult{Info: uploadResponseFromRecord(rec), FilePath: filePath}, nil
}

func (s *Service) DeleteStagingScopeUpload(ctx context.Context, owner UploadOwner, stagingScopeID, capability, uploadID string) error {
	scope, err := s.authorizeUploadStagingScope(ctx, owner, stagingScopeID, capability)
	if err != nil {
		return err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	cleanup, err := db.ReleaseUploadStagingScopeUpload(ctxOrBackground(ctx), scope, strings.TrimSpace(uploadID), time.Now().UnixMilli())
	if err != nil {
		return NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	if _, err := s.processUploadCleanupCandidates(ctxOrBackground(ctx), cleanup); err != nil {
		return NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment deletion is pending"))
	}
	return nil
}

func (s *Service) ReadStagingLongText(ctx context.Context, owner UploadOwner, stagingScopeID, capability, uploadID string) (*StagedLongTextResponse, error) {
	opened, err := s.OpenStagingUpload(ctx, owner, stagingScopeID, capability, uploadID)
	if err != nil {
		return nil, err
	}
	if opened == nil || opened.Info == nil || opened.Info.Source != threadstore.UploadSourceLongText || opened.Info.SizeBytes > 10<<20 {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	body, err := os.ReadFile(opened.FilePath)
	if err != nil || int64(len(body)) != opened.Info.SizeBytes || !utf8.Valid(body) {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("long text attachment failed integrity validation"))
	}
	digest := sha256.Sum256(body)
	actualDigest := hex.EncodeToString(digest[:])
	if actualDigest != strings.ToLower(strings.TrimSpace(opened.Info.ContentSHA256)) {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("long text attachment failed integrity validation"))
	}
	return &StagedLongTextResponse{Attachment: opened.Info, Text: string(body), ContentSHA256: actualDigest}, nil
}
