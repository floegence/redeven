package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

func queuedInputView(queued flruntime.QueuedInput) QueuedTurnView {
	view := QueuedTurnView{QueueID: queued.ID, Text: queued.Input.Text, CreatedAtUnixMs: queued.CreatedAt.UnixMilli()}
	for _, attachment := range queued.Input.Attachments {
		uploadID, _ := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		view.Attachments = append(view.Attachments, FlowerAttachmentView{AttachmentID: uploadID, Name: attachment.Name,
			MimeType: attachment.MIMEType, SizeBytes: attachment.SizeBytes, LogicalLocator: attachment.ResourceRef})
	}
	return view
}

func (s *Service) DeleteQueuedInput(ctx context.Context, meta *session.Meta, threadID string, queueID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID, queueID = strings.TrimSpace(threadID), strings.TrimSpace(queueID)
	if threadID == "" || queueID == "" || s.threadRuntime == nil {
		return errors.New("invalid request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return err
	}
	_, err := s.threadRuntime.DeleteQueued(ctxOrBackground(ctx), flruntime.DeleteQueuedInput{ThreadID: identity.ThreadID(threadID), QueueItemID: queueID,
		RequestKey: flruntime.RequestKey("delete-queue:" + queueID)})
	return err
}

func (s *Service) PromoteQueuedInput(ctx context.Context, meta *session.Meta, threadID string, queueID string) (flruntime.ThreadView, error) {
	if s == nil {
		return flruntime.ThreadView{}, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return flruntime.ThreadView{}, err
	}
	threadID, queueID = strings.TrimSpace(threadID), strings.TrimSpace(queueID)
	if threadID == "" || queueID == "" || s.threadRuntime == nil {
		return flruntime.ThreadView{}, errors.New("invalid request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return flruntime.ThreadView{}, err
	}
	result, err := s.threadRuntime.PromoteQueued(ctxOrBackground(ctx), flruntime.PromoteQueuedInput{
		ThreadID: identity.ThreadID(threadID), QueueItemID: queueID,
		RequestKey: flruntime.RequestKey("promote-queue:" + queueID),
	})
	return result, err
}

func (s *Service) ReorderQueue(ctx context.Context, meta *session.Meta, threadID string, req ReorderQueueRequest) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" || s.threadRuntime == nil {
		return errors.New("invalid request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return err
	}
	requestID, err := newProductRequestID("reorder_queue_")
	if err != nil {
		return err
	}
	_, err = s.threadRuntime.ReorderQueue(ctxOrBackground(ctx), flruntime.ReorderQueueInput{ThreadID: identity.ThreadID(threadID),
		OrderedItemIDs: append([]string(nil), req.OrderedQueueIDs...), RequestKey: flruntime.RequestKey(requestID)})
	return err
}
