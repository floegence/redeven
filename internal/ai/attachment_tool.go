package ai

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/session"
)

const (
	attachmentReadMinBytes     = 4
	attachmentReadDefaultBytes = 32 << 10
	attachmentReadMaxBytes     = 64 << 10
	attachmentReadDefaultLines = 200
	attachmentReadMaxLines     = 1000
	attachmentReadCursorTTL    = 15 * time.Minute
)

type attachmentReadArgs struct {
	Locator  string `json:"locator"`
	Cursor   string `json:"cursor"`
	MaxBytes int    `json:"max_bytes"`
	MaxLines int    `json:"max_lines"`
}

type attachmentReadCursor struct {
	Version      int    `json:"v"`
	KeyID        string `json:"key_id"`
	AttachmentID string `json:"attachment_id"`
	Digest       string `json:"digest"`
	ThreadID     string `json:"thread_id"`
	RunID        string `json:"run_id"`
	Offset       int    `json:"offset"`
	MaxBytes     int    `json:"max_bytes"`
	MaxLines     int    `json:"max_lines"`
	ExpiresAtMS  int64  `json:"expires_at_ms"`
}

var attachmentReadCursorKey struct {
	once sync.Once
	root [32]byte
	err  error
}

func attachmentReadRootKey() ([]byte, error) {
	attachmentReadCursorKey.once.Do(func() {
		_, attachmentReadCursorKey.err = rand.Read(attachmentReadCursorKey.root[:])
	})
	if attachmentReadCursorKey.err != nil {
		return nil, attachmentReadCursorKey.err
	}
	return attachmentReadCursorKey.root[:], nil
}

func attachmentReadKeyID(now time.Time) string {
	return strconv.FormatInt(now.UnixMilli()/attachmentReadCursorTTL.Milliseconds(), 36)
}

func attachmentReadSigningKey(keyID string) ([]byte, error) {
	if strings.TrimSpace(keyID) == "" {
		return nil, errors.New("attachment read cursor key id is required")
	}
	root, err := attachmentReadRootKey()
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, root)
	_, _ = mac.Write([]byte("redeven-attachment-read-cursor-v1\x00" + keyID))
	return mac.Sum(nil), nil
}

func parseAttachmentLocator(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "attachment" || u.Host != "v1" || u.User != nil || u.Port() != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", "", errors.New("invalid attachment locator")
	}
	escaped := strings.TrimPrefix(u.EscapedPath(), "/")
	parts := strings.Split(escaped, "/")
	if len(parts) != 2 || !validUploadID(parts[0]) || parts[1] == "" {
		return "", "", errors.New("invalid attachment locator")
	}
	name, err := url.PathUnescape(parts[1])
	if err != nil || name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00\r\n") || strings.Contains(name, "%") {
		return "", "", errors.New("invalid attachment locator")
	}
	return parts[0], name, nil
}

