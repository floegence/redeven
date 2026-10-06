package gatewaymembership

import (
	"context"
	"time"
)

// CloudCommand is a fixed management operation on the sole member store.
// Its result and member update are committed together before acknowledgement.
type CloudCommand struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	MemberID        string `json:"member_id"`
	MemberVersion   int64  `json:"member_version"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
}

type cloudCommandDelivery struct {
	Command   CloudCommand `json:"command"`
	ErrorCode string       `json:"error_code"`
}

func (s *Store) ApplyCloudCommand(ctx context.Context, command CloudCommand) (string, error) {
	if !validID(command.ID) || command.MemberID == "" || command.MemberVersion < 1 || (command.Kind != "reevaluate" && command.Kind != "remove_member") {
		return "MEMBER_COMMAND_INVALID", nil
	}
	s.mu.Lock()
	if delivery, ok := s.state.CloudCommands[command.ID]; ok {
		s.mu.Unlock()
		if delivery.Command != command {
			return "MEMBER_COMMAND_CONFLICT", nil
		}
		return delivery.ErrorCode, nil
	}
	now := time.Now().UnixMilli()
	if command.ExpiresAtUnixMS <= now {
		s.mu.Unlock()
		return "MEMBER_COMMAND_EXPIRED", nil
	}
	next, revision := s.clone(), s.state.Revision
	s.mu.Unlock()
	for id, delivery := range next.CloudCommands {
		if delivery.Command.ExpiresAtUnixMS < now {
			delete(next.CloudCommands, id)
		}
	}
	if len(next.CloudCommands) >= 128 {
		return "MEMBER_COMMAND_CAPACITY", nil
	}
	member, ok := next.Members[command.MemberID]
	result := cloudCommandDelivery{Command: command}
	switch {
	case !ok:
		result.ErrorCode = "MEMBER_DENIED"
	case command.Kind == "remove_member" && member.Member.State == "removed" && member.Member.MemberVersion == command.MemberVersion+1:
	case member.Member.MemberVersion != command.MemberVersion:
		result.ErrorCode = "MEMBER_VERSION_CONFLICT"
	case member.Member.State != "active":
		result.ErrorCode = "MEMBER_DENIED"
	case command.Kind == "remove_member":
		member.Member.State = "removed"
		member.Member.MemberVersion++
		member.Member.CloudRevocationPending = true
		member.HookCloudAllowed = false
		next.Members[command.MemberID] = member
	default:
		if err := s.evaluateCloud(ctx, &next, []string{command.MemberID}); err != nil {
			return "", err
		}
	}
	next.CloudCommands[command.ID] = result
	s.mu.Lock()
	defer s.mu.Unlock()
	if delivery, ok := s.state.CloudCommands[command.ID]; ok {
		if delivery.Command != command {
			return "MEMBER_COMMAND_CONFLICT", nil
		}
		return delivery.ErrorCode, nil
	}
	if s.state.Revision != revision {
		return "", ErrConflict
	}
	if err := s.commit(next); err != nil {
		return "", err
	}
	return result.ErrorCode, nil
}
