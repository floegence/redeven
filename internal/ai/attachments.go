package ai

import (
	"encoding/base64"
	"errors"
	"io"
	"os"
	"strings"
	"unicode/utf8"
)

func (r *run) loadAttachmentForSidecar(in RunAttachmentIn) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	url := strings.TrimSpace(in.URL)
	if url == "" {
		return nil, errors.New("missing url")
	}

	const prefix = "/_redeven_proxy/api/ai/uploads/"
	if !strings.HasPrefix(url, prefix) {
		return nil, errors.New("unsupported attachment url")
	}
	uploadID := strings.TrimSpace(strings.TrimPrefix(url, prefix))
	if uploadID == "" {
		return nil, errors.New("invalid attachment url")
	}

	meta, dataPath, err := readUpload(r.uploadsDir, uploadID)
	if err != nil {
		return nil, err
	}

	out := map[string]any{
		"id":        meta.ID,
		"name":      meta.Name,
		"mime_type": meta.MimeType,
		"size":      meta.Size,
	}

	// Best-effort content embedding for common types.
	switch {
	case strings.HasPrefix(meta.MimeType, "text/") || meta.MimeType == "application/json" || meta.MimeType == "application/xml":
		const max = 200_000
		b, truncated, err := readFilePrefix(dataPath, max)
		if err != nil {
			return out, nil
		}
		if !utf8.Valid(b) {
			return out, nil
		}
		out["content_utf8"] = string(b)
		if truncated {
			out["truncated"] = true
		}
		return out, nil

	case strings.HasPrefix(meta.MimeType, "image/"):
		// Keep a conservative cap to avoid accidental huge prompts.
		const max = 2 << 20 // 2 MiB
		b, truncated, err := readFilePrefix(dataPath, max)
		if err != nil {
			return out, nil
		}
		out["content_base64"] = base64.StdEncoding.EncodeToString(b)
		if truncated {
			out["truncated"] = true
		}
		return out, nil

	default:
		return out, nil
	}
}

func readFilePrefix(path string, max int) ([]byte, bool, error) {
	if max <= 0 {
		max = 1
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer f.Close()

	buf := make([]byte, max+1)
	n, err := io.ReadFull(f, buf)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, false, err
	}
	b := buf[:n]
	truncated := false
	if len(b) > max {
		b = b[:max]
		truncated = true
	}
	return b, truncated, nil
}
