package ai

import (
	"errors"
	"fmt"
	"strings"
)

const ApprovalConflictErrorCode = "AI_APPROVAL_CONFLICT"

var ErrApprovalConflict = errors.New("approval state changed")

func approvalConflict(reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ErrApprovalConflict
	}
	return fmt.Errorf("%w: %s", ErrApprovalConflict, reason)
}

func normalizeApprovalDecisionError(err error, reason string) error {
	if err == nil || errors.Is(err, ErrApprovalConflict) {
		return err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = strings.TrimSpace(err.Error())
	}
	return approvalConflict(reason)
}
