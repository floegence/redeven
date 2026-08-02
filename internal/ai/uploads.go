package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"golang.org/x/text/unicode/norm"
)

const (
	UploadErrorInvalidRequest       = "upload_invalid_request"
	UploadErrorTooLarge             = "attachment_too_large"
	UploadErrorInvalidTextEncoding  = "attachment_invalid_text_encoding"
	UploadErrorUnsupportedMediaType = "attachment_unsupported_media_type"
	UploadErrorIdempotencyConflict  = "upload_idempotency_conflict"
	UploadErrorInProgress           = "upload_in_progress"
	UploadErrorIntegrityMismatch    = "attachment_integrity_mismatch"
	UploadErrorQuotaExceeded        = "attachment_quota_exceeded"
	UploadErrorNotFound             = "attachment_not_found"
	UploadErrorStoreUnavailable     = "attachment_store_unavailable"
)

type UploadOwner struct {
	EndpointID    string
	UserPublicID  string
	OwnerUserHash string
	ChannelID     string
}

func NewUploadOwner(endpointID string, userPublicID string, channelID string) (UploadOwner, error) {
	endpointID = strings.TrimSpace(endpointID)
	userPublicID = strings.TrimSpace(userPublicID)
	channelID = strings.TrimSpace(channelID)
	if endpointID == "" || userPublicID == "" {
		return UploadOwner{}, NewUploadError(UploadErrorInvalidRequest, false, errors.New("authenticated upload owner is incomplete"))
	}
	digest := sha256.Sum256([]byte("redeven-ai-upload-owner-v1\x00" + userPublicID))
	return UploadOwner{EndpointID: endpointID, UserPublicID: userPublicID, OwnerUserHash: hex.EncodeToString(digest[:]), ChannelID: channelID}, nil
}

type UploadError struct {
	Code      string
	Retryable bool
	err       error
}

func NewUploadError(code string, retryable bool, err error) *UploadError {
	return &UploadError{Code: strings.TrimSpace(code), Retryable: retryable, err: err}
}

func (e *UploadError) Error() string {
	if e == nil || e.err == nil {
		return "upload failed"
	}
	return e.err.Error()
}

