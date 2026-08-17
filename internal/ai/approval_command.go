package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

// SubmitFlowerApproval resolves one typed interaction. The command returns
// after the thread runtime updates its current view; provider continuation is
// dispatched independently by Floret.
func (s *Service) SubmitFlowerApproval(meta *session.Meta, req SubmitFlowerApprovalRequest) (SubmitFlowerApprovalResponse, error) {
	if s == nil {
		return SubmitFlowerApprovalResponse{}, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return SubmitFlowerApprovalResponse{}, err
	}
	threadID := strings.TrimSpace(req.ThreadID)
	interactionID := strings.TrimSpace(req.InteractionID)
	if threadID == "" || (!req.RejectAll && interactionID == "") || meta == nil || strings.TrimSpace(meta.EndpointID) == "" {
		return SubmitFlowerApprovalResponse{}, errors.New("invalid request")
	}
	if err := s.requireEndpointThreadAuthority(context.Background(), meta.EndpointID, threadID); err != nil {
		return SubmitFlowerApprovalResponse{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return SubmitFlowerApprovalResponse{}, err
	}
	approved := req.Approved
	if req.RejectAll {
		approved = false
	}
	interactionIDs := []string{interactionID}
	if req.RejectAll {
		interactionIDs = interactionIDs[:0]
		for _, interaction := range typedViewInteractions(typed, threadID) {
			if interaction.Kind == flruntime.ThreadInteractionApproval && !interaction.Resolved && strings.TrimSpace(interaction.ID) != "" {
				interactionIDs = append(interactionIDs, strings.TrimSpace(interaction.ID))
			}
		}
	}
	var current flruntime.ThreadView
	if len(interactionIDs) > 0 {
		requestID, requestErr := newProductRequestID("approval_")
		if requestErr != nil {
			return SubmitFlowerApprovalResponse{}, requestErr
		}
		answers := make([]flruntime.InteractionAnswer, 0, len(interactionIDs))
		for _, id := range interactionIDs {
			answers = append(answers, flruntime.InteractionAnswer{InteractionID: id, Approved: &approved})
		}
		result, respondErr := typed.Respond(context.Background(), flruntime.RespondInput{
			ThreadID: identity.ThreadID(threadID), Answers: answers, RequestKey: flruntime.RequestKey(requestID),
		})
		if respondErr != nil {
			return SubmitFlowerApprovalResponse{}, normalizeApprovalDecisionError(respondErr, "")
		}
		current = result
	}
	if current.ThreadID == "" {
		current, err = typed.View(context.Background(), identity.ThreadID(threadID))
		if err != nil {
			return SubmitFlowerApprovalResponse{}, err
		}
	}
	return SubmitFlowerApprovalResponse{OK: true, Current: publicFloretThreadView(current)}, nil
}

func typedViewInteractions(typed flruntime.ThreadService, threadID string) []flruntime.ThreadInteraction {
	if typed == nil || strings.TrimSpace(threadID) == "" {
		return nil
	}
	view, err := typed.View(context.Background(), identity.ThreadID(threadID))
	if err != nil {
		return nil
	}
	return view.Interactions
}
