package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// A disposable page of canonical resources. It is neither an ownership ledger
// nor a retention inventory: inactive paths and queued inputs remain protected.
type FlowerTaskMaterial struct {
	ID        string    `json:"id"`
	Locator   string    `json:"locator"`
	Name      string    `json:"name"`
	MIME      string    `json:"mime"`
	Size      int64     `json:"size"`
	Kind      string    `json:"kind"`
	URL       string    `json:"url"`
	ItemID    string    `json:"item_id"`
	TurnID    string    `json:"turn_id"`
	CreatedAt time.Time `json:"created_at"`
}
type FlowerTaskMaterials struct {
	Items      []FlowerTaskMaterial `json:"items"`
	NextCursor string               `json:"next_cursor,omitempty"`
}
type taskMaterialCursor struct{ Thread, Endpoint, Leaf, Before string }

func (s *Service) GetTaskMaterials(ctx context.Context, meta *session.Meta, threadID, cursor string) (FlowerTaskMaterials, error) {
	out := FlowerTaskMaterials{Items: []FlowerTaskMaterial{}}
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return out, err
	}
	var position taskMaterialCursor
	if len(cursor) > 5500 {
		return out, errors.New("invalid material cursor")
	}
	if cursor != "" {
		body, e := base64.RawURLEncoding.DecodeString(cursor)
		if e != nil || len(body) > 4096 || json.Unmarshal(body, &position) != nil || position.Thread != threadID || position.Endpoint != meta.EndpointID || position.Before == "" || position.Leaf == "" {
			return out, errors.New("invalid material cursor")
		}
	}
	// One bounded window per request, even if this interval has no attachments.
	// The caller follows the cursor; empty pages never mean history is exhausted.
	view, window, err := readFlowerHistory(ctx, s.threadRuntime, scope, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(threadID), AnchorID: position.Before, Direction: flruntime.ThreadWindowBefore, Limit: 50, PreviewBytes: 128, ActivityFields: true})
	if err != nil {
		return out, err
	}
	if position.Leaf != "" && position.Leaf != window.LeafID {
		return out, errors.New("conversation changed; refresh files")
	}
	seen := map[string]bool{}
	for i := len(view.Items) - 1; i >= 0; i-- {
		item := view.Items[i]
		for _, attachment := range item.Attachments {
			locator, e := attachment.Locator()
			if e != nil {
				return out, e
			}
			if seen[locator] {
				continue
			}
			seen[locator] = true
			kind, link := "input", ""
			if isToolMediaRef(attachment.ResourceRef) {
				kind = "media"
				link = "/_redeven_proxy/api/ai/threads/" + url.PathEscape(threadID) + "/tool-media/locator/" + strings.TrimPrefix(locator, "media:v1:")
			} else {
				id, _, e := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
				if e != nil {
					return out, e
				}
				link = flowerAttachmentURL(id, threadID, item.TurnID.String(), "")
				locator = logicalAttachmentLocator(id, attachment.Name)
			}
			out.Items = append(out.Items, FlowerTaskMaterial{ID: locator, Locator: locator, Name: attachment.Name, MIME: attachment.MIMEType, Size: attachment.SizeBytes, Kind: kind, URL: link, ItemID: item.ID, TurnID: item.TurnID.String(), CreatedAt: item.CreatedAt})
		}
	}
	if window.HasBefore {
		body, err := json.Marshal(taskMaterialCursor{Thread: threadID, Endpoint: meta.EndpointID, Leaf: window.LeafID, Before: window.FirstItemID})
		if err != nil {
			return out, err
		}
		out.NextCursor = base64.RawURLEncoding.EncodeToString(body)
	}
	return out, nil
}
