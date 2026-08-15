package ai

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

var ErrRunChanged = errors.New("run changed")
var ErrWaitingPromptChanged = errors.New("waiting prompt changed")
var ErrWaitingUserQueueConflict = errors.New("waiting-user queue request conflicts with waiting response")
var ErrTurnIdempotencyConflict = errors.New("turn id conflicts with a different frozen command")
var ErrInitialTurnStateConflict = errors.New("initial turn frozen state conflicts with canonical creation")
var ErrReadOnlyThread = errors.New("thread is read only")

const (
	LongTextAttachmentRequiredErrorCode = "long_text_attachment_required"
	inlineTurnTextCodePointLimit        = 50_000
)

var ErrLongTextAttachmentRequired = threadstore.ErrLongTextAttachmentRequired

type typedSendOperation struct {
	done chan struct{}
	resp SendUserTurnResponse
	err  error
}

type SendUserTurnRequest struct {
	ClientRequestID   string               `json:"client_request_id,omitempty"`
	ThreadID          string               `json:"thread_id"`
	Create            *CreateThreadRequest `json:"create,omitempty"`
	StagingScopeID    string               `json:"staging_scope_id,omitempty"`
	StagingCapability string               `json:"-"`
	Model             string               `json:"model,omitempty"`
	Input             RunInput             `json:"input"`
	Options           RunOptions           `json:"options"`
}

type SendUserTurnResponse struct {
	ClientRequestID       string               `json:"client_request_id,omitempty"`
	ThreadID              string               `json:"thread_id,omitempty"`
	RunID                 string               `json:"run_id"`
	TurnID                string               `json:"turn_id"`
	Kind                  string               `json:"kind"` // "start" | "queued"
	QueueID               string               `json:"queue_id,omitempty"`
	QueuePosition         int                  `json:"queue_position,omitempty"`
	AppliedPermissionType string               `json:"applied_permission_type,omitempty"`
	Current               flruntime.ThreadView `json:"current"`
}

type preparedUserTurn struct {
	CreatedAtUnixMs       int64
	UploadIDs             []string
	OwnerUserHash         string
	StagingScope          *threadstore.UploadStagingScope
	AttachmentClaimPolicy threadstore.AttachmentClaimPolicy
}

func validateInlineTurnText(text string) error {
	if !utf8.ValidString(text) {
		return errors.New("invalid text content")
	}
	if utf8.RuneCountInString(text) > inlineTurnTextCodePointLimit {
		return ErrLongTextAttachmentRequired
	}
	return nil
}

func (s *Service) SendUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	if s == nil {
		return SendUserTurnResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SendUserTurnResponse{}, err
	}
	if err := validateInlineTurnText(req.Input.Text); err != nil {
		return SendUserTurnResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" {
		return SendUserTurnResponse{}, errors.New("invalid request")
	}
	if req.Create != nil {
		if threadID != "" {
			return SendUserTurnResponse{}, errors.New("thread_id must be omitted for thread creation")
		}
		return s.sendInitialUserTurn(ctx, meta, req)
	}
	if threadID == "" {
		return SendUserTurnResponse{}, errors.New("invalid request")
	}
	if strings.TrimSpace(req.ClientRequestID) == "" {
		requestID, err := newProductRequestID("send_")
		if err != nil {
			return SendUserTurnResponse{}, err
		}
		req.ClientRequestID = requestID
	}
	if response, handled, err := s.sendTypedExistingThread(ctx, meta, req); handled {
		return response, err
	}
	return SendUserTurnResponse{}, errors.New("floret thread runtime not ready")
}

