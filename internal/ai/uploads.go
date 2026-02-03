package ai

import (
	"bytes"
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

func (s *Service) SaveUpload(r io.Reader, name string, mimeType string, maxBytes int64) (*UploadResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if r == nil {
		return nil, errors.New("missing file")
	}
	if maxBytes <= 0 {
		maxBytes = 10 << 20 // 10 MiB
	}

	id, err := newUploadID()
	if err != nil {
		return nil, err
	}

	name = strings.TrimSpace(name)
	if name == "" {
		name = "upload"
	}

	dir := strings.TrimSpace(s.uploadsDir)
	if dir == "" {
		return nil, errors.New("uploads not ready")
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
		_ = os.Remove(metaPath + ".tmp")
		return nil, err
	}

	return &UploadResponse{
		URL:      "/_redeven_proxy/api/ai/uploads/" + id,
		Name:     meta.Name,
		Size:     meta.Size,
		MimeType: meta.MimeType,
	}, nil
}

func (s *Service) OpenUpload(uploadID string) (*UploadResponse, string, error) {
	if s == nil {
		return nil, "", errors.New("nil service")
	}
	meta, dataPath, err := readUpload(s.uploadsDir, uploadID)
	if err != nil {
		return nil, "", err
	}
	return &UploadResponse{
		URL:      "/_redeven_proxy/api/ai/uploads/" + meta.ID,
		Name:     meta.Name,
		Size:     meta.Size,
		MimeType: meta.MimeType,
	}, dataPath, nil
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