func (e *UploadError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

type SaveUploadRequest struct {
	Owner                 UploadOwner
	StagingScopeID        string
	StagingCapability     string
	Reader                io.Reader
	DisplayName           string
	DeclaredMediaType     string
	Source                string
	UploadRequestID       string
	ExpectedContentSHA256 string
	ExpectedSizeBytes     int64
	DisplayNameSHA256     string
	MaxBytes              int64
}

type OpenUploadResult struct {
	Info     *UploadResponse
	FilePath string
}

type CanonicalAttachmentMembership struct {
	ThreadID          string
	TurnID            string
	AttachmentID      string
	ResourceRef       string
	ContentSHA256     string
	Name              string
	DetectedMediaType string
	SizeBytes         int64
}

// LiveAttachmentCanonicalAuthority must read one exact turn through Floret's
// public runtime API on every call. A product retention claim is not evidence.
type LiveAttachmentCanonicalAuthority interface {
	ReadCanonicalAttachmentMembership(context.Context, string, string, string) (CanonicalAttachmentMembership, error)
}

func newUploadID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "upl_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func normalizeUploadDisplayName(raw string) (string, error) {
	raw = path.Base(strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/"))
	raw = norm.NFC.String(raw)
	if raw == "" || raw == "." {
		raw = "upload"
	}
	if !utf8.ValidString(raw) || strings.ContainsAny(raw, "\x00\r\n") {
		return "", NewUploadError(UploadErrorInvalidRequest, false, errors.New("invalid upload display name"))
	}
	if utf8.RuneCountInString(raw) > 255 {
		return "", NewUploadError(UploadErrorInvalidRequest, false, errors.New("upload display name is too long"))
	}
	return raw, nil
}

func normalizeMediaType(raw string) string {
	value, params, err := mime.ParseMediaType(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	value = strings.ToLower(strings.TrimSpace(value))
	if strings.HasPrefix(value, "text/") {
		charset := strings.ToLower(strings.TrimSpace(params["charset"]))
		if charset == "" || charset == "utf-8" || charset == "utf8" {
			return value + "; charset=utf-8"
		}
		return ""
	}
	return value
}

type uploadInspector struct {
	hash          hash.Hash
	head          []byte
	tail          []byte
	bytes         int64
	codePoints    int64
	newlines      int64
	validUTF8     bool
	hasText       bool
	previousWasCR bool
	hasNUL        bool
}

func newUploadInspector() *uploadInspector {
	return &uploadInspector{hash: sha256.New(), validUTF8: true}
}

func (i *uploadInspector) Write(p []byte) (int, error) {
	const maxInspectorChunkBytes = 16 << 20
	if len(p) > maxInspectorChunkBytes {
		return 0, fmt.Errorf("upload chunk exceeds %d bytes", maxInspectorChunkBytes)
	}
	if len(i.head) < 512 {
		remaining := 512 - len(i.head)
		if remaining > len(p) {
			remaining = len(p)
		}
		i.head = append(i.head, p[:remaining]...)
	}
	_, _ = i.hash.Write(p)
	i.bytes += int64(len(p))
	data := make([]byte, 0, len(i.tail)+len(p))
	data = append(data, i.tail...)
	data = append(data, p...)
	i.tail = i.tail[:0]
	for len(data) > 0 {
		if !utf8.FullRune(data) {
			i.tail = append(i.tail, data...)
			break
		}
		r, size := utf8.DecodeRune(data)
		if r == utf8.RuneError && size == 1 {
			i.validUTF8 = false
			data = data[1:]
			continue
		}
		i.hasText = true
		i.codePoints++
		if r == 0 {
			i.hasNUL = true
		}
		switch r {
		case '\r':
			i.newlines++
			i.previousWasCR = true
		case '\n':
			if !i.previousWasCR {
				i.newlines++
			}
			i.previousWasCR = false
		default:
			i.previousWasCR = false
		}
		data = data[size:]
	}
	return len(p), nil
}

func (i *uploadInspector) finish() {
	if len(i.tail) != 0 {
		i.validUTF8 = false
	}
}

func (i *uploadInspector) digest() string { return hex.EncodeToString(i.hash.Sum(nil)) }

func (i *uploadInspector) textStats() (*int64, *int64) {
	if !i.validUTF8 || i.hasNUL {
		return nil, nil
	}
	points := i.codePoints
	lines := int64(0)
	if i.hasText {
		lines = i.newlines + 1
	}
	return &points, &lines
}

func classifyUpload(inspector *uploadInspector, source string) (string, *int64, *int64, error) {
	inspector.finish()
	points, lines := inspector.textStats()
	if source == threadstore.UploadSourceLongText {
		if points == nil {
			return "", nil, nil, NewUploadError(UploadErrorInvalidTextEncoding, false, errors.New("long text must be strict UTF-8 without NUL"))
		}
		return "text/plain; charset=utf-8", points, lines, nil
	}
	detected := normalizeMediaType(http.DetectContentType(inspector.head))
	if strings.HasPrefix(detected, "text/") {
		if points == nil {
			return "", nil, nil, NewUploadError(UploadErrorInvalidTextEncoding, false, errors.New("text attachment is not strict UTF-8"))
		}
		// Uploaded active text such as HTML or XML must never retain an executable
		// browser media type. Text attachments have one closed canonical type.
		return "text/plain; charset=utf-8", points, lines, nil
	}
	switch detected {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf":
		return detected, nil, nil, nil
	case "application/octet-stream":
		if points != nil {
			return "text/plain; charset=utf-8", points, lines, nil
		}
	}
	return "", nil, nil, NewUploadError(UploadErrorUnsupportedMediaType, false, errors.New("attachment media type is unsupported"))
}

func uploadRequestFingerprint(req SaveUploadRequest, name string) string {
	value := strings.Join([]string{
		strings.ToLower(strings.TrimSpace(req.ExpectedContentSHA256)),
		strconv.FormatInt(req.ExpectedSizeBytes, 10),
		strings.ToLower(strings.TrimSpace(req.Source)),
		strings.ToLower(strings.TrimSpace(req.DisplayNameSHA256)),
		strings.TrimSpace(req.StagingScopeID),
		name,
	}, "\x00")
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func uploadResponseFromRecord(rec *threadstore.UploadRecord) *UploadResponse {
	if rec == nil {
		return nil
	}
	return &UploadResponse{
		AttachmentID:      rec.UploadID,
		URL:               uploadURLPrefix + rec.UploadID,
		Name:              rec.Name,
		DisplayName:       rec.Name,
		Size:              rec.SizeBytes,
		SizeBytes:         rec.SizeBytes,
		MimeType:          rec.DetectedMediaType,
		DetectedMediaType: rec.DetectedMediaType,
		ContentSHA256:     rec.ContentSHA256,
		UnicodeCodePoints: rec.UnicodeCodePoints,
		LogicalLineCount:  rec.LogicalLineCount,
		Source:            rec.Source,
		LogicalLocator:    logicalAttachmentLocator(rec.UploadID, rec.Name),
		DownloadURL:       uploadURLPrefix + rec.UploadID,
	}
}

func logicalAttachmentLocator(uploadID string, displayName string) string {
	return "attachment://v1/" + uploadID + "/" + url.PathEscape(filepath.Base(displayName))
}

func (s *Service) AttachmentCapabilities(ctx context.Context, modelID string) AttachmentCapabilities {
	modelID = strings.TrimSpace(modelID)
	if s == nil || modelID == "" {
		return attachmentCapabilitiesForModel(modelID, config.AIProvider{}, contextmodel.ModelCapability{})
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	if cfg == nil {
		return attachmentCapabilitiesForModel(modelID, config.AIProvider{}, contextmodel.ModelCapability{})
	}
	resolved, err := s.resolveRunModel(ctxOrBackground(ctx), cfg, modelID, "", nil)
	if err != nil {
		return attachmentCapabilitiesForModel(modelID, config.AIProvider{}, contextmodel.ModelCapability{})
	}
	return attachmentCapabilitiesForModel(resolved.ID, resolved.Provider, resolved.Capability)
}

func attachmentCapabilitiesForModel(modelID string, provider config.AIProvider, capability contextmodel.ModelCapability) AttachmentCapabilities {
	const (
		nativeRoute      = "native_full_content"
		toolReadRoute    = "tool_read"
		unsupportedRoute = "unsupported"
	)
	capability = contextmodel.NormalizeCapability(capability)
	textRoute := unsupportedRoute
	pdfRoute := unsupportedRoute
	if capability.SupportsFileInput && providerSupportsNativeFileAttachments(provider, capability.ModelName) {
		textRoute = nativeRoute
		pdfRoute = nativeRoute
	} else if capability.SupportsTools {
		textRoute = toolReadRoute
	}
	imageRoute := unsupportedRoute
	if capability.SupportsImageInput {
		imageRoute = nativeRoute
	}
	mediaTypes := []AttachmentMediaTypeCapability{
		{MediaType: "text/plain", Mode: textRoute},
		{MediaType: "text/plain; charset=utf-8", Mode: textRoute},
		{MediaType: "application/pdf", Mode: pdfRoute},
		{MediaType: "image/png", Mode: imageRoute},
		{MediaType: "image/jpeg", Mode: imageRoute},
		{MediaType: "image/gif", Mode: imageRoute},
		{MediaType: "image/webp", Mode: imageRoute},
	}
	out := AttachmentCapabilities{
		ModelID: strings.TrimSpace(modelID), Enabled: textRoute != unsupportedRoute || pdfRoute != unsupportedRoute || imageRoute != unsupportedRoute,
		MaxCount: 10, MaxItemBytes: 10 << 20, MaxTurnBytes: 25 << 20,
		MediaTypes: mediaTypes, SupportsLongText: textRoute != unsupportedRoute,
	}
	revisionPayload, _ := json.Marshal(struct {
		Version string                 `json:"version"`
		Value   AttachmentCapabilities `json:"value"`
	}{Version: "redeven-attachment-capabilities-v1", Value: out})
	revisionDigest := sha256.Sum256(revisionPayload)
	out.Revision = hex.EncodeToString(revisionDigest[:])
	return out
}

func providerSupportsNativeFileAttachments(provider config.AIProvider, modelName string) bool {
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	switch providerType {
	case "openai", "anthropic", DesktopModelSourceProviderType:
		return true
	case "qwen", "openai_compatible":
		mode := resolveProviderWebSearchCapability(provider, modelName).Mode
		return mode == providerWebSearchModeOpenAIResponsesBuiltin ||
			mode == providerWebSearchModeQwenResponsesWebSearch ||
			(providerType == "openai_compatible" && mode == providerWebSearchModeExternalBrave)
	default:
		return false
	}
}

func (s *Service) SaveUpload(ctx context.Context, req SaveUploadRequest) (*UploadResponse, error) {
	if s == nil || req.Reader == nil {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("missing upload body"))
	}
	owner := req.Owner
	if owner.EndpointID == "" || len(owner.OwnerUserHash) != 64 {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("authenticated upload owner is incomplete"))
	}
	name, err := normalizeUploadDisplayName(req.DisplayName)
	if err != nil {
		return nil, err
	}
	nameFingerprint := strings.ToLower(strings.TrimSpace(req.DisplayNameSHA256))
	if len(nameFingerprint) != sha256.Size*2 {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("missing or invalid display name fingerprint"))
	}
	digest := sha256.Sum256([]byte(name))
	if hex.EncodeToString(digest[:]) != nameFingerprint {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("upload display name fingerprint differs"))
	}
	req.Source = strings.ToLower(strings.TrimSpace(req.Source))
	if req.Source == "" {
		req.Source = threadstore.UploadSourceFile
	}
	if req.Source != threadstore.UploadSourceFile && req.Source != threadstore.UploadSourceLongText {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("invalid upload source"))
	}
	req.UploadRequestID = strings.TrimSpace(req.UploadRequestID)
	if req.UploadRequestID == "" || len(req.UploadRequestID) > 200 || strings.ContainsAny(req.UploadRequestID, "\r\n\x00") {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("invalid upload request id"))
	}
	req.StagingScopeID = strings.TrimSpace(req.StagingScopeID)
	if req.StagingScopeID == "" || len(req.StagingScopeID) > 200 || strings.ContainsAny(req.StagingScopeID, "\r\n\x00") {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("invalid upload staging scope"))
	}
	scope, err := s.authorizeUploadStagingScope(ctx, owner, req.StagingScopeID, req.StagingCapability)
	if err != nil {
		return nil, err
	}
	if req.MaxBytes <= 0 {
		req.MaxBytes = 10 << 20
	}
	if req.MaxBytes > 10<<20 {
		return nil, NewUploadError(UploadErrorTooLarge, false, fmt.Errorf("attachment exceeds %d byte limit", 10<<20))
	}
	if req.ExpectedSizeBytes < 0 || req.ExpectedSizeBytes > req.MaxBytes {
		return nil, NewUploadError(UploadErrorTooLarge, false, fmt.Errorf("attachment exceeds %d byte limit", req.MaxBytes))
	}
	expectedDigest := strings.ToLower(strings.TrimSpace(req.ExpectedContentSHA256))
	if len(expectedDigest) != sha256.Size*2 {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("missing or invalid upload content digest"))
	}
	if _, err := hex.DecodeString(expectedDigest); err != nil {
		return nil, NewUploadError(UploadErrorInvalidRequest, false, errors.New("invalid upload content digest"))
	}

	s.mu.Lock()
	dir := strings.TrimSpace(s.uploadsDir)
	db := s.threadsDB
	s.mu.Unlock()
	if dir == "" || db == nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	id, err := newUploadID()
	if err != nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to allocate attachment"))
	}
	attempt := threadstore.UploadAttemptRecord{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash,
		UploadRequestID: req.UploadRequestID, RequestFingerprint: uploadRequestFingerprint(req, name),
		UploadID: id, CreatedAtUnixMs: time.Now().UnixMilli(),
	}
	reserved, created, err := db.ReserveUploadAttempt(ctxOrBackground(ctx), attempt)
	if errors.Is(err, threadstore.ErrUploadIdempotencyConflict) {
		return nil, NewUploadError(UploadErrorIdempotencyConflict, false, err)
	}
	if err != nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to reserve upload"))
	}
	attempt = reserved
	if !created {
		switch attempt.Status {
		case threadstore.UploadAttemptComplete:
			rec, getErr := db.GetStagingOwnedUpload(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, scope.StagingScopeID, attempt.UploadID)
			if getErr != nil {
				return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("completed upload is unavailable"))
			}
			return uploadResponseFromRecord(rec), nil
		case threadstore.UploadAttemptFailed:
			restarted, restartErr := db.RestartFailedUploadAttempt(ctxOrBackground(ctx), attempt)
			if restartErr != nil {
				return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to restart upload"))
			}
			if restarted {
				_ = os.Remove(filepath.Join(dir, attempt.UploadID+".data.tmp"))
				_ = os.Remove(filepath.Join(dir, attempt.UploadID+".data"))
				break
			}
			return nil, NewUploadError(UploadErrorInProgress, true, threadstore.ErrUploadInProgress)
		default:
			if recovered, recoverErr := s.completeRenamedUploadAttempt(ctxOrBackground(ctx), db, dir, attempt, req, name); recoverErr != nil {
				return nil, recoverErr
			} else if recovered != nil {
				return recovered, nil
			}
			return nil, NewUploadError(UploadErrorInProgress, true, threadstore.ErrUploadInProgress)
		}
	}

	dataPath := filepath.Join(dir, attempt.UploadID+".data")
	tmpPath := dataPath + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		_ = db.FailUploadAttempt(ctxOrBackground(ctx), attempt, UploadErrorStoreUnavailable)
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to create upload staging file"))
	}
	inspector := newUploadInspector()
	limited := &io.LimitedReader{R: req.Reader, N: req.MaxBytes + 1}
	written, copyErr := io.Copy(io.MultiWriter(f, inspector), limited)
	if copyErr == nil {
		copyErr = f.Sync()
	}
	closeErr := f.Close()
	if copyErr == nil {
		copyErr = closeErr
	}
	fail := func(code string, retryable bool, cause error) (*UploadResponse, error) {
		_ = os.Remove(tmpPath)
		_ = os.Remove(dataPath)
		_ = db.FailUploadAttempt(ctxOrBackground(ctx), attempt, code)
		return nil, NewUploadError(code, retryable, cause)
	}
	if copyErr != nil {
		return fail(UploadErrorStoreUnavailable, true, errors.New("failed to persist upload"))
	}
	if written > req.MaxBytes {
		return fail(UploadErrorTooLarge, false, fmt.Errorf("attachment exceeds %d byte limit", req.MaxBytes))
	}
	if written != req.ExpectedSizeBytes || inspector.digest() != expectedDigest {
		return fail(UploadErrorIntegrityMismatch, false, errors.New("upload bytes differ from declared identity"))
	}
	detected, points, lines, err := classifyUpload(inspector, req.Source)
	if err != nil {
		var uploadErr *UploadError
		if errors.As(err, &uploadErr) {
			return fail(uploadErr.Code, uploadErr.Retryable, uploadErr)
		}
		return fail(UploadErrorUnsupportedMediaType, false, err)
	}
	if err := os.Rename(tmpPath, dataPath); err != nil {
		return fail(UploadErrorStoreUnavailable, true, errors.New("failed to commit upload file"))
	}
	if dirFile, err := os.Open(dir); err == nil {
		err = dirFile.Sync()
		_ = dirFile.Close()
		if err != nil {
			return fail(UploadErrorStoreUnavailable, true, errors.New("failed to sync upload directory"))
		}
	} else {
		return fail(UploadErrorStoreUnavailable, true, errors.New("failed to open upload directory"))
	}
	createdAt := time.Now().UnixMilli()
	rec := threadstore.UploadRecord{
		UploadID: attempt.UploadID, EndpointID: owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeUser, OwnerUserHash: owner.OwnerUserHash,
		StorageRelPath: filepath.Base(dataPath), Name: name,
		DeclaredMediaType: normalizeMediaType(req.DeclaredMediaType), DetectedMediaType: detected, MimeType: detected,
		SizeBytes: written, ContentSHA256: inspector.digest(), UnicodeCodePoints: points, LogicalLineCount: lines,
		Source: req.Source, State: threadstore.UploadStateStaged,
		CreatedAtUnixMs: createdAt, DeleteAfterUnixMs: createdAt + uploadStagedTTL.Milliseconds(),
	}
	if err := db.CompleteUploadAttemptToStaging(ctxOrBackground(ctx), attempt, rec, scope); err != nil {
		if errors.Is(err, threadstore.ErrUploadQuotaExceeded) {
			return fail(UploadErrorQuotaExceeded, false, err)
		}
		if errors.Is(err, threadstore.ErrThreadIDRetired) {
			return fail(UploadErrorNotFound, false, err)
		}
		return fail(UploadErrorStoreUnavailable, true, errors.New("failed to commit upload metadata"))
	}
	return uploadResponseFromRecord(&rec), nil
}