// sendTypedExistingThread is the direct Flower command boundary. It is kept
// deliberately small: product authorization and run preparation happen once,
// then Floret owns the thread lifecycle. No Redeven admission/queue row is
// created for this path.
func (s *Service) sendTypedExistingThread(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, bool, error) {
	if s == nil || strings.TrimSpace(req.ClientRequestID) == "" || strings.TrimSpace(req.ThreadID) == "" {
		return SendUserTurnResponse{}, false, nil
	}
	if s.threadRuntime == nil || s.floretEffects == nil {
		return SendUserTurnResponse{}, false, nil
	}
	executionKey := strings.TrimSpace(req.ClientRequestID)
	opKey := runThreadKey(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(req.ThreadID)) + "\x00" + executionKey
	s.typedSendMu.Lock()
	if existing := s.typedSendOps[opKey]; existing != nil {
		s.typedSendMu.Unlock()
		select {
		case <-existing.done:
			return existing.resp, true, existing.err
		case <-ctx.Done():
			return SendUserTurnResponse{}, true, ctx.Err()
		}
	}
	operation := &typedSendOperation{done: make(chan struct{})}
	s.typedSendOps[opKey] = operation
	s.typedSendMu.Unlock()
	finish := func(resp SendUserTurnResponse, err error) (SendUserTurnResponse, bool, error) {
		s.typedSendMu.Lock()
		operation.resp, operation.err = resp, err
		close(operation.done)
		delete(s.typedSendOps, opKey)
		s.typedSendMu.Unlock()
		return resp, true, err
	}
	if existing, found, viewErr := s.typedSendLookup(ctx, req.ThreadID, executionKey); viewErr != nil {
		return finish(SendUserTurnResponse{}, viewErr)
	} else if found {
		return finish(existing, nil)
	}
	if turnInput, ok, inputErr := immediateTypedTurnInput(req.Input); inputErr != nil {
		return finish(SendUserTurnResponse{}, inputErr)
	} else if ok {
		s.floretEffects.put(identity.ThreadID(req.ThreadID), executionKey, floretEffectRequest{meta: *meta, req: req})
		result, sendErr := s.threadRuntime.Send(ctx, flruntime.SendInput{
			ThreadID: identity.ThreadID(req.ThreadID), Input: turnInput, RequestKey: flruntime.RequestKey(executionKey),
		})
		if sendErr != nil {
			s.floretEffects.drop(identity.ThreadID(req.ThreadID), executionKey)
			return finish(SendUserTurnResponse{}, sendErr)
		}
		response := SendUserTurnResponse{
			ClientRequestID: req.ClientRequestID,
			ThreadID:        string(result.ThreadID),
			TurnID:          string(result.TurnID),
			RunID:           executionKey,
			Kind:            "start",
			Current:         publicFloretThreadView(result),
		}
		if queuedInput, ok := queuedInputFor(result, executionKey); ok {
			response.Kind = "queued"
			response.QueueID = queuedInput.ID
			response.QueuePosition = len(result.Queue)
			response.TurnID = ""
			response.RunID = ""
		}
		return finish(response, nil)
	}
	effect, err := s.prepareThreadEffect(meta, executionKey, RunStartRequest{
		ThreadID:          strings.TrimSpace(req.ThreadID),
		Model:             strings.TrimSpace(req.Model),
		Input:             req.Input,
		Options:           req.Options,
		StagingScopeID:    req.StagingScopeID,
		StagingCapability: req.StagingCapability,
	})
	if err != nil {
		return finish(SendUserTurnResponse{}, err)
	}
	projection, err := floretContextProjectionForInputWithAuthority(effect.req.Input, effect.builder.canonicalReferenceAuthority)
	if err != nil {
		return finish(SendUserTurnResponse{}, err)
	}
	turnInput, err := effect.builder.floretTurnInput(ctx, effect.req.Input, projection.References)
	if err != nil {
		return finish(SendUserTurnResponse{}, err)
	}
	s.floretEffects.put(identity.ThreadID(req.ThreadID), executionKey, floretEffectRequest{meta: *meta, req: req, effect: effect})
	result, err := s.threadRuntime.Send(ctx, flruntime.SendInput{
		ThreadID: identity.ThreadID(req.ThreadID), Input: turnInput, RequestKey: flruntime.RequestKey(executionKey),
	})
	if err != nil {
		s.floretEffects.drop(identity.ThreadID(req.ThreadID), executionKey)
		return finish(SendUserTurnResponse{}, err)
	}
	response := SendUserTurnResponse{
		ClientRequestID: req.ClientRequestID,
		ThreadID:        string(result.ThreadID),
		TurnID:          string(result.TurnID),
		RunID:           executionKey,
		Kind:            "start",
		Current:         publicFloretThreadView(result),
	}
	if queuedInput, ok := queuedInputFor(result, executionKey); ok {
		response.Kind = "queued"
		response.QueueID = queuedInput.ID
		response.QueuePosition = len(result.Queue)
		response.TurnID = ""
		response.RunID = ""
	}
	return finish(response, nil)
}

func queuedInputFor(view flruntime.ThreadView, requestKey string) (flruntime.QueuedInput, bool) {
	for _, queued := range view.Queue {
		if queued.RequestKey == requestKey {
			return queued, true
		}
	}
	return flruntime.QueuedInput{}, false
}

func immediateTypedTurnInput(input RunInput) (flruntime.TurnInput, bool, error) {
	if len(input.Attachments) > 0 || input.ContextAction != nil || input.StructuredResponse != nil || len(input.SecretAnswers) > 0 {
		return flruntime.TurnInput{}, false, nil
	}
	turnInput := flruntime.TurnInput{Text: strings.TrimSpace(input.Text)}
	if err := turnInput.Validate(); err != nil {
		return flruntime.TurnInput{}, true, err
	}
	return turnInput, true, nil
}