func signAttachmentReadCursor(cursor attachmentReadCursor) (string, error) {
	if cursor.KeyID == "" {
		cursor.KeyID = attachmentReadKeyID(time.Now())
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	key, err := attachmentReadSigningKey(cursor.KeyID)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func verifyAttachmentReadCursor(raw string) (attachmentReadCursor, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return attachmentReadCursor{}, errors.New("invalid attachment read cursor")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || base64.RawURLEncoding.EncodeToString(payload) != parts[0] {
		return attachmentReadCursor{}, errors.New("invalid attachment read cursor")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || base64.RawURLEncoding.EncodeToString(signature) != parts[1] {
		return attachmentReadCursor{}, errors.New("invalid attachment read cursor")
	}
	var cursor attachmentReadCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.Version != 1 || cursor.KeyID == "" {
		return attachmentReadCursor{}, errors.New("invalid attachment read cursor")
	}
	key, err := attachmentReadSigningKey(cursor.KeyID)
	if err != nil {
		return attachmentReadCursor{}, err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return attachmentReadCursor{}, errors.New("invalid attachment read cursor")
	}
	now := time.Now()
	currentKeyID := attachmentReadKeyID(now)
	previousKeyID := attachmentReadKeyID(now.Add(-attachmentReadCursorTTL))
	if (cursor.KeyID != currentKeyID && cursor.KeyID != previousKeyID) || cursor.ExpiresAtMS < now.UnixMilli() {
		return attachmentReadCursor{}, errors.New("invalid or expired attachment read cursor")
	}
	return cursor, nil
}

func attachmentReadLimits(args attachmentReadArgs) (int, int) {
	maxBytes := args.MaxBytes
	if maxBytes == 0 {
		maxBytes = attachmentReadDefaultBytes
	}
	if maxBytes < attachmentReadMinBytes {
		maxBytes = attachmentReadMinBytes
	} else if maxBytes > attachmentReadMaxBytes {
		maxBytes = attachmentReadMaxBytes
	}
	maxLines := args.MaxLines
	if maxLines == 0 {
		maxLines = attachmentReadDefaultLines
	}
	if maxLines < 1 {
		maxLines = 1
	} else if maxLines > attachmentReadMaxLines {
		maxLines = attachmentReadMaxLines
	}
	return maxBytes, maxLines
}

func (r *run) toolAttachmentRead(ctx context.Context, meta *session.Meta, args attachmentReadArgs) (map[string]any, error) {
	if r == nil || meta == nil || !meta.CanRead || r.host.openLiveAttachment == nil {
		return nil, errors.New("attachment read is unavailable")
	}
	if strings.TrimSpace(meta.EndpointID) != strings.TrimSpace(r.endpointID) ||
		strings.TrimSpace(meta.UserPublicID) != strings.TrimSpace(r.userPublicID) ||
		strings.TrimSpace(meta.ChannelID) != strings.TrimSpace(r.channelID) {
		return nil, errors.New("attachment not found")
	}
	attachmentID, displayName, err := parseAttachmentLocator(args.Locator)
	if err != nil {
		return nil, err
	}
	owner, err := NewUploadOwner(r.endpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		return nil, errors.New("attachment read is unavailable")
	}
	opened, err := r.host.openLiveAttachment(ctxOrBackground(ctx), owner, attachmentID)
	if err != nil || opened.Upload == nil || opened.Upload.Info == nil {
		return nil, errors.New("attachment not found")
	}
	info := opened.Upload.Info
	if info.Name != displayName || logicalAttachmentLocator(info.AttachmentID, info.Name) != strings.TrimSpace(args.Locator) {
		return nil, errors.New("attachment not found")
	}
	if opened.Membership.ThreadID != r.threadID || opened.Membership.AttachmentID != attachmentID ||
		opened.Membership.Name != info.Name || normalizeMediaType(opened.Membership.DetectedMediaType) != normalizeMediaType(info.DetectedMediaType) ||
		opened.Membership.SizeBytes != info.SizeBytes || !strings.EqualFold(opened.Membership.ContentSHA256, info.ContentSHA256) {
		return nil, errors.New("attachment not found")
	}
	if info.UnicodeCodePoints == nil || info.LogicalLineCount == nil || normalizeMediaType(info.DetectedMediaType) != "text/plain; charset=utf-8" {
		return nil, errors.New("attachment.read supports only strict UTF-8 text attachments")
	}
	body, err := os.ReadFile(opened.Upload.FilePath)
	if err != nil || !utf8.Valid(body) || strings.IndexByte(string(body), 0) >= 0 {
		return nil, errors.New("attachment failed UTF-8 validation")
	}
	sum := sha256.Sum256(body)
	actualDigest := fmt.Sprintf("%x", sum[:])
	if int64(len(body)) != info.SizeBytes || !strings.EqualFold(actualDigest, info.ContentSHA256) ||
		opened.Membership.AttachmentID != attachmentID || !strings.EqualFold(opened.Membership.ContentSHA256, actualDigest) {
		return nil, errors.New("attachment failed canonical integrity validation")
	}
	maxBytes, maxLines := attachmentReadLimits(args)
	start := 0
	cursorExpiry := time.Now().Add(attachmentReadCursorTTL).UnixMilli()
	cursorKeyID := attachmentReadKeyID(time.Now())
	if strings.TrimSpace(args.Cursor) != "" {
		cursor, err := verifyAttachmentReadCursor(strings.TrimSpace(args.Cursor))
		if err != nil || cursor.ThreadID != r.threadID || cursor.RunID != r.id || cursor.AttachmentID != attachmentID || cursor.Digest != info.ContentSHA256 {
			return nil, errors.New("invalid attachment read cursor")
		}
		effectiveBytes, effectiveLines := attachmentReadLimits(args)
		if (args.MaxBytes != 0 && effectiveBytes != cursor.MaxBytes) || (args.MaxLines != 0 && effectiveLines != cursor.MaxLines) {
			return nil, errors.New("attachment read cursor limits changed")
		}
		start, maxBytes, maxLines = cursor.Offset, cursor.MaxBytes, cursor.MaxLines
		cursorExpiry = cursor.ExpiresAtMS
		cursorKeyID = cursor.KeyID
	}
	if start < 0 || start > len(body) || (start < len(body) && !utf8.RuneStart(body[start])) ||
		(start > 0 && start < len(body) && body[start-1] == '\r' && body[start] == '\n') {
		return nil, errors.New("invalid attachment read cursor offset")
	}
	end := start
	completedLines := 0
	for end < len(body) && end-start < maxBytes && completedLines < maxLines {
		size := 0
		lineBreak := false
		if body[end] == '\r' && end+1 < len(body) && body[end+1] == '\n' {
			size = 2
			lineBreak = true
		} else {
			_, size = utf8.DecodeRune(body[end:])
			lineBreak = body[end] == '\r' || body[end] == '\n'
		}
		if end+size-start > maxBytes {
			break
		}
		end += size
		if lineBreak {
			completedLines++
		}
	}
	if end == start && start < len(body) {
		if body[start] == '\r' && start+1 < len(body) && body[start+1] == '\n' {
			end = start + 2
		} else {
			_, size := utf8.DecodeRune(body[start:])
			end = start + size
		}
	}
	nextCursor := ""
	if end < len(body) {
		nextCursor, err = signAttachmentReadCursor(attachmentReadCursor{
			Version: 1, KeyID: cursorKeyID, AttachmentID: attachmentID, Digest: info.ContentSHA256,
			ThreadID: r.threadID, RunID: r.id, Offset: end, MaxBytes: maxBytes, MaxLines: maxLines,
			ExpiresAtMS: cursorExpiry,
		})
		if err != nil {
			return nil, err
		}
	}
	startPoint := utf8.RuneCount(body[:start])
	endPoint := startPoint + utf8.RuneCount(body[start:end])
	return map[string]any{
		"locator": args.Locator, "attachment_id": attachmentID, "name": info.Name,
		"content": string(body[start:end]), "content_sha256": info.ContentSHA256,
		"start_byte": start, "end_byte_exclusive": end,
		"start_code_point": startPoint, "end_code_point_exclusive": endPoint,
		"start_line": attachmentLogicalLineAt(body, start), "end_line": attachmentInclusiveEndLine(body, start, end),
		"starts_mid_line": attachmentStartsMidLine(body, start), "ends_mid_line": attachmentEndsMidLine(body, end),
		"next_cursor": nextCursor, "truncated": end < len(body),
	}, nil
}

func attachmentInclusiveEndLine(body []byte, start int, end int) int {
	if end <= start || len(body) == 0 {
		return 0
	}
	line := attachmentLogicalLineAt(body, start)
	for i := start; i < end; {
		if body[i] == '\r' && i+1 < end && body[i+1] == '\n' {
			if i+2 == end {
				return line
			}
			line++
			i += 2
			continue
		}
		if body[i] == '\r' || body[i] == '\n' {
			if i+1 == end {
				return line
			}
			line++
		}
		_, size := utf8.DecodeRune(body[i:])
		i += size
	}
	return line
}

func attachmentStartsMidLine(body []byte, start int) bool {
	return start > 0 && start <= len(body) && body[start-1] != '\r' && body[start-1] != '\n'
}

func attachmentEndsMidLine(body []byte, end int) bool {
	return end > 0 && end < len(body) && body[end-1] != '\r' && body[end-1] != '\n'
}

func attachmentLogicalLineAt(body []byte, offset int) int {
	if len(body) == 0 {
		return 0
	}
	if offset > len(body) {
		offset = len(body)
	}
	line := 1
	for i := 0; i < offset; i++ {
		switch body[i] {
		case '\r':
			line++
			if i+1 < offset && body[i+1] == '\n' {
				i++
			}
		case '\n':
			line++
		}
	}
	return line
}
