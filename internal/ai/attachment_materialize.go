package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

// Materialization grants access only to a fresh thread-owned copy, never the
// immutable backing path. Both upload and media reads use canonical authority.
func (r *run) toolAttachmentMaterialize(ctx context.Context, meta *session.Meta, locator string) (map[string]any, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if r == nil || r.stateDir == "" || r.threadID == "" {
		return nil, errors.New("attachment working directory unavailable")
	}
	canonicalRunID, canonicalThreadID, _ := r.floretCanonicalIdentity()
	if canonicalRunID == "" || canonicalThreadID != r.threadID || strings.TrimSpace(meta.EndpointID) != strings.TrimSpace(r.endpointID) || strings.TrimSpace(meta.UserPublicID) != strings.TrimSpace(r.userPublicID) || strings.TrimSpace(meta.ChannelID) != strings.TrimSpace(r.channelID) {
		return nil, errors.New("attachment not found")
	}
	var reader io.Reader
	var name, mime, digest string
	var size int64
	if canonicalMediaLocatorPattern.MatchString(locator) {
		if r.host.readImageAttachment == nil {
			return nil, errors.New("canonical image authority unavailable")
		}
		snapshot, err := r.host.readImageAttachment(ctx, meta, locator)
		if err != nil {
			return nil, err
		}
		reader, name, mime, size, digest = bytes.NewReader(snapshot.Body), snapshot.Attachment.Name, snapshot.Attachment.MIMEType, snapshot.Attachment.SizeBytes, snapshot.SHA256
	} else {
		opened, err := r.openToolAttachment(ctx, meta, locator)
		if err != nil {
			return nil, err
		}
		file, err := os.Open(opened.Upload.FilePath)
		if err != nil {
			return nil, errors.New("attachment bytes unavailable")
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("attachment bytes unavailable")
		}
		reader, name, mime, size, digest = file, opened.Upload.Info.Name, opened.Upload.Info.DetectedMediaType, opened.Upload.Info.SizeBytes, opened.Upload.Info.ContentSHA256
	}
	space, err := prepareTaskFiles(r.stateDir, r.threadID)
	if err != nil {
		return nil, err
	}
	result, err := materializeAttachment(ctx, space, reader, name, mime, size, digest)
	if err != nil {
		return nil, err
	}
	result["locator"] = locator
	return result, nil
}

type attachmentContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r attachmentContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func materializeAttachment(ctx context.Context, space taskFileSpace, source io.Reader, name, mime string, size int64, digest string) (_ map[string]any, err error) {
	if !taskFileComponent(name) || strings.ContainsAny(name, "\r\n") || size < 0 || size == int64(^uint64(0)>>1) {
		return nil, errors.New("invalid attachment metadata")
	}
	if decoded, e := hex.DecodeString(digest); e != nil || len(decoded) != sha256.Size {
		return nil, errors.New("invalid attachment digest")
	}
	root, err := os.OpenRoot(space.Scratch)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	var token [12]byte
	if _, err = rand.Read(token[:]); err != nil {
		return nil, err
	}
	dir := "attachment-" + hex.EncodeToString(token[:])
	if err = root.Mkdir(dir, 0700); err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = root.RemoveAll(dir)
		}
	}()
	staging := filepath.Join(dir, ".partial")
	file, err := root.OpenFile(staging, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	hash := sha256.New()
	count, copyErr := io.CopyBuffer(io.MultiWriter(file, hash), io.LimitReader(attachmentContextReader{ctx, source}, size+1), make([]byte, 32<<10))
	if err = errors.Join(copyErr, file.Close(), ctx.Err()); err != nil {
		return nil, err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if count != size || !strings.EqualFold(actual, digest) {
		return nil, errors.New("attachment failed canonical integrity validation")
	}
	// A unique directory prevents overwriting same-name uploads or edited copies.
	destination := filepath.Join(dir, name)
	if name == ".partial" {
		destination = filepath.Join(dir, "attachment.partial")
	}
	if err = root.Rename(staging, destination); err != nil {
		return nil, fmt.Errorf("publish attachment work copy: %w", err)
	}
	return map[string]any{"file_path": filepath.Join(space.Scratch, destination), "display_name": name, "mime_type": mime, "size_bytes": size, "sha256": actual}, nil
}

// In-memory consumers share bounded, cancellable reads and check the exact
// snapshot digest themselves. Materialization streams directly to its work copy.
func readAttachmentSnapshot(ctx context.Context, path string, size int64) ([]byte, error) {
	if size < 0 || size == int64(^uint64(0)>>1) {
		return nil, errors.New("invalid attachment size")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() != size {
		return nil, errors.New("attachment size differs from immutable metadata")
	}
	body, err := io.ReadAll(io.LimitReader(attachmentContextReader{ctxOrBackground(ctx), file}, size+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) != size {
		return nil, errors.New("attachment size differs from immutable metadata")
	}
	return body, ctxOrBackground(ctx).Err()
}