func (s *Service) typedSendLookup(ctx context.Context, threadID, requestID string) (SendUserTurnResponse, bool, error) {
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return SendUserTurnResponse{}, false, nil
	}
	view, err := typed.View(ctx, identity.ThreadID(strings.TrimSpace(threadID)))
	if err != nil {
		return SendUserTurnResponse{}, false, err
	}
	userID := "user:" + strings.TrimSpace(requestID)
	for _, item := range view.Items {
		if item.ID != userID {
			continue
		}
		return SendUserTurnResponse{ClientRequestID: requestID, ThreadID: threadID, TurnID: string(item.TurnID), RunID: requestID, Kind: "start", Current: publicFloretThreadView(view)}, true, nil
	}
	for _, queued := range view.Queue {
		if queued.RequestKey == requestID {
			return SendUserTurnResponse{ClientRequestID: requestID, ThreadID: threadID, QueueID: queued.ID, Kind: "queued", Current: publicFloretThreadView(view)}, true, nil
		}
	}
	return SendUserTurnResponse{}, false, nil
}

func (s *Service) SubmitRequestUserInputResponse(ctx context.Context, meta *session.Meta, req SubmitRequestUserInputResponseRequest) (SubmitRequestUserInputResponseResponse, error) {
	if s == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return SubmitRequestUserInputResponseResponse{}, errors.New("invalid request")
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	view, err := typed.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	promptID := strings.TrimSpace(req.Response.PromptID)
	if promptID == "" {
		return SubmitRequestUserInputResponseResponse{}, ErrWaitingPromptChanged
	}
	interactionID := ""
	for _, interaction := range view.Interactions {
		if interaction.Kind != flruntime.ThreadInteractionInput || interaction.Resolved {
			continue
		}
		if strings.TrimSpace(interaction.ID) == promptID || strings.TrimSpace(interaction.ToolCallID) == promptID {
			interactionID = strings.TrimSpace(interaction.ID)
			break
		}
	}
	if interactionID == "" {
		return SubmitRequestUserInputResponseResponse{}, ErrWaitingPromptChanged
	}
	answers := make(map[string]string, len(req.Response.Answers))
	for questionID, answer := range req.Response.Answers {
		questionID = strings.TrimSpace(questionID)
		if questionID == "" {
			continue
		}
		value := strings.TrimSpace(answer.ChoiceID)
		if value == "" {
			value = strings.TrimSpace(answer.Text)
		}
		answers[questionID] = value
	}
	result, err := typed.Respond(ctx, flruntime.RespondInput{
		ThreadID: identity.ThreadID(threadID), InteractionID: interactionID,
		Answers:    []flruntime.InteractionAnswer{{InteractionID: interactionID, Input: answers}},
		RequestKey: flruntime.RequestKey("respond:" + promptID),
	})
	if err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	return SubmitRequestUserInputResponseResponse{Kind: "accepted", ConsumedWaitingPromptID: promptID, Current: publicFloretThreadView(result)}, nil
}

func (s *Service) prepareUserTurnForTarget(ctx context.Context, meta *session.Meta, endpointID string, targetID string, modelID string, input RunInput, stagingScopeID string, stagingCapability string) (preparedUserTurn, RunInput, error) {
	if s == nil {
		return preparedUserTurn{}, input, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	targetID = strings.TrimSpace(targetID)
	if meta == nil || endpointID == "" || targetID == "" {
		return preparedUserTurn{}, input, errors.New("invalid request")
	}
	if err := validateInlineTurnText(input.Text); err != nil {
		return preparedUserTurn{}, input, err
	}

	owner, err := NewUploadOwner(endpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		return preparedUserTurn{}, input, err
	}
	var stagingScope *threadstore.UploadStagingScope
	stagingScopeID = strings.TrimSpace(stagingScopeID)
	if stagingScopeID != "" {
		scope, authorizeErr := s.authorizeUploadStagingScope(ctx, owner, stagingScopeID, stagingCapability)
		if authorizeErr != nil {
			return preparedUserTurn{}, input, authorizeErr
		}
		if strings.TrimSpace(scope.TargetID) != targetID {
			return preparedUserTurn{}, input, errors.New("upload staging target changed")
		}
		stagingScope = &scope
	}
	input, uploadIDs, attachmentPolicy, err := s.prepareInputAttachmentClaimPolicy(ctx, owner, stagingScope, strings.TrimSpace(modelID), input)
	if err != nil {
		return preparedUserTurn{}, input, err
	}
	return preparedUserTurn{
		CreatedAtUnixMs: time.Now().UnixMilli(), UploadIDs: uploadIDs,
		OwnerUserHash: owner.OwnerUserHash, StagingScope: stagingScope, AttachmentClaimPolicy: attachmentPolicy,
	}, input, nil
}
