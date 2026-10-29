package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (r *run) callMCPWithImages(ctx context.Context, name string, args map[string]any) (any, error) {
	var attachments []ToolAttachment
	payload, err := r.mcpManager.call(ctx, name, args, func(result *mcp.CallToolResult) error {
		var extractErr error
		attachments, extractErr = r.admitMCPImages(ctx, result)
		return extractErr
	})
	return toolExecutionOutput{Payload: payload, Attachments: attachments}, err
}

// Only MCP's typed content establishes an image. Never scan arbitrary text,
// structured JSON, URLs or resource links for image-looking strings.
func (r *run) admitMCPImages(ctx context.Context, result *mcp.CallToolResult) ([]ToolAttachment, error) {
	if result == nil {
		return nil, errors.New("MCP returned no result")
	}
	content := append([]mcp.Content(nil), result.Content...)
	var attachments []ToolAttachment
	total := 0
	for i, item := range content {
		if err := ctx.Err(); err != nil {
			return attachments, err
		}
		var data []byte
		var mime string
		switch v := item.(type) {
		case *mcp.ImageContent:
			if v == nil || normalizeMediaType(v.MIMEType) == "" {
				return attachments, errors.New("MCP image is missing")
			}
			data, mime = v.Data, normalizeMediaType(v.MIMEType)
		case *mcp.EmbeddedResource:
			if v != nil && v.Resource != nil && strings.HasPrefix(normalizeMediaType(v.Resource.MIMEType), "image/") {
				data = v.Resource.Blob
				mime = normalizeMediaType(v.Resource.MIMEType)
			}
		}
		if mime == "" {
			continue
		}
		total += len(data)
		if len(attachments) >= 64 || total > 32<<20 || len(data) > maxImageReadBytes {
			return attachments, errors.New("MCP image result exceeds media limits; completed tool must not be replayed")
		}
		if r.host.saveToolMedia == nil {
			return attachments, errors.New("MCP image storage is unavailable")
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || "image/"+format != normalizeMediaType(mime) || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 32<<20 {
			return attachments, errors.New("MCP image content is invalid")
		}
		if format != "png" && format != "jpeg" && format != "webp" && format != "gif" {
			return attachments, errors.New("unsupported MCP image format")
		}
		hash := fmt.Sprintf("%x", sha256.Sum256(data))
		attachment := TargetToolAttachment{ResourceRef: "image://" + hash + "/" + format, Name: fmt.Sprintf("tool-image-%d.%s", len(attachments)+1, format), MIMEType: mime, SizeBytes: int64(len(data)), SHA256: hash}
		if err := r.host.saveToolMedia(ctx, attachment, data); err != nil {
			return attachments, err
		}
		attachments = append(attachments, toolAttachmentsFromTarget([]TargetToolAttachment{attachment})...)
		descriptor := flruntime.MessageAttachment{ResourceRef: attachment.ResourceRef, Name: attachment.Name, MIMEType: attachment.MIMEType, SizeBytes: attachment.SizeBytes}
		locator, err := descriptor.Locator()
		if err != nil {
			return attachments, err
		}
		info, _ := json.Marshal(map[string]any{"type": "image_attachment", "index": len(attachments) - 1, "locator": locator, "width": cfg.Width, "height": cfg.Height})
		content[i] = &mcp.TextContent{Text: string(info)}
	}
	result.Content = content
	return attachments, nil
}
