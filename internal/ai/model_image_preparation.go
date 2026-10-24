package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
)

// Product policy, not an assertion about any provider's undocumented ceiling.
// Model screenshots preserve physical pixels; computer actions still use CSS
// viewport coordinates. Exact image.read results bypass lossy preparation.
const flowerModelRequestMaxBytes int64 = 32 << 20

func prepareModelScreenshot(ctx context.Context, attachment flprovider.Attachment, part ContentPart, original bool) (ContentPart, string, error) {
	if original || part.Type != "image" || !computerFrameResourcePattern.MatchString(attachment.ResourceRef) {
		return part, "", nil
	}
	prefix := "data:image/png;base64,"
	if part.MimeType != "image/png" || !strings.HasPrefix(part.FileURI, prefix) {
		return ContentPart{}, "", errors.New("computer screenshot requires authorized PNG bytes")
	}
	body, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(part.FileURI, prefix))
	if err != nil {
		return ContentPart{}, "", errors.New("invalid screenshot encoding")
	}
	prepared, err := flprovider.PrepareImage(ctx, body, flprovider.ImagePreparationOptions{JPEGQuality: 90, MinBytes: 256 << 10, MaxSourceBytes: maxComputerFrameBytes, MaxPixels: 32 << 20})
	if err != nil {
		return ContentPart{}, "", err
	}
	part.MimeType = prepared.MIMEType
	part.FileURI = "data:" + prepared.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(prepared.Bytes)
	if prepared.SHA256 == prepared.SourceSHA256 {
		return part, "", nil
	}
	notice := fmt.Sprintf("Model screenshot: %dx%d source pixels, unchanged dimensions; source_bytes=%d model_bytes=%d encoding=jpeg quality=90. Original snapshot remains available through image.read(locator); use a crop for fine text. Image pixel coordinates are not CSS viewport coordinates.", prepared.Width, prepared.Height, prepared.SourceBytes, len(prepared.Bytes))
	return part, notice, nil
}
