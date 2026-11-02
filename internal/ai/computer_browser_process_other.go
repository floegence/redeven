//go:build !darwin && !linux

package ai

import (
	"context"
	"errors"
)

type managedBrowserProcess struct {
	endpoint string
	done     chan struct{}
}

func startManagedBrowserProcess(context.Context, string, string) (*managedBrowserProcess, error) {
	return nil, errors.New("managed browser is unsupported on this platform")
}
func (*managedBrowserProcess) close() error { return nil }
