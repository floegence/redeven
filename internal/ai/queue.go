package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

func queuedInputView(threadID string, queued flruntime.QueuedInput) QueuedTurnView {
	view := QueuedTurnView{QueueID: queued.ID, Text: queued.Input.Text, CreatedAtUnixMs: queued.CreatedAt.UnixMilli()}
	for index, attachment := range queued.Input.Attachments {
		uploadID, _ := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		attachmentID := uploadID
		if attachmentID == "" {
			attachmentID = fmt.Sprintf("queued:%s:%d", queued.ID, index)
		}
		view.Attachments = append(view.Attachments, FlowerAttachmentView{AttachmentID: attachmentID, Name: attachment.Name,
			MimeType: attachment.MIMEType, SizeBytes: attachment.SizeBytes,
			URL: flowerAttachmentURL(uploadID, threadID, "", queued.ID)})
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

// SendQueuedInputNow ends the active response gracefully and starts the selected
// queued input through Floret; the product layer does not copy or resubmit it.
func (s *Service) SendQueuedInputNow(ctx context.Context, meta *session.Meta, threadID, queueID string) (flruntime.ThreadView, error) {
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
	controller, ok := s.threadRuntime.(flruntime.ThreadQueueController)
	if !ok {
		return flruntime.ThreadView{}, errors.New("queue sending is unavailable")
	}
	return controller.SendQueuedNow(ctxOrBackground(ctx), flruntime.PromoteQueuedInput{
		ThreadID: identity.ThreadID(threadID), QueueItemID: queueID, RequestKey: flruntime.RequestKey("send-queue-now:" + queueID),
	})
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

// EditQueuedInput updates pending text through Floret's canonical queue owner.
// Resource references and accepted runtime context are never reconstructed here.
func (s *Service) EditQueuedInput(ctx context.Context, meta *session.Meta, threadID, queueID string, req EditQueuedInputRequest) (flruntime.ThreadView, error) {
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
	if err := validateInlineTurnText(req.Text); err != nil {
		return flruntime.ThreadView{}, err
	}
	if req.ExpectedText == nil {
		return flruntime.ThreadView{}, errors.New("expected_text is required")
	}
	if !validClientRequestID(req.ClientRequestID) {
		return flruntime.ThreadView{}, errors.New("invalid client_request_id")
	}
	editor, ok := s.threadRuntime.(flruntime.ThreadQueueController)
	if !ok {
		return flruntime.ThreadView{}, errors.New("queue editing is unavailable")
	}
	return editor.EditQueued(ctxOrBackground(ctx), flruntime.EditQueuedInput{
		ThreadID: identity.ThreadID(threadID), QueueItemID: queueID, ExpectedText: *req.ExpectedText,
		Text: req.Text, RequestKey: flruntime.RequestKey("edit-queue:" + req.ClientRequestID),
	})
}
