package ai

import (
	"errors"

	"github.com/floegence/redeven-agent/internal/session"
)

var (
	errReadPermissionDenied = errors.New("read permission denied")
	errRWXPermissionDenied  = errors.New("read/write/execute permission denied")
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
