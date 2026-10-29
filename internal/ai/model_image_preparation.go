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
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
)

const flowerModelRequestMaxBytes int64 = 32 << 20
const flowerModelImagePolicy = "image-jpeg85-2560-v1"
const flowerModelImageMaxDimension = 2560

// Ephemeral transport facts, not authorization or a durable image record.
type modelImageRepresentation struct {
	Policy       string `json:"policy"`
	SHA256       string `json:"sha256"`
	SourceSHA256 string `json:"source_sha256"`
	SourceWidth  int    `json:"source_width"`
	SourceHeight int    `json:"source_height"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Orientation  int    `json:"orientation"`
}

func modelImageBytes(part ContentPart) ([]byte, error) {
	prefix := "data:" + normalizeMediaType(part.MimeType) + ";base64,"
	if !strings.HasPrefix(part.FileURI, prefix) {
		return nil, errors.New("model image requires authorized inline bytes")
	}
	encoded := strings.TrimPrefix(part.FileURI, prefix)
	if len(encoded) > base64.StdEncoding.EncodedLen(maxComputerFrameBytes) {
		return nil, &flprovider.MediaLimitError{Kind: "bytes", Actual: int64(base64.StdEncoding.DecodedLen(len(encoded))), Limit: maxComputerFrameBytes}
	}
	body, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("invalid model image encoding")
	}
	return body, nil
}
func isModelImagePart(part ContentPart) bool {
	kind := strings.ToLower(strings.TrimSpace(part.Type))
	return kind == "image" || (kind == "file" && strings.HasPrefix(normalizeMediaType(part.MimeType), "image/"))
}

type modelImagePreparationError struct{ cause error }

func (e *modelImagePreparationError) Error() string {
	return "image preparation failed: " + e.cause.Error()
}
func (e *modelImagePreparationError) Unwrap() error { return e.cause }
func (e *modelImagePreparationError) ProviderRetryAdvice() flprovider.RetryAdvice {
	return flprovider.RetryAdvice{Category: flprovider.RetryPermanent}
}

func prepareModelImage(ctx context.Context, part ContentPart) (out ContentPart, notice string, resultErr error) {
	defer func() {
		if resultErr != nil && !errors.Is(resultErr, context.Canceled) && !errors.Is(resultErr, context.DeadlineExceeded) {
			resultErr = &modelImagePreparationError{cause: resultErr}
		}
	}()
	if err := ctx.Err(); err != nil {
		return ContentPart{}, "", err
	}
	if !isModelImagePart(part) {
		return part, "", nil
	}
	part.Type = "image"
	part.MimeType = normalizeMediaType(part.MimeType)
	body, err := modelImageBytes(part)
	if err != nil {
		return ContentPart{}, "", err
	}
	if part.ModelImage != nil {
		info := part.ModelImage
		sourceHash, hashErr := hex.DecodeString(info.SourceSHA256)
		cfg, format, err := image.DecodeConfig(bytes.NewReader(body))
		if err != nil || hashErr != nil || len(sourceHash) != sha256.Size || info.Policy != flowerModelImagePolicy || info.SHA256 != fmt.Sprintf("%x", sha256.Sum256(body)) || "image/"+format != normalizeMediaType(part.MimeType) || cfg.Width != info.Width || cfg.Height != info.Height || max(cfg.Width, cfg.Height) > flowerModelImageMaxDimension || info.SourceWidth < 1 || info.SourceHeight < 1 || info.Orientation < 1 || info.Orientation > 8 {
			return ContentPart{}, "", errors.New("invalid prepared model image")
		}
		return part, "", nil
	}
	prepared, err := flprovider.PrepareModelImage(ctx, body, flprovider.ModelImageOptions{JPEGQuality: 85, MaxDimension: flowerModelImageMaxDimension, MaxSourceBytes: maxComputerFrameBytes, MaxPixels: 32 << 20})
	if err != nil {
		return ContentPart{}, "", err
	}
	if "image/"+detectedImageFormat(body) != normalizeMediaType(part.MimeType) {
		return ContentPart{}, "", errors.New("image content differs from its declared format")
	}
	part.MimeType = prepared.MIMEType
	part.FileURI = "data:" + prepared.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(prepared.Bytes)
	part.ModelImage = &modelImageRepresentation{Policy: flowerModelImagePolicy, SHA256: prepared.SHA256, SourceSHA256: prepared.SourceSHA256, SourceWidth: prepared.SourceWidth, SourceHeight: prepared.SourceHeight, Width: prepared.Width, Height: prepared.Height, Orientation: prepared.Orientation}
	notice = fmt.Sprintf("Model image: %dx%d; original: %dx%d; original_bytes=%d model_bytes=%d. Original-backed crops use original coordinates. Computer image handles use model_pixels; image_pixels and native/CSS coordinates retain their original units. Use an original-backed crop for fine text.", prepared.Width, prepared.Height, prepared.SourceWidth, prepared.SourceHeight, prepared.SourceBytes, len(prepared.Bytes))
	return part, notice, nil
}
func detectedImageFormat(body []byte) string {
	_, format, _ := image.DecodeConfig(bytes.NewReader(body))
	return format
}

// Every adapter shares this boundary, including direct calls and Desktop RPC.
// Prepared inputs are validated without a second lossy encoding.
func prepareModelGatewayImages(ctx context.Context, req ModelGatewayRequest) (ModelGatewayRequest, error) {
	messages := make([]Message, len(req.Messages))
	copy(messages, req.Messages)
	for i, msg := range messages {
		parts := append([]ContentPart(nil), msg.Content...)
		for j, part := range parts {
			if !isModelImagePart(part) {
				continue
			}
			prepared, _, err := prepareModelImage(ctx, part)
			if err != nil {
				return ModelGatewayRequest{}, fmt.Errorf("prepare model image %d/%d: %w", i, j, err)
			}
			parts[j] = prepared
		}
		messages[i].Content = parts
	}
	req.Messages = messages
	return req, nil
}
