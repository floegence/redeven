package threadstore

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestExecutionAuthorityIsStableAndScopedToRequestOrTurn(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	authority := ExecutionAuthority{
		RequestKey: "send-request", ThreadID: "thread-authority", TurnID: "turn-1",
		EndpointID: "endpoint-a", NamespacePublicID: "namespace-a", ChannelID: "channel-a",
		UserPublicID: "user-b", UserEmail: "b@example.com",
	}
	if err := store.PutExecutionAuthority(context.Background(), authority); err != nil {
		t.Fatal(err)
	}
	retry := authority
	retry.TurnID = "turn-1"
	if err := store.PutExecutionAuthority(context.Background(), retry); err != nil {
		t.Fatalf("idempotent authority retry: %v", err)
	}
	for _, test := range []struct {
		name  string
		mutate func(*ExecutionAuthority)
	}{
		{name: "endpoint", mutate: func(value *ExecutionAuthority) { value.EndpointID = "endpoint-b" }},
		{name: "namespace", mutate: func(value *ExecutionAuthority) { value.NamespacePublicID = "namespace-b" }},
		{name: "channel", mutate: func(value *ExecutionAuthority) { value.ChannelID = "channel-b" }},
		{name: "user", mutate: func(value *ExecutionAuthority) { value.UserPublicID = "user-a" }},
		{name: "email", mutate: func(value *ExecutionAuthority) { value.UserEmail = "other@example.com" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			conflict := authority
			test.mutate(&conflict)
			if err := store.PutExecutionAuthority(context.Background(), conflict); !errors.Is(err, ErrExecutionAuthorityConflict) {
				t.Fatalf("authority conflict=%v", err)
			}
		})
	}
	byRequest, err := store.GetExecutionAuthority(context.Background(), authority.RequestKey)
	if err != nil || byRequest == nil || byRequest.UserPublicID != authority.UserPublicID {
		t.Fatalf("by request=%#v err=%v", byRequest, err)
	}
	byTurn, err := store.GetExecutionAuthorityByTurn(context.Background(), authority.ThreadID, authority.TurnID)
	if err != nil || byTurn == nil || byTurn.RequestKey != authority.RequestKey {
		t.Fatalf("by turn=%#v err=%v", byTurn, err)
	}
	missing, err := store.GetExecutionAuthorityByTurn(context.Background(), authority.ThreadID, "foreign-turn")
	if err != nil || missing != nil {
		t.Fatalf("foreign turn lookup=%#v err=%v, want nil", missing, err)
	}
}
