package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/session"
	_ "golang.org/x/image/webp"
)

const maxImageReadBytes = 10 << 20

var ErrThreadImageModelUnsupported = errors.New("this thread contains images; select an image-capable model")

var imageSnapshotResourcePattern = regexp.MustCompile(`^image://[a-f0-9]{64}/(?:png|jpeg|webp)$`)

func isToolMediaRef(ref string) bool {
	return computerFrameResourcePattern.MatchString(ref) || imageSnapshotResourcePattern.MatchString(ref)
}

func toolMediaDescriptor(ref string) TargetToolAttachment {
	out := TargetToolAttachment{ResourceRef: ref}
	if computerFrameResourcePattern.MatchString(ref) {
		out.SHA256 = ref[strings.LastIndexByte(ref, '/')+1:]
		out.MIMEType = "image/png"
	} else if imageSnapshotResourcePattern.MatchString(ref) {
		parts := strings.Split(strings.TrimPrefix(ref, "image://"), "/")
		out.SHA256, out.MIMEType = parts[0], "image/"+parts[1]
	}
	return out
}

func validateToolMedia(attachment TargetToolAttachment, body []byte) error {
	if computerFrameResourcePattern.MatchString(attachment.ResourceRef) {
		return validateComputerFrame(attachment, body)
	}
	expected := toolMediaDescriptor(attachment.ResourceRef)
	if !imageSnapshotResourcePattern.MatchString(attachment.ResourceRef) || attachment.MIMEType != expected.MIMEType || attachment.SHA256 != expected.SHA256 || attachment.SizeBytes != int64(len(body)) {
		return errors.New("invalid image snapshot descriptor")
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != attachment.SHA256 {
		return errors.New("image snapshot content changed")
	}
	_, format, _, err := decodeBoundedImage(body)
	if err != nil {
		return err
	}
	if "image/"+format != expected.MIMEType {
		return errors.New("image snapshot format changed")
	}
	return nil
}

func decodeBoundedImage(body []byte) (image.Image, string, image.Config, error) {
	return decodeBoundedImageWithinLimit(body, maxImageReadBytes)
}

func decodeBoundedImageWithinLimit(body []byte, maxBytes int) (image.Image, string, image.Config, error) {
	if len(body) == 0 || len(body) > maxBytes {
		return nil, "", image.Config{}, fmt.Errorf("image exceeds %d MiB; choose a smaller image", maxBytes>>20)
	}
	dimensions, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		return nil, "", dimensions, errors.New("image is damaged or unsupported; use PNG, JPEG, WebP or GIF")
	}
	switch format {
	case "png", "jpeg", "webp", "gif":
	default:
		return nil, "", dimensions, errors.New("unsupported image format; use PNG, JPEG, WebP or GIF")
	}
	if dimensions.Width < 1 || dimensions.Height < 1 || dimensions.Width > 16384 || dimensions.Height > 16384 || int64(dimensions.Width)*int64(dimensions.Height) > 32<<20 {
		return nil, "", dimensions, errors.New("image dimensions exceed 16384 pixels per side or 32 megapixels; crop or resize the image")
	}
	decoded, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, "", dimensions, errors.New("image is damaged; save a valid image and retry")
	}
	return decoded, format, dimensions, nil
}

