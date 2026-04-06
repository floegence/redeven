package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

type uploadMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	MimeType  string `json:"mime_type"`
	CreatedAt int64  `json:"created_at_unix_ms"`
}

func newUploadID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "upl_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Service) SaveUpload(ctx context.Context, endpointID string, r io.Reader, name string, mimeType string, maxBytes int64) (*UploadResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if r == nil {
		return nil, errors.New("missing file")
	}
	if maxBytes <= 0 {
		maxBytes = 10 << 20 // 10 MiB
	}
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return nil, errors.New("missing endpoint_id")
	}

	id, err := newUploadID()
	if err != nil {
		return nil, err
	}

	name = strings.TrimSpace(name)
	if name == "" {
		name = "upload"
	}

	s.mu.Lock()
	dir := strings.TrimSpace(s.uploadsDir)
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if dir == "" || db == nil {
		return nil, errors.New("uploads not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	dataPath := filepath.Join(dir, id+".data")
	metaPath := filepath.Join(dir, id+".json")

	// Write data with a hard cap.
	f, err := os.OpenFile(dataPath+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	limited := &io.LimitedReader{R: r, N: maxBytes + 1}
	n, err := io.Copy(f, limited)
	if err != nil {
		_ = os.Remove(dataPath + ".tmp")
		return nil, err
	}
	if n > maxBytes {
		_ = os.Remove(dataPath + ".tmp")
		return nil, fmt.Errorf("file too large (max %d bytes)", maxBytes)
	}

	// Detect mime type when missing/unknown.
	mt := strings.TrimSpace(mimeType)
	if mt == "" || mt == "application/octet-stream" {
		if _, err := f.Seek(0, 0); err == nil {
			head := make([]byte, 512)
			n, _ := f.Read(head)
			if n > 0 {
				mt = http.DetectContentType(head[:n])
			}
		}
	}
	if mt == "" {
		mt = "application/octet-stream"
	}

	meta := uploadMeta{
		ID:        id,
		Name:      name,
		Size:      n,
		MimeType:  mt,
		CreatedAt: time.Now().UnixMilli(),
	}
	mb, err := json.Marshal(meta)
	if err != nil {
		_ = os.Remove(dataPath + ".tmp")
		return nil, err
	}
	mb = append(mb, '\n')

	if err := os.WriteFile(metaPath+".tmp", mb, 0o600); err != nil {
		_ = os.Remove(dataPath + ".tmp")
		return nil, err
	}

	if err := os.Rename(dataPath+".tmp", dataPath); err != nil {
		_ = os.Remove(dataPath + ".tmp")
		_ = os.Remove(metaPath + ".tmp")
		return nil, err
	}
	if err := os.Rename(metaPath+".tmp", metaPath); err != nil {
		_ = os.Remove(dataPath)
		_ = os.Remove(metaPath + ".tmp")
		return nil, err
	}
	pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	err = db.InsertUpload(pctx, threadstore.UploadRecord{
		UploadID:          meta.ID,
		EndpointID:        endpointID,
		StorageRelPath:    filepath.Base(dataPath),
		Name:              meta.Name,
		MimeType:          meta.MimeType,
		SizeBytes:         meta.Size,
		State:             threadstore.UploadStateStaged,
		CreatedAtUnixMs:   meta.CreatedAt,
		DeleteAfterUnixMs: meta.CreatedAt + uploadStagedTTL.Milliseconds(),
	})
	cancel()
	if err != nil {
		_ = os.Remove(dataPath)
		_ = os.Remove(metaPath)
		return nil, err
	}

	return &UploadResponse{
		URL:      "/_redeven_proxy/api/ai/uploads/" + id,
		Name:     meta.Name,
		Size:     meta.Size,
		MimeType: meta.MimeType,
	}, nil
}

func (s *Service) OpenUpload(ctx context.Context, endpointID string, uploadID string) (*UploadResponse, string, error) {
	if s == nil {
		return nil, "", errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	uploadID = strings.TrimSpace(uploadID)
	if endpointID == "" || uploadID == "" {
		return nil, "", errors.New("invalid request")
	}
	s.mu.Lock()
	dir := strings.TrimSpace(s.uploadsDir)
	s.mu.Unlock()
	if dir == "" {
		return nil, "", errors.New("uploads not ready")
	}
	rec, err := s.ensureUploadRecord(ctx, endpointID, uploadID)
	if err != nil {
		return nil, "", err
	}
	if rec == nil {
		return nil, "", errors.New("not found")
	}

	paths := make([]string, 0, 2)
	if rel := filepath.Base(strings.TrimSpace(rec.StorageRelPath)); rel != "" && rel != "." {
		paths = append(paths, filepath.Join(dir, rel))
	}
	paths = append(paths, filepath.Join(dir, uploadID+".data"))
	for _, dataPath := range uniqueStrings(paths) {
		if _, statErr := os.Stat(dataPath); statErr == nil {
			return &UploadResponse{
				URL:      "/_redeven_proxy/api/ai/uploads/" + rec.UploadID,
				Name:     rec.Name,
				Size:     rec.SizeBytes,
				MimeType: rec.MimeType,
			}, dataPath, nil
		}
	}
	return nil, "", errors.New("not found")
}

func readUpload(uploadsDir string, uploadID string) (*uploadMeta, string, error) {
	uploadsDir = strings.TrimSpace(uploadsDir)
	uploadID = strings.TrimSpace(uploadID)
	if uploadsDir == "" || uploadID == "" {
		return nil, "", errors.New("invalid request")
	}

	metaPath := filepath.Join(uploadsDir, uploadID+".json")
	dataPath := filepath.Join(uploadsDir, uploadID+".data")

	mb, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, "", errors.New("not found")
	}
	var meta uploadMeta
	if err := json.Unmarshal(bytes.TrimSpace(mb), &meta); err != nil {
		return nil, "", errors.New("corrupt upload metadata")
	}

	if _, err := os.Stat(dataPath); err != nil {
		return nil, "", errors.New("not found")
	}
	return &meta, dataPath, nil
}
