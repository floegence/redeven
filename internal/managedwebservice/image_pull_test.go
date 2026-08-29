package managedwebservice

import (
	"context"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
)

func TestManagedImagePullErrorMapsStableContainerFailures(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		cause     error
		wantCode  string
		retryable bool
	}{
		{name: "timeout", cause: containerengine.ErrEngineTimeout, wantCode: "IMAGE_PULL_TIMEOUT", retryable: true},
		{name: "registry unavailable", cause: containerengine.ErrImageRegistryUnavailable, wantCode: "IMAGE_REGISTRY_UNAVAILABLE", retryable: true},
		{name: "manifest unavailable", cause: containerengine.ErrImageNotFound, wantCode: "IMAGE_UNAVAILABLE", retryable: false},
		{name: "access denied", cause: containerengine.ErrImageAccessDenied, wantCode: "IMAGE_REGISTRY_ACCESS_DENIED", retryable: false},
		{name: "rate limited", cause: containerengine.ErrImageRateLimited, wantCode: "IMAGE_REGISTRY_RATE_LIMITED", retryable: true},
		{name: "storage exhausted", cause: containerengine.ErrInsufficientStorage, wantCode: "IMAGE_PULL_STORAGE_EXHAUSTED", retryable: false},
		{name: "Docker unavailable", cause: containerengine.ErrEngineUnavailable, wantCode: "DOCKER_UNAVAILABLE", retryable: true},
		{name: "unknown", cause: errors.New("unknown"), wantCode: "IMAGE_PULL_FAILED", retryable: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			code, _, _, retryable := ErrorDetails(managedImagePullError(tt.cause))
			if code != tt.wantCode || retryable != tt.retryable {
				t.Fatalf("managedImagePullError() = (%q, retryable=%t), want (%q, retryable=%t)", code, retryable, tt.wantCode, tt.retryable)
			}
		})
	}
	if err := managedImagePullError(context.Canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled image pull error = %v", err)
	}
}
