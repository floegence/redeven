package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

func queuedInputFollowupView(queued flruntime.QueuedInput, position int) FollowupItemView {
	view := FollowupItemView{FollowupID: queued.ID, Lane: "queued", Text: queued.Input.Text,
		Position: position, CreatedAtUnixMs: queued.CreatedAt.UnixMilli()}
	for _, attachment := range queued.Input.Attachments {
		uploadID, _ := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		view.Attachments = append(view.Attachments, FollowupAttachmentView{AttachmentID: uploadID, Name: attachment.Name,
			MimeType: attachment.MIMEType, SizeBytes: attachment.SizeBytes, LogicalLocator: attachment.ResourceRef})
	}
	return view
}

func (s *Service) ListFollowups(ctx context.Context, meta *session.Meta, threadID string, limit int) (*ListFollowupsResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRead(meta); err != nil {
		return nil, err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" || s.threadRuntime == nil {
		return nil, errors.New("invalid request")
	}
	current, err := s.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(threadID))
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(current.Queue) > limit {
		current.Queue = current.Queue[:limit]
	}
	paused := ""
	for _, interaction := range current.Interactions {
		if !interaction.Resolved && interaction.Kind == flruntime.ThreadInteractionInput && len(current.Queue) > 0 {
			paused = "waiting_user"
			break
		}
	}
	out := &ListFollowupsResponse{Revision: int64(current.ViewVersion), PausedReason: paused,
		Queued: make([]FollowupItemView, 0, len(current.Queue)), Drafts: []FollowupItemView{}}
	for index, queued := range current.Queue {
		out.Queued = append(out.Queued, queuedInputFollowupView(queued, index+1))
	}
	return out, nil
}

func (s *Service) DeleteFollowup(ctx context.Context, meta *session.Meta, threadID string, followupID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID, followupID = strings.TrimSpace(threadID), strings.TrimSpace(followupID)
	if threadID == "" || followupID == "" || s.threadRuntime == nil {
		return errors.New("invalid request")
	}
	_, err := s.threadRuntime.DeleteQueued(ctxOrBackground(ctx), flruntime.DeleteQueuedInput{ThreadID: identity.ThreadID(threadID), QueueItemID: followupID,
		RequestKey: flruntime.RequestKey("delete-queue:" + followupID)})
	return err
}

func (s *Service) PromoteFollowup(ctx context.Context, meta *session.Meta, threadID string, followupID string) (flruntime.ThreadView, error) {
	if s == nil {
		return flruntime.ThreadView{}, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return flruntime.ThreadView{}, err
	}
	threadID, followupID = strings.TrimSpace(threadID), strings.TrimSpace(followupID)
	if threadID == "" || followupID == "" || s.threadRuntime == nil {
		return flruntime.ThreadView{}, errors.New("invalid request")
	}
	result, err := s.threadRuntime.PromoteQueued(ctxOrBackground(ctx), flruntime.PromoteQueuedInput{
		ThreadID: identity.ThreadID(threadID), QueueItemID: followupID,
		RequestKey: flruntime.RequestKey("promote-queue:" + followupID),
	})
	return result, err
}

func (s *Service) ReorderFollowups(ctx context.Context, meta *session.Meta, threadID string, req ReorderFollowupsRequest) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	if strings.TrimSpace(req.Lane) != "queued" {
		return errors.New("draft ordering is owned by the client composer store")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" || s.threadRuntime == nil {
		return errors.New("invalid request")
	}
	_, err := s.threadRuntime.ReorderQueue(ctxOrBackground(ctx), flruntime.ReorderQueueInput{ThreadID: identity.ThreadID(threadID),
		OrderedItemIDs: append([]string(nil), req.OrderedFollowupIDs...), RequestKey: flruntime.RequestKey("reorder-queue:" + threadID + ":" + strings.Join(req.OrderedFollowupIDs, ","))})
	return err
}
