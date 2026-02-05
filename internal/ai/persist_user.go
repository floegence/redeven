package ai

import (
	"encoding/json"
	"errors"
	"path"
	"strings"
)

const uploadURLPrefix = "/_redeven_proxy/api/ai/uploads/"

func buildUserMessageJSON(messageID string, input RunInput, uploadsDir string, createdAtUnixMs int64) (string, string, error) {
	id := strings.TrimSpace(messageID)
	if id == "" {
		return "", "", errors.New("missing message_id")
	}

	blocks := make([]any, 0, 8)

	// Attachments first (aligned with ChatProvider.createUserMessageBlocks()).
	for _, a := range input.Attachments {
		url := strings.TrimSpace(a.URL)
		if url == "" {
			continue
		}

		// Best-effort metadata lookup (for size + accurate mime).
		name := strings.TrimSpace(a.Name)
		mimeType := strings.TrimSpace(a.MimeType)
		var size int64

		if strings.HasPrefix(url, uploadURLPrefix) {
			uploadID := strings.TrimSpace(strings.TrimPrefix(url, uploadURLPrefix))
			uploadID = strings.Trim(path.Clean("/"+uploadID), "/")
			if uploadID != "" {
				if meta, _, err := readUpload(uploadsDir, uploadID); err == nil && meta != nil {
					if strings.TrimSpace(name) == "" {
						name = strings.TrimSpace(meta.Name)
					}
					if strings.TrimSpace(mimeType) == "" {
						mimeType = strings.TrimSpace(meta.MimeType)
					}
					size = meta.Size
				}
			}
		}

		if strings.HasPrefix(strings.ToLower(mimeType), "image/") {
			blocks = append(blocks, persistedImageBlock{Type: "image", Src: url, Alt: name})
			continue
		}
		blocks = append(blocks, persistedFileBlock{
			Type:     "file",
			Name:     name,
			Size:     size,
			MimeType: mimeType,
			URL:      url,
		})
	}

	text := strings.TrimSpace(input.Text)
	if text != "" {
		blocks = append(blocks, persistedTextBlock{Type: "text", Content: text})
	}
	if len(blocks) == 0 {
		return "", "", errors.New("empty input")
	}

	msg := persistedMessage{
		ID:        id,
		Role:      "user",
		Blocks:    blocks,
		Status:    "complete",
		Timestamp: createdAtUnixMs,
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return "", "", err
	}
	return string(b), text, nil
}
