package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func newSendTurnTestService(t *testing.T) *Service {
	t.Helper()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
			},
		},
	}

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir:         t.TempDir(),
		FSRoot:           t.TempDir(),
		Shell:            "/bin/bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   2 * time.Second,
		RunIdleTimeout:   1 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			// Keep tests offline: force provider-key resolution to fail before any remote call.
			return "", false, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func testSendTurnMeta() *session.Meta {
	return &session.Meta{
		ChannelID:         "ch_send_turn_test",
		EndpointID:        "env_send_turn_test",
		UserPublicID:      "u_send_turn_test",
		UserEmail:         "u_send_turn_test@example.com",
		NamespacePublicID: "ns_send_turn_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
}

func TestSendUserTurn_ExpectedRunChanged_DoesNotPersistMessage(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "conflict", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	activeRunID := "run_active_send_turn_conflict"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}

	// Simulate an active run for expected_run_id conflict checks.
	svc.mu.Lock()
	svc.activeRunByTh[thKey] = activeRunID
	svc.runs[activeRunID] = &run{
		id:         activeRunID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   th.ThreadID,
		doneCh:     make(chan struct{}),
	}
	svc.mu.Unlock()

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:      th.ThreadID,
		Model:         "openai/gpt-5-mini",
		ExpectedRunID: "run_expected_but_stale",
		Input: RunInput{
			Text: "hello conflict",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err == nil {
		t.Fatalf("SendUserTurn expected ErrRunChanged, got nil")
	}
	if !errors.Is(err, ErrRunChanged) {
		t.Fatalf("SendUserTurn err=%v, want %v", err, ErrRunChanged)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted messages on run_changed conflict, got %d", len(msgs))
	}
}

func TestExecutePreparedRun_WithPersistedUserMessage_ReusesPersistedMessageID(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "prepersist", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	persisted, normalizedInput, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{
		Text: "hello pre persisted",
	})
	if err != nil {
		t.Fatalf("persistUserMessage: %v", err)
	}

	// Intentionally override message_id in run request to ensure executePreparedRun
	// honors pre-persisted metadata instead of appending another user message.
	req := RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID:   "client_override_message_id",
			Text:        normalizedInput.Text,
			Attachments: normalizedInput.Attachments,
		},
		Options: RunOptions{MaxSteps: 1},
	}

	prepared, err := svc.prepareRun(meta, "run_prepersist_reuse_user_msg", req, nil, &persisted)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}

	execCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = svc.executePreparedRun(execCtx, prepared)

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	userMsgIDs := make([]string, 0, 2)
	for _, m := range msgs {
		if m.Role == "user" {
			userMsgIDs = append(userMsgIDs, m.MessageID)
		}
	}
	if len(userMsgIDs) != 1 {
		t.Fatalf("expected exactly one user message after pre-persisted run start, got %d (ids=%v)", len(userMsgIDs), userMsgIDs)
	}
	if userMsgIDs[0] != persisted.MessageID {
		t.Fatalf("user message id=%q, want persisted id=%q", userMsgIDs[0], persisted.MessageID)
	}
}
