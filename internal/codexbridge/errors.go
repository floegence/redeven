package codexbridge

import (
	"encoding/json"
	"errors"
	"strings"
)

type turnRPCError struct {
	method    string
	turnError TurnError
	cause     error
}

func (e *turnRPCError) Error() string {
	if e == nil {
		return ""
	}
	if message := strings.TrimSpace(e.turnError.Message); message != "" {
		return message
	}
	if e.cause != nil {
		return e.cause.Error()
	}
	return ""
}

func (e *turnRPCError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func turnErrorFromCallError(err error) *TurnError {
	rpcErr, ok := asRPCMethodError(err)
	if !ok || len(rpcErr.Data) == 0 {
		return nil
	}
	var raw wireTurnError
	if json.Unmarshal(rpcErr.Data, &raw) != nil {
		return nil
	}
	normalized := normalizeTurnError(&raw)
	if normalized == nil {
		return nil
	}
	if strings.TrimSpace(normalized.Message) == "" {
		normalized.Message = strings.TrimSpace(rpcErr.Message)
	}
	return normalized
}

func wrapTurnCallError(method string, err error) error {
	normalized := turnErrorFromCallError(err)
	if normalized == nil {
		return err
	}
	return &turnRPCError{
		method:    strings.TrimSpace(method),
		turnError: *normalized,
		cause:     err,
	}
}

func CodexErrorCode(err error) string {
	var turnErr *turnRPCError
	if errors.As(err, &turnErr) {
		return strings.TrimSpace(turnErr.turnError.CodexErrorCode)
	}
	return ""
}
