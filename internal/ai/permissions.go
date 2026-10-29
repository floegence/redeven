package ai

import (
	"errors"

	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/session"
)

var (
	errReadPermissionDenied = &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "read permission denied"}
	errRWXPermissionDenied  = &aitools.ToolError{Code: aitools.ErrorCodePermissionDenied, Message: "read/write/execute permission denied"}
)

func requireRead(meta *session.Meta) error {
	if meta == nil {
		return errors.New("missing session metadata")
	}
	if !meta.CanRead {
		return errReadPermissionDenied
	}
	return nil
}

func requireRWX(meta *session.Meta) error {
	if meta == nil {
		return errors.New("missing session metadata")
	}
	if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
		return errRWXPermissionDenied
	}
	return nil
}
