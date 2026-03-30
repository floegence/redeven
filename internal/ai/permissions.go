package ai

import (
	"errors"

	"github.com/floegence/redeven/internal/session"
)

var (
	errRWXPermissionDenied = errors.New("read/write/execute permission denied")
)

func requireRWX(meta *session.Meta) error {
	if meta == nil {
		return errors.New("missing session metadata")
	}
	if !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
		return errRWXPermissionDenied
	}
	return nil
}
