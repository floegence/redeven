package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"regexp"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

var canonicalMediaLocatorPattern = regexp.MustCompile("^media:v1:[a-f0-9]{64}$")

type canonicalImageSnapshot struct {
	Attachment    flruntime.MessageAttachment
	Body          []byte
	SHA256        string
	Width, Height int
}

// Product authorization and canonical membership are checked before any bytes
// are opened. Preview and model rereads share this single authority boundary.
func (s *Service) readCanonicalThreadImage(ctx context.Context, meta *session.Meta, threadID, locator, resourceRef string) (snapshot canonicalImageSnapshot, err error) {
	defer func() {
		var pathError *os.PathError
		if errors.As(err, &pathError) {
			err = errors.New("canonical image snapshot bytes are unavailable")
		}
	}()
	scope, err := s.flowerHistoryScope(ctx, meta, strings.TrimSpace(threadID))
	if err != nil {
		return canonicalImageSnapshot{}, err
	}
	attachment, turnID, err := s.findCanonicalAttachment(ctx, scope, threadID, "", func(a flruntime.MessageAttachment) bool {
		if locator != "" {
			candidate, err := a.Locator()
			return err == nil && candidate == locator
		}
		return a.ResourceRef == resourceRef
	})
	if err != nil {
		return canonicalImageSnapshot{}, errors.New("image snapshot is not admitted in this thread")
	}
	if !strings.HasPrefix(attachment.MIMEType, "image/") {
		return canonicalImageSnapshot{}, errors.New("canonical attachment is not an image")
	}
	maxBytes := maxImageReadBytes
	if computerFrameResourcePattern.MatchString(attachment.ResourceRef) {
		maxBytes = maxComputerFrameBytes
	}
	if attachment.SizeBytes <= 0 || attachment.SizeBytes > int64(maxBytes) {
		return canonicalImageSnapshot{}, errors.New("canonical image exceeds supported size")
	}
	var body []byte
	var expected string
	if isToolMediaRef(attachment.ResourceRef) {
		body, err = s.resolveToolMedia(ctx, attachment.ResourceRef)
		expected = toolMediaDescriptor(attachment.ResourceRef).SHA256
	} else {
		membership, err := canonicalUploadMembership(threadID, turnID, attachment)
		if err != nil {
			return canonicalImageSnapshot{}, err
		}
		expected = membership.ContentSHA256
		owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
		if err != nil {
			return canonicalImageSnapshot{}, err
		}
		if err := s.retainCanonicalUploadForOwner(ctx, owner, threadID, membership); err != nil {
			return canonicalImageSnapshot{}, err
		}
		upload, err := s.resolveLiveUpload(ctx, owner, threadID, turnID, membership.AttachmentID, membership)
		if err != nil {
			return canonicalImageSnapshot{}, err
		}
		if upload == nil || upload.Info == nil || upload.Info.Name != attachment.Name || normalizeMediaType(upload.Info.DetectedMediaType) != attachment.MIMEType || upload.Info.SizeBytes != attachment.SizeBytes || !strings.EqualFold(upload.Info.ContentSHA256, expected) {
			return canonicalImageSnapshot{}, errors.New("canonical upload descriptor changed")
		}
		body, err = readAttachmentSnapshot(ctx, upload.FilePath, attachment.SizeBytes)
	}
	if err != nil {
		return canonicalImageSnapshot{}, err
	}
	if err := ctx.Err(); err != nil {
		return canonicalImageSnapshot{}, err
	}
	digest := sha256.Sum256(body)
	actual := hex.EncodeToString(digest[:])
	if int64(len(body)) != attachment.SizeBytes || actual != expected {
		return canonicalImageSnapshot{}, errors.New("canonical image snapshot size or digest changed")
	}
	_, format, dimensions, err := decodeBoundedImageWithinLimit(body, maxBytes)
	if err != nil {
		return canonicalImageSnapshot{}, err
	}
	if "image/"+format != attachment.MIMEType {
		return canonicalImageSnapshot{}, errors.New("canonical image snapshot format changed")
	}
	return canonicalImageSnapshot{Attachment: attachment, Body: body, SHA256: actual, Width: dimensions.Width, Height: dimensions.Height}, nil
}
