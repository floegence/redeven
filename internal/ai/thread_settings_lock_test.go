package ai

import (
	"context"
	"errors"
	"testing"
)

func TestThreadSettingsLockIsScopedAndCancellationDoesNotLeak(t *testing.T) {
	service := &Service{}
	unlock, err := service.lockThreadSettings(t.Context(), "local", "one")
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []threadSettingsLockKey{{"local", "two"}, {"remote", "one"}} {
		otherUnlock, err := service.lockThreadSettings(t.Context(), key.endpointID, key.threadID)
		if err != nil {
			t.Fatal(err)
		}
		otherUnlock()
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := service.lockThreadSettings(ctx, "local", "one"); !errors.Is(err, context.Canceled) {
		t.Fatalf("same-thread waiter: %v", err)
	}
	unlock()
	if len(service.threadSettingsLocks) != 0 {
		t.Fatalf("completed locks retained: %d", len(service.threadSettingsLocks))
	}
	unlock, err = service.lockThreadSettings(t.Context(), "local", "one")
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}