func (s *Service) completeRenamedUploadAttempt(
	ctx context.Context,
	db *threadstore.Store,
	dir string,
	attempt threadstore.UploadAttemptRecord,
	req SaveUploadRequest,
	name string,
) (*UploadResponse, error) {
	scope, err := s.authorizeUploadStagingScope(ctx, req.Owner, req.StagingScopeID, req.StagingCapability)
	if err != nil {
		return nil, err
	}
	dataPath := filepath.Join(dir, attempt.UploadID+".data")
	f, err := os.Open(dataPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to inspect interrupted upload"))
	}
	inspector := newUploadInspector()
	written, copyErr := io.Copy(inspector, io.LimitReader(f, req.MaxBytes+1))
	closeErr := f.Close()
	if copyErr == nil {
		copyErr = closeErr
	}
	failInterrupted := func(code string, retryable bool, cause error) (*UploadResponse, error) {
		if failErr := db.FailUploadAttempt(ctx, attempt, code); failErr != nil {
			return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to reset interrupted upload"))
		}
		_ = os.Remove(dataPath)
		_ = os.Remove(dataPath + ".tmp")
		return nil, NewUploadError(code, retryable, cause)
	}
	if copyErr != nil {
		return failInterrupted(UploadErrorStoreUnavailable, true, errors.New("interrupted upload artifact is unreadable"))
	}
	expectedDigest := strings.ToLower(strings.TrimSpace(req.ExpectedContentSHA256))
	if written != req.ExpectedSizeBytes || written > req.MaxBytes || inspector.digest() != expectedDigest {
		return failInterrupted(UploadErrorIntegrityMismatch, true, errors.New("interrupted upload artifact differs from declared identity"))
	}
	detected, points, lines, classifyErr := classifyUpload(inspector, req.Source)
	if classifyErr != nil {
		var uploadErr *UploadError
		if errors.As(classifyErr, &uploadErr) {
			return failInterrupted(uploadErr.Code, uploadErr.Retryable, uploadErr)
		}
		return failInterrupted(UploadErrorUnsupportedMediaType, false, classifyErr)
	}
	createdAt := attempt.CreatedAtUnixMs
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	rec := threadstore.UploadRecord{
		UploadID: attempt.UploadID, EndpointID: req.Owner.EndpointID,
		OwnerScopeKind: threadstore.UploadOwnerScopeUser, OwnerUserHash: req.Owner.OwnerUserHash,
		StorageRelPath: filepath.Base(dataPath), Name: name,
		DeclaredMediaType: normalizeMediaType(req.DeclaredMediaType), DetectedMediaType: detected, MimeType: detected,
		SizeBytes: written, ContentSHA256: inspector.digest(), UnicodeCodePoints: points, LogicalLineCount: lines,
		Source: req.Source, State: threadstore.UploadStateStaged,
		CreatedAtUnixMs: createdAt, DeleteAfterUnixMs: createdAt + uploadStagedTTL.Milliseconds(),
	}
	if err := db.CompleteUploadAttemptToStaging(ctx, attempt, rec, scope); err != nil {
		if errors.Is(err, threadstore.ErrUploadQuotaExceeded) {
			return failInterrupted(UploadErrorQuotaExceeded, false, err)
		}
		if errors.Is(err, threadstore.ErrThreadIDRetired) {
			return failInterrupted(UploadErrorNotFound, false, err)
		}
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("failed to recover interrupted upload metadata"))
	}
	return uploadResponseFromRecord(&rec), nil
}

