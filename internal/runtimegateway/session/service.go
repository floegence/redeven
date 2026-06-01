package session

import (
	"context"
	"errors"
	"fmt"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type ErrorCode string

const (
	ErrorCodeInvalidRequest ErrorCode = "INVALID_REQUEST"
	ErrorCodeNotImplemented ErrorCode = "NOT_IMPLEMENTED"
)

type GatewayError struct {
	Code    ErrorCode
	Message string
}

func (e *GatewayError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) OpenSession(ctx context.Context, req protocol.OpenSessionRequest) (*protocol.OpenSessionResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	req = protocol.NormalizeOpenSessionRequest(req)
	if err := protocol.ValidateOpenSessionRequest(req); err != nil {
		return nil, &GatewayError{
			Code:    ErrorCodeInvalidRequest,
			Message: "env_public_id is required.",
		}
	}
	return nil, &GatewayError{
		Code:    ErrorCodeNotImplemented,
		Message: "Runtime Gateway session opening is not implemented in this build.",
	}
}

func IsGatewayErrorCode(err error, code ErrorCode) bool {
	var gatewayErr *GatewayError
	return errors.As(err, &gatewayErr) && gatewayErr.Code == code
}