type imageReadResult struct {
	FilePath    string `json:"file_path,omitempty"`
	Locator     string `json:"locator,omitempty"`
	DisplayName string `json:"display_name"`
	MIMEType    string `json:"mime_type"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	SizeBytes   int64  `json:"size_bytes"`
	FirstFrame  bool   `json:"first_frame,omitempty"`
}

func imageSnapshot(body []byte, name string) (TargetToolAttachment, imageReadResult, []byte, error) {
	decoded, format, dimensions, err := decodeBoundedImage(body)
	if err != nil {
		return TargetToolAttachment{}, imageReadResult{}, nil, err
	}
	firstFrame := format == "gif"
	if firstFrame {
		var output bytes.Buffer
		if err := png.Encode(&output, decoded); err != nil {
			return TargetToolAttachment{}, imageReadResult{}, nil, err
		}
		body, format = output.Bytes(), "png"
		if len(body) > maxImageReadBytes {
			return TargetToolAttachment{}, imageReadResult{}, nil, errors.New("first GIF frame exceeds 10 MiB; choose a smaller image")
		}
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(body))
	name = strings.ToValidUTF8(filepath.Base(strings.TrimSpace(name)), "?")
	if name == "" || name == "." {
		name = "image." + format
	}
	attachment := TargetToolAttachment{ResourceRef: "image://" + hash + "/" + format, Name: name, MIMEType: "image/" + format, SizeBytes: int64(len(body)), SHA256: hash}
	return attachment, imageReadResult{DisplayName: name, MIMEType: attachment.MIMEType, Width: dimensions.Width, Height: dimensions.Height, SizeBytes: attachment.SizeBytes, FirstFrame: firstFrame}, body, nil
}

func (r *run) toolImageRead(ctx context.Context, meta *session.Meta, toolID string, args map[string]any) (any, error) {
	if meta == nil || !meta.CanRead {
		return nil, errors.New("read permission denied")
	}
	if !r.supportsImageInput {
		return nil, errors.New("this model does not support image input; select an image-capable model to inspect the image")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	filePath, hasPath := args["file_path"]
	locator, hasLocator := args["locator"]
	if hasPath == hasLocator {
		return nil, errors.New("provide exactly one of file_path or locator")
	}
	if hasLocator {
		if _, hasTarget := args["target_id"]; hasTarget {
			return nil, errors.New("locator mode does not accept target_id")
		}
		value, ok := locator.(string)
		if !ok || !canonicalMediaLocatorPattern.MatchString(value) {
			return nil, errors.New("invalid canonical image locator")
		}
		if r.host.readImageAttachment == nil {
			return nil, errors.New("canonical image authority is unavailable")
		}
		snapshot, err := r.host.readImageAttachment(ctx, meta, value)
		if err != nil {
			return nil, err
		}
		a := snapshot.Attachment
		return toolExecutionOutput{Payload: imageReadResult{Locator: value, DisplayName: a.Name, MIMEType: a.MIMEType, Width: snapshot.Width, Height: snapshot.Height, SizeBytes: a.SizeBytes}, Attachments: []ToolAttachment{{ResourceRef: a.ResourceRef, Name: a.Name, MIMEType: a.MIMEType, SizeBytes: a.SizeBytes, SHA256: snapshot.SHA256}}}, nil
	}
	if value, ok := filePath.(string); !ok || strings.TrimSpace(value) == "" {
		return nil, errors.New("file_path must be a non-empty string")
	}
	if r.host.saveToolMedia == nil {
		return nil, errors.New("image snapshot storage is unavailable; retry after reconnecting")
	}
	var body []byte
	var name string
	var sourcePath string
	if r.shouldRouteTargetTool("image.read") {
		result, err := r.execTargetTool(ctx, toolID, "image.read", args)
		if err != nil {
			return nil, err
		}
		execution, ok := result.(toolExecutionOutput)
		if !ok || len(execution.Attachments) != 1 {
			return nil, errors.New("target cannot return an image snapshot; choose an available file-reading target")
		}
		resolver, ok := r.targetToolExecutor.(TargetToolAttachmentResolver)
		if !ok {
			return nil, errors.New("target image resolver is unavailable")
		}
		attachment := execution.Attachments[0]
		body, err = resolver.ResolveTargetToolAttachment(ctx, attachment.ResourceRef)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(body)
		if attachment.SizeBytes != int64(len(body)) || attachment.SHA256 != hex.EncodeToString(sum[:]) {
			return nil, errors.New("target image content changed; read it again")
		}
		name = attachment.Name
	} else {
		path, err := r.resolveStructuredToolPath(anyToString(args["file_path"]), true)
		if err != nil {
			return nil, mapToolFilePathError(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("file_path must reference a regular image file")
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		info, err = file.Stat()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, errors.New("file_path must reference a regular image file")
		}
		if info.Size() > maxImageReadBytes {
			return nil, errors.New("image exceeds 10 MiB; choose a smaller image")
		}
		body, err = io.ReadAll(io.LimitReader(file, maxImageReadBytes+1))
		if err != nil {
			return nil, err
		}
		name = info.Name()
		sourcePath = path
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	attachment, result, body, err := imageSnapshot(body, name)
	if err != nil {
		return nil, err
	}
	result.FilePath = sourcePath
	if err := r.host.saveToolMedia(ctx, attachment, body); err != nil {
		return nil, err
	}
	return toolExecutionOutput{Payload: result, Attachments: toolAttachmentsFromTarget([]TargetToolAttachment{attachment})}, nil
}

func (r *run) resolveFloretToolMedia(ctx context.Context, attachment flprovider.Attachment) (ContentPart, error) {
	if !r.supportsImageInput {
		return ContentPart{}, errors.New("model does not support the image retained in this thread; select an image-capable model")
	}
	var body []byte
	var err error
	if r.host.readToolMedia != nil {
		body, err = r.host.readToolMedia(ctx, attachment.ResourceRef)
	} else if resolver, ok := r.targetToolExecutor.(TargetToolAttachmentResolver); ok && computerFrameResourcePattern.MatchString(attachment.ResourceRef) {
		body, err = resolver.ResolveTargetToolAttachment(ctx, attachment.ResourceRef)
	} else {
		err = errors.New("tool image resolver is unavailable")
	}
	if err != nil {
		return ContentPart{}, err
	}
	descriptor := toolMediaDescriptor(attachment.ResourceRef)
	descriptor.SizeBytes = int64(len(body))
	if descriptor.MIMEType != attachment.MIMEType || attachment.SizeBytes != int64(len(body)) {
		return ContentPart{}, errors.New("canonical tool image descriptor does not match snapshot")
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != descriptor.SHA256 {
		return ContentPart{}, errors.New("canonical tool image content changed")
	}
	return ContentPart{Type: "image", Text: attachment.Name, MimeType: descriptor.MIMEType, FileURI: "data:" + descriptor.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(body)}, nil
}