func (s *Service) OpenLiveUpload(ctx context.Context, owner UploadOwner, threadID string, turnID string, uploadID string, authority LiveAttachmentCanonicalAuthority) (*OpenUploadResult, error) {
	threadID = strings.TrimSpace(threadID)
	turnID = strings.TrimSpace(turnID)
	uploadID = strings.TrimSpace(uploadID)
	if s == nil || owner.EndpointID == "" || len(owner.OwnerUserHash) != 64 || threadID == "" || turnID == "" || !validUploadID(uploadID) || authority == nil {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	membership, err := authority.ReadCanonicalAttachmentMembership(ctxOrBackground(ctx), threadID, turnID, uploadID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	if err != nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, fmt.Errorf("read canonical attachment authority: %w", err))
	}
	if strings.TrimSpace(membership.ThreadID) != threadID || strings.TrimSpace(membership.TurnID) != turnID || strings.TrimSpace(membership.AttachmentID) != uploadID || strings.TrimSpace(membership.ResourceRef) == "" {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("canonical attachment membership is inconsistent"))
	}
	resourceUploadID, resourceDigest, err := immutableUploadIdentityFromFloretResourceRef(membership.ResourceRef)
	if err != nil || resourceUploadID != uploadID {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("canonical attachment identity differs from the resource"))
	}
	membershipDigest := strings.ToLower(strings.TrimSpace(membership.ContentSHA256))
	if resourceDigest != membershipDigest {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("canonical attachment digest differs from the resource"))
	}
	s.mu.Lock()
	dir := strings.TrimSpace(s.uploadsDir)
	db := s.threadsDB
	s.mu.Unlock()
	if dir == "" || db == nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	rec, err := db.GetThreadOwnedUpload(ctxOrBackground(ctx), owner.EndpointID, threadID, uploadID)
	if err != nil || rec == nil || rec.State != threadstore.UploadStateLive {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	if rec.OwnerScopeKind != threadstore.UploadOwnerScopeUser || rec.OwnerUserHash != owner.OwnerUserHash {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	if strings.TrimSpace(membership.Name) != rec.Name || normalizeMediaType(membership.DetectedMediaType) != normalizeMediaType(rec.DetectedMediaType) || membership.SizeBytes != rec.SizeBytes {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("canonical attachment metadata differs from the resource"))
	}
	storedDigest := strings.ToLower(strings.TrimSpace(rec.ContentSHA256))
	if len(storedDigest) != sha256.Size*2 || membershipDigest != storedDigest {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("canonical attachment digest differs from the resource"))
	}
	filePath := filepath.Join(dir, filepath.Base(rec.StorageRelPath))
	if err := verifyUploadArtifactAgainstDigest(rec, filePath, storedDigest); err != nil {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("attachment failed integrity validation"))
	}
	resolved := *rec
	resolved.ContentSHA256 = storedDigest
	return &OpenUploadResult{Info: uploadResponseFromRecord(&resolved), FilePath: filePath}, nil
}

