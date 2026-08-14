package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

// runProductCapabilities contains product-owned catalog and resource access
// only. Floret owns turn, interaction, effect and child-thread lifecycle.
type runProductCapabilities struct {
	currentSettings          func(context.Context) (*threadstore.ThreadSettings, error)
	requireAuthorityWritable func(context.Context) error
	getThreadOwnedUpload     func(context.Context, string) (*threadstore.UploadRecord, error)
}

func bindRootRunProductCapabilities(store *threadstore.Store, endpointID string, threadID string, _ ...string) (runProductCapabilities, error) {
	if store == nil {
		return runProductCapabilities{}, errors.New("run product store is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return runProductCapabilities{}, errors.New("run product authority identity is incomplete")
	}
	return runProductCapabilities{
		currentSettings: func(ctx context.Context) (*threadstore.ThreadSettings, error) {
			return store.GetThreadSettings(ctx, endpointID, threadID)
		},
		requireAuthorityWritable: func(ctx context.Context) error {
			return store.RequireThreadSettingsWritable(ctx, endpointID, threadID)
		},
		getThreadOwnedUpload: func(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
			return store.GetThreadOwnedUpload(ctx, endpointID, threadID, strings.TrimSpace(uploadID))
		},
	}, nil
}

func bindChildRunProductCapabilities(store *threadstore.Store, endpointID string, parentThreadID string, _ string, _ string) (runProductCapabilities, error) {
	return bindRootRunProductCapabilities(store, endpointID, parentThreadID)
}

func (c runProductCapabilities) currentThreadSettings(ctx context.Context) (*threadstore.ThreadSettings, error) {
	if c.currentSettings == nil {
		return nil, errors.New("thread settings capability is unavailable")
	}
	return c.currentSettings(ctx)
}

func (c runProductCapabilities) requireThreadAuthorityWritable(ctx context.Context) error {
	if c.requireAuthorityWritable == nil {
		return errors.New("thread write authority is unavailable")
	}
	return c.requireAuthorityWritable(ctx)
}

func (c runProductCapabilities) loadThreadOwnedUpload(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
	if c.getThreadOwnedUpload == nil {
		return nil, errors.New("thread upload read capability is unavailable")
	}
	return c.getThreadOwnedUpload(ctx, uploadID)
}
