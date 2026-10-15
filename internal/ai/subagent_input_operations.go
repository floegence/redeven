package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// SubagentInputOperation selects an existing canonical input, never a copied
// browser transcript. Every operation rechecks parent membership and access.
type SubagentInputOperation struct {
	Action                   string `json:"action"`
	ItemID                   string `json:"item_id"`
	ExpectedInputFingerprint string `json:"expected_input_fingerprint,omitempty"`
	ClientRequestID          string `json:"client_request_id"`
}

func (s *Service) OperateFlowerSubagentInput(ctx context.Context, meta *session.Meta, parentID, childID string, in SubagentInputOperation) (*FlowerSubagentDetailResponse, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if !validClientRequestID(in.ClientRequestID) || strings.TrimSpace(in.ItemID) == "" {
		return nil, errors.New("invalid subagent input operation")
	}
	detail, err := s.GetFlowerSubagentDetail(ctx, meta, parentID, childID)
	if err != nil {
		return nil, err
	}
	controller, ok := s.threadRuntime.(flruntime.ThreadSteeringController)
	if !ok {
		return nil, errors.New("subagent steering is unavailable")
	}
	threadID := identity.ThreadID(childID)
	key := flruntime.RequestKey("subagent-input:" + in.ClientRequestID)
	var result flruntime.ThreadView
	switch in.Action {
	case "steer_queue", "remove_queue":
		var queued *flruntime.QueuedInput
		for index := range detail.Current.Queue {
			item := &detail.Current.Queue[index]
			if item.ID == in.ItemID && queuedInputFingerprint(item.Input) == in.ExpectedInputFingerprint {
				queued = item
				break
			}
		}
		if queued == nil {
			return nil, flruntime.ErrRequestConflict
		}
		if in.Action == "remove_queue" {
			result, err = s.threadRuntime.DeleteQueued(ctxOrBackground(ctx), flruntime.DeleteQueuedInput{ThreadID: threadID, QueueItemID: in.ItemID, RequestKey: key, ExpectedInputSHA256: in.ExpectedInputFingerprint})
		} else {
			if err := s.prepareSubagentOperationAuthority(ctx, meta, childID, string(key)); err != nil {
				return nil, err
			}
			result, err = controller.SteerQueued(ctxOrBackground(ctx), flruntime.SteerQueuedInput{ThreadID: threadID, QueueItemID: in.ItemID, ExpectedInput: queued.Input, RequestKey: key})
		}
	case "resend_steering":
		var input *flruntime.UserInput
		for _, item := range detail.Current.Items {
			if item.ID == in.ItemID && item.Kind == flruntime.ThreadItemSteering && item.Steering != nil && item.Steering.Status == flruntime.ThreadSteeringCancelled && item.Steering.Reason == "stopped" {
				copy := flruntime.UserInput{Text: item.Text, Attachments: item.Attachments, References: item.References, Context: item.Context}
				input = &copy
				break
			}
		}
		if input == nil {
			return nil, flruntime.ErrRequestConflict
		}
		if err := s.prepareSubagentOperationAuthority(ctx, meta, childID, string(key)); err != nil {
			return nil, err
		}
		result, err = controller.Steer(ctxOrBackground(ctx), flruntime.SteerInput{ThreadID: threadID, Input: *input, RequestKey: key})
	default:
		return nil, errors.New("unsupported subagent input operation")
	}
	if err != nil {
		return nil, err
	}
	if hasSubagentAdmission(result, string(key)) {
		persistCtx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
		defer cancel()
		if err := s.bindSubagentOperationAuthority(persistCtx, string(key), result); err != nil {
			return nil, err
		}
	}
	detail.Current = result
	return detail, nil
}

func (s *Service) prepareSubagentOperationAuthority(ctx context.Context, meta *session.Meta, childID, requestKey string) error {
	settings, err := s.threadsDB.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), childID)
	if err != nil {
		return err
	}
	if settings == nil {
		return errors.New("subagent settings are unavailable")
	}
	return s.persistExecutionAuthority(ctx, meta, childID, requestKey, "", settings.PermissionType)
}

func (s *Service) bindSubagentOperationAuthority(ctx context.Context, requestKey string, result flruntime.ThreadView) error {
	authority, err := s.threadsDB.GetExecutionAuthority(ctx, requestKey)
	if err != nil {
		return err
	}
	return s.persistExecutionAuthorityRecord(ctx, authority, requestKey, result.TurnID.String())
}