func (s *Service) OpenQueuedUpload(ctx context.Context, owner UploadOwner, threadID, queueID, uploadID string) (*OpenUploadResult, error) {
	threadID = strings.TrimSpace(threadID)
	queueID = strings.TrimSpace(queueID)
	uploadID = strings.TrimSpace(uploadID)
	if s == nil || owner.EndpointID == "" || len(owner.OwnerUserHash) != 64 || threadID == "" || queueID == "" || !validUploadID(uploadID) {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	s.mu.Lock()
	dir := strings.TrimSpace(s.uploadsDir)
	db := s.threadsDB
	s.mu.Unlock()
	if dir == "" || db == nil {
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	rec, err := db.GetQueuedTurnOwnedUpload(ctxOrBackground(ctx), owner.EndpointID, threadID, queueID, uploadID)
	if err != nil || rec == nil || rec.State != threadstore.UploadStateLive {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	if rec.OwnerScopeKind != threadstore.UploadOwnerScopeUser || rec.OwnerUserHash != owner.OwnerUserHash {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	filePath := filepath.Join(dir, filepath.Base(rec.StorageRelPath))
	digest := strings.ToLower(strings.TrimSpace(rec.ContentSHA256))
	if len(digest) != sha256.Size*2 || verifyUploadArtifactAgainstDigest(rec, filePath, digest) != nil {
		return nil, NewUploadError(UploadErrorIntegrityMismatch, false, errors.New("attachment failed integrity validation"))
	}
	resolved := *rec
	resolved.ContentSHA256 = digest
	return &OpenUploadResult{Info: uploadResponseFromRecord(&resolved), FilePath: filePath}, nil
}

func verifyUploadArtifact(rec *threadstore.UploadRecord, filePath string) error {
	return verifyUploadArtifactAgainstDigest(rec, filePath, "")
}

func verifyUploadArtifactAgainstDigest(rec *threadstore.UploadRecord, filePath string, expectedDigest string) error {
	actualDigest, err := digestUploadArtifact(rec, filePath)
	if err != nil {
		return err
	}
	if expectedDigest != "" && actualDigest != strings.ToLower(strings.TrimSpace(expectedDigest)) {
		return errors.New("attachment digest differs from canonical metadata")
	}
	return nil
}

func digestUploadArtifact(rec *threadstore.UploadRecord, filePath string) (string, error) {
	if rec == nil {
		return "", errors.New("missing attachment record")
	}
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	hasher := sha256.New()
	written, err := io.Copy(hasher, f)
	if err != nil {
		return "", err
	}
	if written != rec.SizeBytes {
		return "", errors.New("attachment size differs from immutable metadata")
	}
	actualDigest := hex.EncodeToString(hasher.Sum(nil))
	if rec.ContentSHA256 != "" && actualDigest != strings.ToLower(strings.TrimSpace(rec.ContentSHA256)) {
		return "", errors.New("attachment digest differs from immutable metadata")
	}
	return actualDigest, nil
}

func validUploadID(uploadID string) bool {
	if !strings.HasPrefix(uploadID, "upl_") || len(uploadID) != 28 {
		return false
	}
	for _, r := range uploadID[4:] {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

func (s *Service) DeleteStagedUpload(ctx context.Context, owner UploadOwner, uploadID string) error {
	if s == nil || !validUploadID(strings.TrimSpace(uploadID)) {
		return NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment store is unavailable"))
	}
	rec, err := db.PrepareUserStagedUploadDeletion(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, uploadID, time.Now().UnixMilli())
	if err != nil {
		existing, existingErr := db.GetUserOwnedUpload(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, uploadID)
		if existingErr == nil && existing != nil {
			return NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
		}
		if known, knownErr := db.HasCompletedOwnedUploadAttempt(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, uploadID); existingErr != nil && knownErr == nil && known {
			return nil
		}
		return NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	if err := s.removeUploadArtifacts(*rec); err != nil {
		_ = db.RescheduleUploadDeletion(ctxOrBackground(ctx), []string{uploadID}, time.Now().Add(uploadCleanupRetryDelay).UnixMilli())
		return NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment deletion is pending"))
	}
	if _, err := db.FinalizeDeletedUploads(ctxOrBackground(ctx), []string{uploadID}); err != nil {
		return NewUploadError(UploadErrorStoreUnavailable, true, errors.New("attachment deletion is pending"))
	}
	return nil
}
