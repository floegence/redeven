package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestStore_UpdateThreadRunState(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.RunStatus != "idle" {
		t.Fatalf("RunStatus=%q, want idle", th.RunStatus)
	}
	if th.FlowerActivitySignature == "" {
		t.Fatalf("FlowerActivitySignature is empty after create")
	}
	prevFlowerActivityRevision := th.FlowerActivityRevision

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "running", "", "", "", "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState running: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after running: %v", err)
	}
	if th.RunStatus != "running" {
		t.Fatalf("RunStatus=%q, want running", th.RunStatus)
	}
	if th.RunUpdatedAtUnixMs <= 0 {
		t.Fatalf("RunUpdatedAtUnixMs=%d, want > 0", th.RunUpdatedAtUnixMs)
	}
	if th.FlowerActivityRevision <= prevFlowerActivityRevision {
		t.Fatalf("running FlowerActivityRevision=%d, want > %d", th.FlowerActivityRevision, prevFlowerActivityRevision)
	}
	if !strings.Contains(th.FlowerActivitySignature, "status:running") {
		t.Fatalf("running FlowerActivitySignature=%q, want running status", th.FlowerActivitySignature)
	}
	prevFlowerActivityRevision = th.FlowerActivityRevision

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "failed", "PROVIDER_UNREACHABLE", strings.Repeat("x", 900), "", "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState failed: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after failed: %v", err)
	}
	if th.RunStatus != "failed" {
		t.Fatalf("RunStatus=%q, want failed", th.RunStatus)
	}
	if th.RunErrorCode != "PROVIDER_UNREACHABLE" {
		t.Fatalf("RunErrorCode=%q, want PROVIDER_UNREACHABLE", th.RunErrorCode)
	}
	if got := len([]rune(th.RunError)); got != 600 {
		t.Fatalf("RunError rune len=%d, want 600", got)
	}
	if th.FlowerActivityRevision <= prevFlowerActivityRevision {
		t.Fatalf("failed FlowerActivityRevision=%d, want > %d", th.FlowerActivityRevision, prevFlowerActivityRevision)
	}
	if !strings.Contains(th.FlowerActivitySignature, "status:failed") {
		t.Fatalf("failed FlowerActivitySignature=%q, want failed status", th.FlowerActivitySignature)
	}
	prevFlowerActivityRevision = th.FlowerActivityRevision

	waitingPromptJSONBytes, err := json.Marshal(map[string]any{
		"prompt_id":          "wp_1",
		"message_id":         "msg_1",
		"tool_id":            "tool_1",
		"reason_code":        "user_decision_required",
		"required_from_user": []string{"Choose next step"},
		"questions": []map[string]any{
			{
				"id":                "question_1",
				"header":            "Need confirmation",
				"question":          "Need confirmation",
				"is_secret":         false,
				"response_mode":     "write",
				"write_label":       "Your answer",
				"write_placeholder": "Type your answer",
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal waiting prompt: %v", err)
	}
	waitingPromptJSON := string(waitingPromptJSONBytes)
	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "waiting_user", "", "", waitingPromptJSON, "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after waiting_user: %v", err)
	}
	if th.RunStatus != "waiting_user" {
		t.Fatalf("RunStatus=%q, want waiting_user", th.RunStatus)
	}
	if strings.TrimSpace(th.WaitingUserInputJSON) != waitingPromptJSON {
		t.Fatalf("waiting prompt mismatch: %+v", th)
	}
	if th.FlowerActivityRevision <= prevFlowerActivityRevision {
		t.Fatalf("waiting_user FlowerActivityRevision=%d, want > %d", th.FlowerActivityRevision, prevFlowerActivityRevision)
	}
	if th.FlowerActivityWaitingPromptID != "wp_1" {
		t.Fatalf("FlowerActivityWaitingPromptID=%q, want wp_1", th.FlowerActivityWaitingPromptID)
	}
	if !strings.Contains(th.FlowerActivitySignature, "prompt:wp_1") {
		t.Fatalf("waiting_user FlowerActivitySignature=%q, want prompt token", th.FlowerActivitySignature)
	}
	prevFlowerActivityRevision = th.FlowerActivityRevision

	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "success", "", "should be cleared", "", "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState success: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after success: %v", err)
	}
	if th.RunStatus != "success" {
		t.Fatalf("RunStatus=%q, want success", th.RunStatus)
	}
	if th.RunError != "" {
		t.Fatalf("RunError=%q, want empty", th.RunError)
	}
	if th.RunErrorCode != "" {
		t.Fatalf("RunErrorCode=%q, want empty", th.RunErrorCode)
	}
	if th.WaitingUserInputJSON != "" {
		t.Fatalf("waiting prompt should be cleared, got %+v", th)
	}
	if th.FlowerActivityRevision <= prevFlowerActivityRevision {
		t.Fatalf("success FlowerActivityRevision=%d, want > %d", th.FlowerActivityRevision, prevFlowerActivityRevision)
	}
	if th.FlowerActivityWaitingPromptID != "" {
		t.Fatalf("FlowerActivityWaitingPromptID=%q, want empty after success", th.FlowerActivityWaitingPromptID)
	}
	if !strings.Contains(th.FlowerActivitySignature, "status:success") {
		t.Fatalf("success FlowerActivitySignature=%q, want success status", th.FlowerActivitySignature)
	}
}

func TestStore_StartUserTurnAtomicallyWritesTurnAndConsumesQueue(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_start_turn", EndpointID: "env_start_turn", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	_, _, initialRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_start_turn",
		EndpointID:            "env_start_turn",
		ThreadID:              "th_start_turn",
		ChannelID:             "ch_start_turn",
		Lane:                  FollowupLaneQueued,
		MessageID:             "m_queued_start_turn",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "queued user turn",
		CreatedByUserPublicID: "u_start_turn",
		CreatedByUserEmail:    "u_start_turn@example.com",
		CreatedAtUnixMs:       900,
	})
	if err != nil {
		t.Fatalf("CreateFollowup: %v", err)
	}

	start := startUserTurnRecordForTest("env_start_turn", "th_start_turn", "m_user_start_turn", "run_start_turn", "m_assistant_start_turn")
	start.SourceQueueID = "fu_start_turn"
	start.StructuredUserInputs = []StructuredUserInputRecord{{
		QuestionID:        "q1",
		QuestionText:      "Need detail",
		Text:              "structured answer",
		CreatedAtUnixMs:   1001,
		PublicSummary:     "structured answer",
		ResponseMessageID: "m_user_start_turn",
	}}
	start.RequestUserInputSecrets = []RequestUserInputSecretAnswerRecord{{
		QuestionID:        "secret_1",
		Text:              "secret answer",
		CreatedAtUnixMs:   1001,
		ResponseMessageID: "m_user_start_turn",
	}}
	result, err := s.StartUserTurn(ctx, start)
	if err != nil {
		t.Fatalf("StartUserTurn: %v", err)
	}
	if result.UserMessageID != "m_user_start_turn" || result.UserMessageRowID <= 0 || result.ConversationTurnRowID <= 0 {
		t.Fatalf("StartUserTurn result=%+v", result)
	}
	if result.FollowupsRevision <= initialRevision {
		t.Fatalf("FollowupsRevision=%d, want > %d", result.FollowupsRevision, initialRevision)
	}

	messages, _, _, err := s.ListMessages(ctx, "env_start_turn", "th_start_turn", 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 1 || messages[0].MessageID != "m_user_start_turn" || messages[0].Role != "user" {
		t.Fatalf("messages=%+v, want one user message", messages)
	}
	turns, err := s.ListConversationTurns(ctx, "env_start_turn", "th_start_turn", 10)
	if err != nil {
		t.Fatalf("ListConversationTurns: %v", err)
	}
	if len(turns) != 1 || turns[0].RunID != "run_start_turn" || turns[0].UserMessageID != "m_user_start_turn" || turns[0].AssistantMessageID != "m_assistant_start_turn" {
		t.Fatalf("turns=%+v, want canonical user/assistant turn", turns)
	}
	if runs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ? AND run_id = ?`, "env_start_turn", "th_start_turn", "run_start_turn"); runs != 1 {
		t.Fatalf("runs=%d, want 1", runs)
	}
	if queued, err := s.CountFollowupsByLane(ctx, "env_start_turn", "th_start_turn", FollowupLaneQueued); err != nil {
		t.Fatalf("CountFollowupsByLane: %v", err)
	} else if queued != 0 {
		t.Fatalf("queued=%d, want 0 after StartUserTurn", queued)
	}
	th, err := s.GetThread(ctx, "env_start_turn", "th_start_turn")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil || th.RunStatus != "running" {
		t.Fatalf("thread=%+v, want running thread state", th)
	}
	structured, err := s.ListRecentStructuredUserInputs(ctx, "env_start_turn", "th_start_turn", 10)
	if err != nil {
		t.Fatalf("ListRecentStructuredUserInputs: %v", err)
	}
	if len(structured) != 1 || structured[0].ResponseMessageID != "m_user_start_turn" {
		t.Fatalf("structured=%+v, want response message binding", structured)
	}
	secrets, err := s.ListRequestUserInputSecretAnswers(ctx, "env_start_turn", "th_start_turn", "m_user_start_turn")
	if err != nil {
		t.Fatalf("ListRequestUserInputSecretAnswers: %v", err)
	}
	if len(secrets) != 1 || secrets[0].QuestionID != "secret_1" {
		t.Fatalf("secrets=%+v, want one secret answer", secrets)
	}
}

func TestStore_StartUserTurnRollbackWhenSourceQueueIsMissing(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_start_rollback", EndpointID: "env_start_rollback", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	start := startUserTurnRecordForTest("env_start_rollback", "th_start_rollback", "m_user_rollback", "run_rollback", "m_assistant_rollback")
	start.SourceQueueID = "missing_queue"
	start.RequireSourceQueue = true
	if _, err := s.StartUserTurn(ctx, start); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("StartUserTurn err=%v, want %v", err, sql.ErrNoRows)
	}

	messages, _, _, err := s.ListMessages(ctx, "env_start_rollback", "th_start_rollback", 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("messages=%+v, want rollback to remove transcript message", messages)
	}
	turns, err := s.ListConversationTurns(ctx, "env_start_rollback", "th_start_rollback", 10)
	if err != nil {
		t.Fatalf("ListConversationTurns: %v", err)
	}
	if len(turns) != 0 {
		t.Fatalf("turns=%+v, want rollback to remove conversation turn", turns)
	}
	if runs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, "env_start_rollback", "th_start_rollback"); runs != 0 {
		t.Fatalf("runs=%d, want rollback to remove run", runs)
	}
	th, err := s.GetThread(ctx, "env_start_rollback", "th_start_rollback")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil || th.RunStatus != "idle" {
		t.Fatalf("thread=%+v, want rollback to preserve idle thread state", th)
	}
}

func TestStore_StartUserTurnIgnoresMissingOptionalSourceQueue(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_start_optional_source", EndpointID: "env_start_optional_source", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	start := startUserTurnRecordForTest("env_start_optional_source", "th_start_optional_source", "m_user_optional_source", "run_optional_source", "m_assistant_optional_source")
	start.SourceQueueID = "stale_source_queue"
	result, err := s.StartUserTurn(ctx, start)
	if err != nil {
		t.Fatalf("StartUserTurn: %v", err)
	}
	if result.UserMessageID != "m_user_optional_source" || result.ConversationTurnRowID <= 0 {
		t.Fatalf("StartUserTurn result=%+v, want persisted turn", result)
	}

	messages, _, _, err := s.ListMessages(ctx, "env_start_optional_source", "th_start_optional_source", 10, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 1 || messages[0].MessageID != "m_user_optional_source" {
		t.Fatalf("messages=%+v, want optional stale source to keep user turn", messages)
	}
	turns, err := s.ListConversationTurns(ctx, "env_start_optional_source", "th_start_optional_source", 10)
	if err != nil {
		t.Fatalf("ListConversationTurns: %v", err)
	}
	if len(turns) != 1 || turns[0].RunID != "run_optional_source" || turns[0].UserMessageID != "m_user_optional_source" {
		t.Fatalf("turns=%+v, want optional stale source to keep canonical turn", turns)
	}
	if runs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, "env_start_optional_source", "th_start_optional_source"); runs != 1 {
		t.Fatalf("runs=%d, want persisted run", runs)
	}
	th, err := s.GetThread(ctx, "env_start_optional_source", "th_start_optional_source")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil || th.RunStatus != "running" {
		t.Fatalf("thread=%+v, want running thread state", th)
	}
}

func TestStore_StartUserTurnDuplicateMessageIsIdempotentForSameTurn(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_start_idempotent", EndpointID: "env_start_idempotent", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	start := startUserTurnRecordForTest("env_start_idempotent", "th_start_idempotent", "m_user_start_idempotent", "run_start_idempotent", "m_assistant_start_idempotent")
	first, err := s.StartUserTurn(ctx, start)
	if err != nil {
		t.Fatalf("StartUserTurn first: %v", err)
	}
	second, err := s.StartUserTurn(ctx, start)
	if err != nil {
		t.Fatalf("StartUserTurn replay: %v", err)
	}
	if second.UserMessageRowID != first.UserMessageRowID || second.ConversationTurnRowID != first.ConversationTurnRowID {
		t.Fatalf("replay result=%+v, want original rows %+v", second, first)
	}
	if messages := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`, "env_start_idempotent", "th_start_idempotent"); messages != 1 {
		t.Fatalf("messages=%d, want one idempotent message", messages)
	}
	if runs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, "env_start_idempotent", "th_start_idempotent"); runs != 1 {
		t.Fatalf("runs=%d, want one idempotent run", runs)
	}
}

func TestStore_StartUserTurnDuplicateMessageRejectsDifferentRun(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_start_duplicate", EndpointID: "env_start_duplicate", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	start := startUserTurnRecordForTest("env_start_duplicate", "th_start_duplicate", "m_user_start_duplicate", "run_start_duplicate", "m_assistant_start_duplicate")
	if _, err := s.StartUserTurn(ctx, start); err != nil {
		t.Fatalf("StartUserTurn first: %v", err)
	}
	duplicate := startUserTurnRecordForTest("env_start_duplicate", "th_start_duplicate", "m_user_start_duplicate", "run_start_duplicate_2", "m_assistant_start_duplicate_2")
	if _, err := s.StartUserTurn(ctx, duplicate); !errors.Is(err, ErrDuplicateUserTurnMessage) {
		t.Fatalf("StartUserTurn duplicate err=%v, want %v", err, ErrDuplicateUserTurnMessage)
	}
	if messages := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`, "env_start_duplicate", "th_start_duplicate"); messages != 1 {
		t.Fatalf("messages=%d, want original message only", messages)
	}
	if runs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, "env_start_duplicate", "th_start_duplicate"); runs != 1 {
		t.Fatalf("runs=%d, want original run only", runs)
	}
}

func startUserTurnRecordForTest(endpointID string, threadID string, userMessageID string, runID string, assistantMessageID string) StartUserTurn {
	return StartUserTurn{
		EndpointID: endpointID,
		ThreadID:   threadID,
		UserMessage: Message{
			ThreadID:           threadID,
			EndpointID:         endpointID,
			MessageID:          userMessageID,
			Role:               "user",
			AuthorUserPublicID: "u_start_turn",
			AuthorUserEmail:    "u_start_turn@example.com",
			Status:             "complete",
			CreatedAtUnixMs:    1000,
			UpdatedAtUnixMs:    1000,
			TextContent:        "start user turn",
			MessageJSON:        fmt.Sprintf(`{"id":%q,"role":"user","blocks":[{"type":"text","content":"start user turn"}],"status":"complete"}`, userMessageID),
		},
		Run: RunRecord{
			RunID:           runID,
			EndpointID:      endpointID,
			ThreadID:        threadID,
			MessageID:       assistantMessageID,
			State:           "running",
			AttemptCount:    1,
			StartedAtUnixMs: 1001,
			UpdatedAtUnixMs: 1001,
		},
		Turn: ConversationTurn{
			TurnID:             assistantMessageID,
			EndpointID:         endpointID,
			ThreadID:           threadID,
			RunID:              runID,
			UserMessageID:      userMessageID,
			AssistantMessageID: assistantMessageID,
			CreatedAtUnixMs:    1000,
		},
		RunState: ThreadRunStateWrite{
			Status:                "running",
			UpdatedByUserPublicID: "u_start_turn",
			UpdatedByUserEmail:    "u_start_turn@example.com",
			UpdatedAtUnixMs:       1001,
		},
	}
}

func TestStore_CreateAndProjectThreadPermissionType(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_default", EndpointID: "env_1"}); err != nil {
		t.Fatalf("CreateThread default: %v", err)
	}
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_readonly", EndpointID: "env_1", PermissionType: "readonly"}); err != nil {
		t.Fatalf("CreateThread readonly: %v", err)
	}
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_full", EndpointID: "env_1", PermissionType: "full_access"}); err != nil {
		t.Fatalf("CreateThread full access: %v", err)
	}
	if err := s.UpdateThreadPermissionType(ctx, "env_1", "th_full", "readonly"); err != nil {
		t.Fatalf("UpdateThreadPermissionType: %v", err)
	}
	if err := s.UpsertProjectedThread(ctx, Thread{ThreadID: "th_projected", EndpointID: "env_1", PermissionType: "readonly", RunStatus: "idle"}); err != nil {
		t.Fatalf("UpsertProjectedThread create: %v", err)
	}
	if err := s.UpsertProjectedThread(ctx, Thread{ThreadID: "th_projected", EndpointID: "env_1", PermissionType: "approval_required", RunStatus: "idle", UpdatedAtUnixMs: time.Now().UnixMilli()}); err != nil {
		t.Fatalf("UpsertProjectedThread update: %v", err)
	}

	cases := []struct {
		threadID string
		want     string
	}{
		{threadID: "th_default", want: "approval_required"},
		{threadID: "th_readonly", want: "readonly"},
		{threadID: "th_full", want: "readonly"},
		{threadID: "th_projected", want: "approval_required"},
	}
	for _, tc := range cases {
		th, err := s.GetThread(ctx, "env_1", tc.threadID)
		if err != nil {
			t.Fatalf("GetThread(%s): %v", tc.threadID, err)
		}
		if th == nil {
			t.Fatalf("thread %s missing", tc.threadID)
		}
		if th.PermissionType != tc.want {
			t.Fatalf("%s PermissionType=%q, want %q", tc.threadID, th.PermissionType, tc.want)
		}
	}

	for _, threadID := range []string{"th_readonly", "th_full", "th_projected"} {
		var legacyMode string
		if err := s.db.QueryRowContext(ctx, `SELECT execution_mode FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, "env_1", threadID).Scan(&legacyMode); err != nil {
			t.Fatalf("query legacy execution_mode for %s: %v", threadID, err)
		}
		if legacyMode != "" {
			t.Fatalf("%s legacy execution_mode=%q, want empty default", threadID, legacyMode)
		}
	}
}

func TestStore_UpdateThreadRunStateRejectsUnsupportedStatus(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := s.UpdateThreadRunState(ctx, "env_1", "th_1", "mystery", "", "", "", "u1", "u1@example.com"); err == nil {
		t.Fatalf("UpdateThreadRunState unsupported status error=nil, want error")
	}
	if err := s.UpsertRun(ctx, RunRecord{RunID: "run_1", EndpointID: "env_1", ThreadID: "th_1", State: "mystery"}); err == nil {
		t.Fatalf("UpsertRun unsupported state error=nil, want error")
	}
}

func TestStore_AppendRunEvent_ContextEventsUpdateLastContextRunID(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	initial, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread initial: %v", err)
	}
	if initial == nil {
		t.Fatalf("thread missing")
	}
	initialRevision := initial.FlowerActivityRevision
	initialSignature := initial.FlowerActivitySignature

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_non_context",
		StreamKind:  "lifecycle",
		EventType:   "run.start",
		PayloadJSON: "{}",
		AtUnixMs:    1000,
	}); err != nil {
		t.Fatalf("AppendRunEvent non-context: %v", err)
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after non-context: %v", err)
	}
	if got := strings.TrimSpace(th.LastContextRunID); got != "" {
		t.Fatalf("LastContextRunID=%q, want empty after non-context event", got)
	}
	if th.FlowerActivityRevision != initialRevision || th.FlowerActivitySignature != initialSignature {
		t.Fatalf("non-context event changed Flower activity: before=(%d,%q) after=(%d,%q)", initialRevision, initialSignature, th.FlowerActivityRevision, th.FlowerActivitySignature)
	}

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_context_1",
		StreamKind:  "context",
		EventType:   "context.usage.updated",
		PayloadJSON: "{}",
		AtUnixMs:    1100,
	}); err != nil {
		t.Fatalf("AppendRunEvent context usage: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after context usage: %v", err)
	}
	if got := strings.TrimSpace(th.LastContextRunID); got != "run_context_1" {
		t.Fatalf("LastContextRunID=%q, want run_context_1 after context usage", got)
	}
	if th.FlowerActivityRevision <= initialRevision {
		t.Fatalf("context usage FlowerActivityRevision=%d, want > %d", th.FlowerActivityRevision, initialRevision)
	}
	if !strings.Contains(th.FlowerActivitySignature, "turn:run_context_1") {
		t.Fatalf("context usage FlowerActivitySignature=%q, want run_context_1 turn token", th.FlowerActivitySignature)
	}
	contextUsageRevision := th.FlowerActivityRevision

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_context_2",
		StreamKind:  "context",
		EventType:   "context.compaction.updated",
		PayloadJSON: "{}",
		AtUnixMs:    1200,
	}); err != nil {
		t.Fatalf("AppendRunEvent context compaction: %v", err)
	}

	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after context events: %v", err)
	}
	if got := strings.TrimSpace(th.LastContextRunID); got != "run_context_2" {
		t.Fatalf("LastContextRunID=%q, want %q", got, "run_context_2")
	}
	if th.FlowerActivityRevision <= contextUsageRevision {
		t.Fatalf("context compaction FlowerActivityRevision=%d, want > %d", th.FlowerActivityRevision, contextUsageRevision)
	}
	if !strings.Contains(th.FlowerActivitySignature, "turn:run_context_2") {
		t.Fatalf("context compaction FlowerActivitySignature=%q, want run_context_2 turn token", th.FlowerActivitySignature)
	}
}

func TestStore_AppendRunEvent_ContextCompactionDoesNotPolluteTranscript(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_context", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := s.AppendMessage(ctx, "env_1", "th_context", Message{
		ThreadID:        "th_context",
		EndpointID:      "env_1",
		MessageID:       "msg_user",
		Role:            "user",
		Status:          "complete",
		TextContent:     "keep this transcript clean",
		MessageJSON:     `{"id":"msg_user","role":"user","content":"keep this transcript clean"}`,
		CreatedAtUnixMs: 1000,
		UpdatedAtUnixMs: 1000,
	}, "u1", "u1@example.com"); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	now := time.Now().UnixMilli()
	for _, rec := range []RunEventRecord{
		{
			EndpointID:  "env_1",
			ThreadID:    "th_context",
			RunID:       "run_context",
			StreamKind:  "context",
			EventType:   "context.usage.updated",
			PayloadJSON: `{"usage":{"phase":"projected_request","input_tokens":620,"context_window_tokens":1000,"pressure_status":"stable"}}`,
			AtUnixMs:    now,
		},
		{
			EndpointID:  "env_1",
			ThreadID:    "th_context",
			RunID:       "run_context",
			StreamKind:  "context",
			EventType:   "context.compaction.updated",
			PayloadJSON: `{"compaction":{"operation_id":"compact-1","phase":"complete","status":"compacted","tokens_before":920,"tokens_after_estimate":210}}`,
			AtUnixMs:    now + 1,
		},
	} {
		if err := s.AppendRunEvent(ctx, rec); err != nil {
			t.Fatalf("AppendRunEvent(%s): %v", rec.EventType, err)
		}
	}

	if got := countRowsForTest(t, s.db, `
SELECT COUNT(1)
FROM ai_run_events
WHERE endpoint_id = ? AND thread_id = ? AND run_id = ?
  AND event_type IN ('context.usage.updated', 'context.compaction.updated')
`, "env_1", "th_context", "run_context"); got != 2 {
		t.Fatalf("context run events=%d, want 2", got)
	}
	if got := countRowsForTest(t, s.db, `
SELECT COUNT(1)
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
  AND (
    text_content LIKE '%Context compressed%'
    OR text_content LIKE '%上下文已压缩%'
    OR text_content LIKE '%上下文压缩中%'
    OR message_json LIKE '%context_compaction%'
    OR message_json LIKE '%context.compaction.updated%'
  )
`, "env_1", "th_context"); got != 0 {
		t.Fatalf("polluted transcript rows=%d, want 0", got)
	}
	if got := countRowsForTest(t, s.db, `
SELECT COUNT(1)
FROM ai_messages
WHERE endpoint_id = ? AND thread_id = ?
  AND (
    text_content LIKE '%Context compressed%'
    OR text_content LIKE '%上下文已压缩%'
    OR text_content LIKE '%上下文压缩中%'
    OR message_json LIKE '%context_compaction%'
    OR message_json LIKE '%context.compaction.updated%'
  )
`, "env_1", "th_context"); got != 0 {
		t.Fatalf("polluted legacy message rows=%d, want 0", got)
	}
}

func TestStore_AppendMessage_DoesNotPopulateEmptyTitle(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if _, err := s.AppendMessage(ctx, "env_1", "th_1", Message{
		ThreadID:           "th_1",
		EndpointID:         "env_1",
		MessageID:          "msg_1",
		Role:               "user",
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
		Status:             "complete",
		CreatedAtUnixMs:    123,
		UpdatedAtUnixMs:    123,
		TextContent:        "Please investigate the failing regression tests.",
		MessageJSON:        `{"id":"msg_1","role":"user","blocks":[{"type":"text","content":"Please investigate the failing regression tests."}],"status":"complete","timestamp":123}`,
	}, "u1", "u1@example.com"); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.Title != "" {
		t.Fatalf("Title=%q, want empty", th.Title)
	}
	if th.TitleSource != "" {
		t.Fatalf("TitleSource=%q, want empty", th.TitleSource)
	}
	if !strings.Contains(th.LastMessagePreview, "Please investigate") {
		t.Fatalf("LastMessagePreview=%q, want user preview text", th.LastMessagePreview)
	}
}

func TestStore_AppendMessage_MonotonicThreadActivityTimestamp(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", CreatedAtUnixMs: 100, UpdatedAtUnixMs: 100}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendMessage := func(id string, text string) {
		t.Helper()
		if _, err := s.AppendMessage(ctx, "env_1", "th_1", Message{
			ThreadID:        "th_1",
			EndpointID:      "env_1",
			MessageID:       id,
			Role:            "user",
			Status:          "complete",
			CreatedAtUnixMs: 1000,
			UpdatedAtUnixMs: 1000,
			TextContent:     text,
			MessageJSON:     fmt.Sprintf(`{"id":%q,"role":"user","blocks":[{"type":"markdown","content":%q}],"status":"complete","timestamp":1000}`, id, text),
		}, "u1", "u1@example.com"); err != nil {
			t.Fatalf("AppendMessage(%s): %v", id, err)
		}
	}

	appendMessage("msg_1", "first")
	first, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread(first): %v", err)
	}
	appendMessage("msg_2", "second")
	second, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread(second): %v", err)
	}

	if second.UpdatedAtUnixMs <= first.UpdatedAtUnixMs {
		t.Fatalf("UpdatedAtUnixMs did not advance: first=%d second=%d", first.UpdatedAtUnixMs, second.UpdatedAtUnixMs)
	}
	if second.LastMessageAtUnixMs <= first.LastMessageAtUnixMs {
		t.Fatalf("LastMessageAtUnixMs did not advance: first=%d second=%d", first.LastMessageAtUnixMs, second.LastMessageAtUnixMs)
	}
	if !strings.Contains(second.LastMessagePreview, "second") {
		t.Fatalf("LastMessagePreview=%q, want second message", second.LastMessagePreview)
	}
	if first.FlowerActivityRevision <= 0 {
		t.Fatalf("first FlowerActivityRevision=%d, want > 0", first.FlowerActivityRevision)
	}
	if second.FlowerActivityRevision <= first.FlowerActivityRevision {
		t.Fatalf("FlowerActivityRevision did not advance: first=%d second=%d", first.FlowerActivityRevision, second.FlowerActivityRevision)
	}
	if second.FlowerActivitySignature == first.FlowerActivitySignature || !strings.Contains(second.FlowerActivitySignature, "message:") {
		t.Fatalf("second FlowerActivitySignature=%q first=%q, want updated message token", second.FlowerActivitySignature, first.FlowerActivitySignature)
	}
}

func TestStore_UpsertProjectedMessageBumpsFlowerActivityOnVisibleChanges(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_projected_msg", EndpointID: "env_1", CreatedAtUnixMs: 100, UpdatedAtUnixMs: 100}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	initial, err := s.GetThread(ctx, "env_1", "th_projected_msg")
	if err != nil {
		t.Fatalf("GetThread initial: %v", err)
	}
	if initial == nil {
		t.Fatalf("thread missing")
	}

	msg := Message{
		ThreadID:        "th_projected_msg",
		EndpointID:      "env_1",
		MessageID:       "msg_projected",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: 200,
		UpdatedAtUnixMs: 200,
		TextContent:     "first projected answer",
		MessageJSON:     `{"id":"msg_projected","role":"assistant","blocks":[{"type":"markdown","content":"first projected answer"}],"status":"complete","timestamp":200}`,
	}
	if _, err := s.UpsertProjectedMessage(ctx, "env_1", "th_projected_msg", msg, "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpsertProjectedMessage insert: %v", err)
	}
	inserted, err := s.GetThread(ctx, "env_1", "th_projected_msg")
	if err != nil {
		t.Fatalf("GetThread inserted: %v", err)
	}
	if inserted.FlowerActivityRevision <= initial.FlowerActivityRevision {
		t.Fatalf("insert FlowerActivityRevision=%d, want > %d", inserted.FlowerActivityRevision, initial.FlowerActivityRevision)
	}
	if !strings.Contains(inserted.LastMessagePreview, "first projected answer") || !strings.Contains(inserted.FlowerActivitySignature, "message:") {
		t.Fatalf("inserted projected message did not update visible activity: %+v", inserted)
	}

	if _, err := s.UpsertProjectedMessage(ctx, "env_1", "th_projected_msg", msg, "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpsertProjectedMessage idempotent: %v", err)
	}
	idempotent, err := s.GetThread(ctx, "env_1", "th_projected_msg")
	if err != nil {
		t.Fatalf("GetThread idempotent: %v", err)
	}
	if idempotent.FlowerActivityRevision != inserted.FlowerActivityRevision || idempotent.FlowerActivitySignature != inserted.FlowerActivitySignature {
		t.Fatalf("idempotent projected message changed Flower activity: before=(%d,%q) after=(%d,%q)", inserted.FlowerActivityRevision, inserted.FlowerActivitySignature, idempotent.FlowerActivityRevision, idempotent.FlowerActivitySignature)
	}

	msg.TextContent = "updated projected answer"
	msg.MessageJSON = `{"id":"msg_projected","role":"assistant","blocks":[{"type":"markdown","content":"updated projected answer"}],"status":"complete","timestamp":200}`
	if _, err := s.UpsertProjectedMessage(ctx, "env_1", "th_projected_msg", msg, "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpsertProjectedMessage update: %v", err)
	}
	updated, err := s.GetThread(ctx, "env_1", "th_projected_msg")
	if err != nil {
		t.Fatalf("GetThread updated: %v", err)
	}
	if updated.FlowerActivityRevision <= idempotent.FlowerActivityRevision {
		t.Fatalf("update FlowerActivityRevision=%d, want > %d", updated.FlowerActivityRevision, idempotent.FlowerActivityRevision)
	}
	if updated.FlowerActivitySignature == idempotent.FlowerActivitySignature || !strings.Contains(updated.LastMessagePreview, "updated projected answer") {
		t.Fatalf("updated projected message did not change visible Flower activity: before=%+v after=%+v", idempotent, updated)
	}
}

func TestStore_SetAutoThreadTitle_GuardsAndManualRename(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	updated, err := s.SetAutoThreadTitle(ctx, "env_1", "th_1", "Fix failing regression tests", "msg_1", "openai/gpt-5-mini", "thread_title", 321, "u1", "u1@example.com")
	if err != nil {
		t.Fatalf("SetAutoThreadTitle first: %v", err)
	}
	if !updated {
		t.Fatalf("SetAutoThreadTitle first updated=false, want true")
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after auto title: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing after auto title")
	}
	if th.Title != "Fix failing regression tests" {
		t.Fatalf("Title=%q, want auto title", th.Title)
	}
	if th.TitleSource != ThreadTitleSourceAuto {
		t.Fatalf("TitleSource=%q, want %q", th.TitleSource, ThreadTitleSourceAuto)
	}
	if th.TitleInputMessageID != "msg_1" {
		t.Fatalf("TitleInputMessageID=%q, want msg_1", th.TitleInputMessageID)
	}
	if th.TitleModelID != "openai/gpt-5-mini" {
		t.Fatalf("TitleModelID=%q, want openai/gpt-5-mini", th.TitleModelID)
	}
	if th.TitlePromptVersion != "thread_title" {
		t.Fatalf("TitlePromptVersion=%q, want thread_title", th.TitlePromptVersion)
	}

	updated, err = s.SetAutoThreadTitle(ctx, "env_1", "th_1", "Different auto title", "msg_2", "openai/gpt-5-mini", "thread_title", 322, "u1", "u1@example.com")
	if err != nil {
		t.Fatalf("SetAutoThreadTitle second: %v", err)
	}
	if updated {
		t.Fatalf("SetAutoThreadTitle second updated=true, want false")
	}

	if err := s.RenameThread(ctx, "env_1", "th_1", "", "u2", "u2@example.com"); err != nil {
		t.Fatalf("RenameThread blank: %v", err)
	}

	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after blank rename: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing after blank rename")
	}
	if th.Title != "" {
		t.Fatalf("Title=%q, want empty after blank rename", th.Title)
	}
	if th.TitleSource != ThreadTitleSourceUser {
		t.Fatalf("TitleSource=%q, want %q after blank rename", th.TitleSource, ThreadTitleSourceUser)
	}
	if th.TitleGeneratedAtUnixMs != 0 || th.TitleInputMessageID != "" || th.TitleModelID != "" || th.TitlePromptVersion != "" {
		t.Fatalf("auto title metadata should be cleared after manual rename: %+v", th)
	}

	updated, err = s.SetAutoThreadTitle(ctx, "env_1", "th_1", "Should not overwrite user blank title", "msg_3", "openai/gpt-5-mini", "thread_title", 323, "u3", "u3@example.com")
	if err != nil {
		t.Fatalf("SetAutoThreadTitle after manual rename: %v", err)
	}
	if updated {
		t.Fatalf("SetAutoThreadTitle after manual rename updated=true, want false")
	}
}

func TestStore_SetAutoThreadTitle_DoesNotOverwriteExistingAutoTitle(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	updated, err := s.SetAutoThreadTitle(ctx, "env_1", "th_1", "First generated title", "msg_first", "openai/gpt-5-mini", "thread_title", 321, "u1", "u1@example.com")
	if err != nil {
		t.Fatalf("SetAutoThreadTitle first: %v", err)
	}
	if !updated {
		t.Fatalf("SetAutoThreadTitle first updated=false, want true")
	}

	updated, err = s.SetAutoThreadTitle(ctx, "env_1", "th_1", "Generated better title", "msg_second", "openai/gpt-5-mini", "thread_title", 322, "u2", "u2@example.com")
	if err != nil {
		t.Fatalf("SetAutoThreadTitle second: %v", err)
	}
	if updated {
		t.Fatalf("SetAutoThreadTitle second updated=true, want false")
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.Title != "First generated title" {
		t.Fatalf("Title=%q, want original auto title", th.Title)
	}
	if th.TitleSource != ThreadTitleSourceAuto {
		t.Fatalf("TitleSource=%q, want %q", th.TitleSource, ThreadTitleSourceAuto)
	}
	if th.TitleInputMessageID != "msg_first" {
		t.Fatalf("TitleInputMessageID=%q, want msg_first", th.TitleInputMessageID)
	}
	if th.TitleModelID != "openai/gpt-5-mini" {
		t.Fatalf("TitleModelID=%q, want openai/gpt-5-mini", th.TitleModelID)
	}
}

func TestStore_ListThreadsUsesStableCreatedAtOrder(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	for _, th := range []Thread{
		{ThreadID: "older", EndpointID: "env_1", CreatedAtUnixMs: 1000, UpdatedAtUnixMs: 9000},
		{ThreadID: "beta", EndpointID: "env_1", CreatedAtUnixMs: 3000, UpdatedAtUnixMs: 3000},
		{ThreadID: "alpha", EndpointID: "env_1", CreatedAtUnixMs: 3000, UpdatedAtUnixMs: 3000},
		{ThreadID: "newer", EndpointID: "env_1", CreatedAtUnixMs: 2000, UpdatedAtUnixMs: 2000},
		{ThreadID: "other-env", EndpointID: "env_2", CreatedAtUnixMs: 4000, UpdatedAtUnixMs: 4000},
	} {
		if err := s.CreateThread(ctx, th); err != nil {
			t.Fatalf("CreateThread(%s): %v", th.ThreadID, err)
		}
	}
	if err := s.UpdateThreadRunState(ctx, "env_1", "older", "running", "", "", "", "u1", "u1@example.com"); err != nil {
		t.Fatalf("UpdateThreadRunState: %v", err)
	}

	firstPage, cursor, err := s.ListThreads(ctx, "env_1", 2, ThreadsCursor{})
	if err != nil {
		t.Fatalf("ListThreads first: %v", err)
	}
	if got := storeThreadIDs(firstPage); !slices.Equal(got, []string{"alpha", "beta"}) {
		t.Fatalf("first page ids=%v, want created_at desc/id asc", got)
	}
	if cursor == "" {
		t.Fatalf("cursor empty, want next page cursor")
	}
	decoded, ok := DecodeCursor(cursor)
	if !ok {
		t.Fatalf("DecodeCursor(%q) failed", cursor)
	}
	secondPage, next, err := s.ListThreads(ctx, "env_1", 2, decoded)
	if err != nil {
		t.Fatalf("ListThreads second: %v", err)
	}
	if got := storeThreadIDs(secondPage); !slices.Equal(got, []string{"newer", "older"}) {
		t.Fatalf("second page ids=%v, want created_at cursor order", got)
	}
	if next != "" {
		t.Fatalf("next cursor=%q, want empty at end", next)
	}
}

func TestStore_ListThreadsExcludesSubagentProjectionRows(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	for _, th := range []Thread{
		{ThreadID: "parent-new", EndpointID: "env_1", CreatedAtUnixMs: 4000, UpdatedAtUnixMs: 4000},
		{ThreadID: "child-hidden", EndpointID: "env_1", CreatedAtUnixMs: 3000, UpdatedAtUnixMs: 5000},
		{ThreadID: "parent-old", EndpointID: "env_1", CreatedAtUnixMs: 2000, UpdatedAtUnixMs: 2000},
	} {
		if err := s.CreateThread(ctx, th); err != nil {
			t.Fatalf("CreateThread(%s): %v", th.ThreadID, err)
		}
	}
	if err := s.UpsertFlowerThreadMetadata(ctx, FlowerThreadMetadata{
		EndpointID:      "env_1",
		ThreadID:        "child-hidden",
		OwnerKind:       "subagent_projection",
		OwnerID:         "child-hidden",
		ParentThreadID:  "parent-new",
		UpdatedAtUnixMs: 5000,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata child: %v", err)
	}

	firstPage, cursor, err := s.ListThreads(ctx, "env_1", 1, ThreadsCursor{})
	if err != nil {
		t.Fatalf("ListThreads first: %v", err)
	}
	if got := storeThreadIDs(firstPage); !slices.Equal(got, []string{"parent-new"}) {
		t.Fatalf("first page ids=%v, want parent thread only", got)
	}
	decoded, ok := DecodeCursor(cursor)
	if !ok {
		t.Fatalf("DecodeCursor(%q) failed", cursor)
	}
	secondPage, next, err := s.ListThreads(ctx, "env_1", 1, decoded)
	if err != nil {
		t.Fatalf("ListThreads second: %v", err)
	}
	if got := storeThreadIDs(secondPage); !slices.Equal(got, []string{"parent-old"}) {
		t.Fatalf("second page ids=%v, want hidden child skipped without cursor pollution", got)
	}
	if next != "" {
		t.Fatalf("next cursor=%q, want empty", next)
	}

	child, err := s.GetThread(ctx, "env_1", "child-hidden")
	if err != nil {
		t.Fatalf("GetThread child: %v", err)
	}
	if child == nil {
		t.Fatalf("legacy projection direct lookup should remain readable")
	}
}

func TestStore_UpsertProjectedThreadWithFlowerMetadataHidesProjectionAtomically(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.UpsertProjectedThreadWithFlowerMetadata(ctx, Thread{
		ThreadID:        "child-atomic",
		EndpointID:      "env_1",
		Title:           "Child atomic",
		ModelID:         "openai/gpt-5-mini",
		RunStatus:       "running",
		CreatedAtUnixMs: 1000,
		UpdatedAtUnixMs: 2000,
	}, FlowerThreadMetadata{
		EndpointID:      "env_1",
		ThreadID:        "child-atomic",
		OwnerKind:       "subagent_projection",
		OwnerID:         "child-atomic",
		ParentThreadID:  "parent-atomic",
		UpdatedAtUnixMs: 2000,
	}); err != nil {
		t.Fatalf("UpsertProjectedThreadWithFlowerMetadata: %v", err)
	}
	threads, next, err := s.ListThreads(ctx, "env_1", 10, ThreadsCursor{})
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(threads) != 0 || next != "" {
		t.Fatalf("subagent projection leaked into list threads=%#v next=%q", threads, next)
	}
	child, err := s.GetThread(ctx, "env_1", "child-atomic")
	if err != nil {
		t.Fatalf("GetThread child: %v", err)
	}
	if child == nil || child.RunStatus != "running" {
		t.Fatalf("projected child was not stored: %#v", child)
	}
	initialChildRevision := child.FlowerActivityRevision
	initialChildSignature := child.FlowerActivitySignature
	meta, err := s.GetFlowerThreadMetadata(ctx, "env_1", "child-atomic")
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata: %v", err)
	}
	if strings.TrimSpace(meta.OwnerKind) != "subagent_projection" || strings.TrimSpace(meta.ParentThreadID) != "parent-atomic" {
		t.Fatalf("unexpected metadata: %#v", meta)
	}
	if err := s.UpsertProjectedThreadWithFlowerMetadata(ctx, Thread{
		ThreadID:         "child-atomic",
		EndpointID:       "env_1",
		Title:            "Child atomic",
		ModelID:          "openai/gpt-5-mini",
		RunStatus:        "success",
		LastContextRunID: "run_child_2",
		CreatedAtUnixMs:  1000,
		UpdatedAtUnixMs:  2500,
	}, FlowerThreadMetadata{
		EndpointID:      "env_1",
		ThreadID:        "child-atomic",
		OwnerKind:       "subagent_projection",
		OwnerID:         "child-atomic",
		ParentThreadID:  "parent-atomic",
		UpdatedAtUnixMs: 2500,
	}); err != nil {
		t.Fatalf("UpsertProjectedThreadWithFlowerMetadata update: %v", err)
	}
	child, err = s.GetThread(ctx, "env_1", "child-atomic")
	if err != nil {
		t.Fatalf("GetThread child after update: %v", err)
	}
	if child == nil || child.RunStatus != "success" || child.LastContextRunID != "run_child_2" {
		t.Fatalf("projected child update was not stored: %#v", child)
	}
	if child.FlowerActivityRevision <= initialChildRevision {
		t.Fatalf("projected child FlowerActivityRevision=%d, want > %d", child.FlowerActivityRevision, initialChildRevision)
	}
	if child.FlowerActivitySignature == initialChildSignature || !strings.Contains(child.FlowerActivitySignature, "status:success") || !strings.Contains(child.FlowerActivitySignature, "turn:run_child_2") {
		t.Fatalf("projected child FlowerActivitySignature=%q initial=%q, want updated projected state", child.FlowerActivitySignature, initialChildSignature)
	}
	afterUpdateRevision := child.FlowerActivityRevision
	if err := s.UpsertProjectedThreadWithFlowerMetadata(ctx, Thread{
		ThreadID:         "child-atomic",
		EndpointID:       "env_1",
		Title:            "Child atomic",
		ModelID:          "openai/gpt-5-mini",
		RunStatus:        "success",
		LastContextRunID: "run_child_2",
		CreatedAtUnixMs:  1000,
		UpdatedAtUnixMs:  2500,
	}, FlowerThreadMetadata{
		EndpointID:      "env_1",
		ThreadID:        "child-atomic",
		OwnerKind:       "subagent_projection",
		OwnerID:         "child-atomic",
		ParentThreadID:  "parent-atomic",
		UpdatedAtUnixMs: 2500,
	}); err != nil {
		t.Fatalf("UpsertProjectedThreadWithFlowerMetadata idempotent update: %v", err)
	}
	child, err = s.GetThread(ctx, "env_1", "child-atomic")
	if err != nil {
		t.Fatalf("GetThread child after idempotent update: %v", err)
	}
	if child.FlowerActivityRevision != afterUpdateRevision {
		t.Fatalf("idempotent projection changed FlowerActivityRevision=%d, want %d", child.FlowerActivityRevision, afterUpdateRevision)
	}
	if err := s.UpsertProjectedThreadWithFlowerMetadata(ctx, Thread{
		ThreadID:   "child-atomic",
		EndpointID: "env_1",
		RunStatus:  "running",
	}, FlowerThreadMetadata{
		EndpointID: "other-env",
		ThreadID:   "child-atomic",
	}); err == nil {
		t.Fatalf("expected identity mismatch error")
	}
}

func TestStore_ListThreadsPinnedFirstWithStableCursor(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	for _, th := range []Thread{
		{ThreadID: "regular-new", EndpointID: "env_1", CreatedAtUnixMs: 5000, UpdatedAtUnixMs: 5000},
		{ThreadID: "regular-old", EndpointID: "env_1", CreatedAtUnixMs: 1000, UpdatedAtUnixMs: 9000},
		{ThreadID: "pinned-old", EndpointID: "env_1", CreatedAtUnixMs: 2000, UpdatedAtUnixMs: 2000, PinnedAtUnixMs: 10},
		{ThreadID: "pinned-new", EndpointID: "env_1", CreatedAtUnixMs: 3000, UpdatedAtUnixMs: 3000, PinnedAtUnixMs: 20},
	} {
		if err := s.CreateThread(ctx, th); err != nil {
			t.Fatalf("CreateThread(%s): %v", th.ThreadID, err)
		}
	}

	firstPage, cursor, err := s.ListThreads(ctx, "env_1", 2, ThreadsCursor{})
	if err != nil {
		t.Fatalf("ListThreads first: %v", err)
	}
	if got := storeThreadIDs(firstPage); !slices.Equal(got, []string{"pinned-new", "pinned-old"}) {
		t.Fatalf("first page ids=%v, want pinned first", got)
	}
	decoded, ok := DecodeCursor(cursor)
	if !ok {
		t.Fatalf("DecodeCursor(%q) failed", cursor)
	}
	if decoded.PinnedAtUnixMs != 10 {
		t.Fatalf("decoded pinned_at=%d, want 10", decoded.PinnedAtUnixMs)
	}
	secondPage, next, err := s.ListThreads(ctx, "env_1", 2, decoded)
	if err != nil {
		t.Fatalf("ListThreads second: %v", err)
	}
	if got := storeThreadIDs(secondPage); !slices.Equal(got, []string{"regular-new", "regular-old"}) {
		t.Fatalf("second page ids=%v, want regular order", got)
	}
	if next != "" {
		t.Fatalf("next cursor=%q, want empty", next)
	}
}

func TestStore_SetThreadPinnedDoesNotTouchUpdatedAt(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", CreatedAtUnixMs: 1000, UpdatedAtUnixMs: 2000}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	pinnedAt, err := s.SetThreadPinned(ctx, "env_1", "th_1", true, "u1", "u1@example.com")
	if err != nil {
		t.Fatalf("SetThreadPinned true: %v", err)
	}
	if pinnedAt <= 0 {
		t.Fatalf("pinnedAt=%d, want positive", pinnedAt)
	}
	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th.UpdatedAtUnixMs != 2000 {
		t.Fatalf("UpdatedAtUnixMs=%d, want unchanged 2000", th.UpdatedAtUnixMs)
	}
	if th.PinnedAtUnixMs != pinnedAt {
		t.Fatalf("PinnedAtUnixMs=%d, want %d", th.PinnedAtUnixMs, pinnedAt)
	}
	if _, err := s.SetThreadPinned(ctx, "env_1", "th_1", false, "u2", "u2@example.com"); err != nil {
		t.Fatalf("SetThreadPinned false: %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread unpinned: %v", err)
	}
	if th.PinnedAtUnixMs != 0 {
		t.Fatalf("PinnedAtUnixMs=%d, want 0", th.PinnedAtUnixMs)
	}
	if th.UpdatedAtUnixMs != 2000 {
		t.Fatalf("UpdatedAtUnixMs after unpin=%d, want unchanged 2000", th.UpdatedAtUnixMs)
	}
}

func TestStore_GetFirstUserThreadMessage_ReturnsOldestNonEmptyUserMessage(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	appendMessage := func(msg Message) {
		t.Helper()
		if _, err := s.AppendMessage(ctx, "env_1", "th_1", msg, "u1", "u1@example.com"); err != nil {
			t.Fatalf("AppendMessage(%s): %v", msg.MessageID, err)
		}
	}
	appendMessage(Message{
		ThreadID:           "th_1",
		EndpointID:         "env_1",
		MessageID:          "msg_assistant",
		Role:               "assistant",
		Status:             "complete",
		CreatedAtUnixMs:    100,
		UpdatedAtUnixMs:    100,
		TextContent:        "assistant text",
		MessageJSON:        `{"id":"msg_assistant"}`,
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
	})
	appendMessage(Message{
		ThreadID:           "th_1",
		EndpointID:         "env_1",
		MessageID:          "msg_blank",
		Role:               "user",
		Status:             "complete",
		CreatedAtUnixMs:    110,
		UpdatedAtUnixMs:    110,
		TextContent:        "   ",
		MessageJSON:        `{"id":"msg_blank"}`,
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
	})
	appendMessage(Message{
		ThreadID:           "th_1",
		EndpointID:         "env_1",
		MessageID:          "msg_first",
		Role:               "user",
		Status:             "complete",
		CreatedAtUnixMs:    120,
		UpdatedAtUnixMs:    120,
		TextContent:        "first non-empty user input",
		MessageJSON:        `{"id":"msg_first"}`,
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
	})
	appendMessage(Message{
		ThreadID:           "th_1",
		EndpointID:         "env_1",
		MessageID:          "msg_second",
		Role:               "user",
		Status:             "complete",
		CreatedAtUnixMs:    130,
		UpdatedAtUnixMs:    130,
		TextContent:        "later user input",
		MessageJSON:        `{"id":"msg_second"}`,
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
	})

	msg, err := s.GetFirstUserThreadMessage(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetFirstUserThreadMessage: %v", err)
	}
	if msg == nil {
		t.Fatalf("GetFirstUserThreadMessage=nil, want message")
	}
	if msg.MessageID != "msg_first" {
		t.Fatalf("MessageID=%q, want msg_first", msg.MessageID)
	}
	if msg.TextContent != "first non-empty user input" {
		t.Fatalf("TextContent=%q, want first non-empty user input", msg.TextContent)
	}
}

func TestStore_ListAutoThreadTitleCandidates_FiltersAndOrdersThreads(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	for _, th := range []Thread{
		{ThreadID: "th_old", EndpointID: "env_1"},
		{ThreadID: "th_new", EndpointID: "env_2"},
		{ThreadID: "th_user_locked", EndpointID: "env_3"},
		{ThreadID: "th_titled", EndpointID: "env_4", Title: "Existing title"},
	} {
		if err := s.CreateThread(ctx, th); err != nil {
			t.Fatalf("CreateThread(%s): %v", th.ThreadID, err)
		}
	}

	appendUser := func(endpointID string, threadID string, messageID string, at int64, text string) {
		t.Helper()
		if _, err := s.AppendMessage(ctx, endpointID, threadID, Message{
			ThreadID:           threadID,
			EndpointID:         endpointID,
			MessageID:          messageID,
			Role:               "user",
			AuthorUserPublicID: "u1",
			AuthorUserEmail:    "u1@example.com",
			Status:             "complete",
			CreatedAtUnixMs:    at,
			UpdatedAtUnixMs:    at,
			TextContent:        text,
			MessageJSON:        `{"id":"` + messageID + `","role":"user","blocks":[{"type":"text","content":"` + text + `"}],"status":"complete","timestamp":` + "1" + `}`,
		}, "u1", "u1@example.com"); err != nil {
			t.Fatalf("AppendMessage(%s): %v", threadID, err)
		}
	}

	appendUser("env_1", "th_old", "msg_old", 100, "older request")
	appendUser("env_2", "th_new", "msg_new", 200, "newer request")
	appendUser("env_3", "th_user_locked", "msg_user", 300, "should stay locked")
	appendUser("env_4", "th_titled", "msg_titled", 400, "already titled")

	if err := s.RenameThread(ctx, "env_3", "th_user_locked", "", "u2", "u2@example.com"); err != nil {
		t.Fatalf("RenameThread user locked: %v", err)
	}

	candidates, err := s.ListAutoThreadTitleCandidates(ctx, 10)
	if err != nil {
		t.Fatalf("ListAutoThreadTitleCandidates: %v", err)
	}
	if len(candidates) != 2 {
		t.Fatalf("candidate count=%d, want 2", len(candidates))
	}
	if candidates[0].EndpointID != "env_2" || candidates[0].ThreadID != "th_new" {
		t.Fatalf("candidate[0]=%+v, want env_2/th_new", candidates[0])
	}
	if candidates[1].EndpointID != "env_1" || candidates[1].ThreadID != "th_old" {
		t.Fatalf("candidate[1]=%+v, want env_1/th_old", candidates[1])
	}
}

func TestStore_ResetStaleActiveThreadRunStates(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	type threadCase struct {
		threadID         string
		status           string
		runError         string
		wantStatus       string
		wantRunErrorCode string
		wantRunErr       string
	}
	cases := []threadCase{
		{threadID: "th_accepted", status: "accepted", wantStatus: "canceled", wantRunErrorCode: RuntimeRestartedRunErrorCode, wantRunErr: RuntimeRestartedRunErrorMessage},
		{threadID: "th_running", status: "running", wantStatus: "canceled", wantRunErrorCode: RuntimeRestartedRunErrorCode, wantRunErr: RuntimeRestartedRunErrorMessage},
		{threadID: "th_waiting_approval", status: "waiting_approval", wantStatus: "canceled", wantRunErrorCode: RuntimeRestartedRunErrorCode, wantRunErr: RuntimeRestartedRunErrorMessage},
		{threadID: "th_recovering", status: "recovering", wantStatus: "canceled", wantRunErrorCode: RuntimeRestartedRunErrorCode, wantRunErr: RuntimeRestartedRunErrorMessage},
		{threadID: "th_finalizing", status: "finalizing", wantStatus: "canceled", wantRunErrorCode: RuntimeRestartedRunErrorCode, wantRunErr: RuntimeRestartedRunErrorMessage},
		{threadID: "th_waiting_user", status: "waiting_user", wantStatus: "waiting_user"},
		{threadID: "th_success", status: "success", wantStatus: "success"},
		{threadID: "th_failed", status: "failed", runError: "boom", wantStatus: "failed", wantRunErr: "boom"},
	}

	for _, tc := range cases {
		if err := s.CreateThread(ctx, Thread{ThreadID: tc.threadID, EndpointID: "env_1", Title: tc.threadID}); err != nil {
			t.Fatalf("CreateThread(%s): %v", tc.threadID, err)
		}
		if err := s.UpdateThreadRunState(ctx, "env_1", tc.threadID, tc.status, "", tc.runError, "", "u1", "u1@example.com"); err != nil {
			t.Fatalf("UpdateThreadRunState(%s): %v", tc.threadID, err)
		}
		if err := s.UpsertRun(ctx, RunRecord{
			RunID:        "run_" + tc.threadID,
			EndpointID:   "env_1",
			ThreadID:     tc.threadID,
			MessageID:    "msg_" + tc.threadID,
			State:        tc.status,
			ErrorMessage: tc.runError,
		}); err != nil {
			t.Fatalf("UpsertRun(%s): %v", tc.threadID, err)
		}
	}
	activityBeforeReset := map[string]FlowerActivitySnapshot{}
	for _, tc := range cases {
		th, err := s.GetThread(ctx, "env_1", tc.threadID)
		if err != nil {
			t.Fatalf("GetThread before reset(%s): %v", tc.threadID, err)
		}
		if th == nil {
			t.Fatalf("thread %s missing before reset", tc.threadID)
		}
		activityBeforeReset[tc.threadID] = FlowerActivitySnapshot{
			ActivityRevision:  th.FlowerActivityRevision,
			ActivitySignature: strings.TrimSpace(th.FlowerActivitySignature),
			WaitingPromptID:   strings.TrimSpace(th.FlowerActivityWaitingPromptID),
		}
	}

	affected, err := s.ResetStaleActiveThreadRunStates(ctx)
	if err != nil {
		t.Fatalf("ResetStaleActiveThreadRunStates: %v", err)
	}
	if affected != 5 {
		t.Fatalf("affected=%d, want 5", affected)
	}

	for _, tc := range cases {
		th, err := s.GetThread(ctx, "env_1", tc.threadID)
		if err != nil {
			t.Fatalf("GetThread(%s): %v", tc.threadID, err)
		}
		if th == nil {
			t.Fatalf("thread %s missing", tc.threadID)
		}
		if got := strings.TrimSpace(th.RunStatus); got != tc.wantStatus {
			t.Fatalf("thread %s run_status=%q, want %q", tc.threadID, got, tc.wantStatus)
		}
		if gotCode := strings.TrimSpace(th.RunErrorCode); gotCode != tc.wantRunErrorCode {
			t.Fatalf("thread %s run_error_code=%q, want %q", tc.threadID, gotCode, tc.wantRunErrorCode)
		}
		if gotErr := strings.TrimSpace(th.RunError); gotErr != tc.wantRunErr {
			t.Fatalf("thread %s run_error=%q, want %q", tc.threadID, gotErr, tc.wantRunErr)
		}
		run, err := s.GetRun(ctx, "env_1", "run_"+tc.threadID)
		if err != nil {
			t.Fatalf("GetRun(%s): %v", tc.threadID, err)
		}
		if run == nil {
			t.Fatalf("run for thread %s missing", tc.threadID)
		}
		if got := strings.TrimSpace(run.State); got != tc.wantStatus {
			t.Fatalf("run for thread %s state=%q, want %q", tc.threadID, got, tc.wantStatus)
		}
		if gotCode := strings.TrimSpace(run.ErrorCode); gotCode != tc.wantRunErrorCode {
			t.Fatalf("run for thread %s error_code=%q, want %q", tc.threadID, gotCode, tc.wantRunErrorCode)
		}
		if gotErr := strings.TrimSpace(run.ErrorMessage); gotErr != tc.wantRunErr {
			t.Fatalf("run for thread %s error_message=%q, want %q", tc.threadID, gotErr, tc.wantRunErr)
		}
		before := activityBeforeReset[tc.threadID]
		activeBeforeReset := tc.status == "accepted" || tc.status == "running" || tc.status == "waiting_approval" || tc.status == "recovering" || tc.status == "finalizing"
		if activeBeforeReset {
			if run.EndedAtUnixMs <= 0 {
				t.Fatalf("run for thread %s ended_at_unix_ms=%d, want terminal timestamp", tc.threadID, run.EndedAtUnixMs)
			}
			if th.FlowerActivityRevision <= before.ActivityRevision {
				t.Fatalf("thread %s FlowerActivityRevision=%d, want > %d after stale reset", tc.threadID, th.FlowerActivityRevision, before.ActivityRevision)
			}
			if !strings.Contains(th.FlowerActivitySignature, "status:canceled") {
				t.Fatalf("thread %s FlowerActivitySignature=%q, want canceled status", tc.threadID, th.FlowerActivitySignature)
			}
		} else if th.FlowerActivityRevision != before.ActivityRevision || strings.TrimSpace(th.FlowerActivitySignature) != before.ActivitySignature {
			t.Fatalf("thread %s Flower activity changed without stale reset: before=(%d,%q) after=(%d,%q)", tc.threadID, before.ActivityRevision, before.ActivitySignature, th.FlowerActivityRevision, th.FlowerActivitySignature)
		}
	}
}

func TestStore_MigrateFromV1AddsRunColumns(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	_, err = raw.Exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
  thread_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  namespace_public_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  created_by_user_public_id TEXT NOT NULL DEFAULT '',
  created_by_user_email TEXT NOT NULL DEFAULT '',
  updated_by_user_public_id TEXT NOT NULL DEFAULT '',
  updated_by_user_email TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_message_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_message_preview TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ai_threads_endpoint_updated ON ai_threads(endpoint_id, updated_at_unix_ms DESC, thread_id DESC);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  author_user_public_id TEXT NOT NULL DEFAULT '',
  author_user_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  text_content TEXT NOT NULL DEFAULT '',
  message_json TEXT NOT NULL,
  UNIQUE(thread_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_id ON ai_messages(endpoint_id, thread_id, id ASC);
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, title,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
) VALUES(
  'legacy_thread', 'env_legacy', 'ns_legacy', 'Legacy',
  1000, 2000, 3000, 'legacy answer'
);
PRAGMA user_version=1;
`)
	if err != nil {
		t.Fatalf("init v1 schema: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open with migration: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(ai_threads)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info: %v", err)
	}
	defer rows.Close()

	cols := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan table_info: %v", err)
		}
		cols[strings.TrimSpace(name)] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}

	for _, col := range []string{"model_id", "model_locked", "execution_mode", "working_dir", "run_status", "run_updated_at_unix_ms", "run_error_code", "run_error", "waiting_user_input_json", "last_context_run_id", "title_source", "title_generated_at_unix_ms", "title_input_message_id", "title_model_id", "title_prompt_version", "pinned_at_unix_ms", "flower_activity_revision", "flower_activity_signature", "flower_activity_waiting_prompt_id"} {
		if !cols[col] {
			t.Fatalf("missing migrated column %q", col)
		}
	}
	legacy, err := s.GetThread(ctx, "env_legacy", "legacy_thread")
	if err != nil {
		t.Fatalf("GetThread legacy: %v", err)
	}
	if legacy == nil {
		t.Fatalf("legacy thread missing after migration")
	}
	wantRevision := legacyFlowerActivityRevision("idle", 0, 3000)
	if legacy.FlowerActivityRevision != wantRevision {
		t.Fatalf("legacy FlowerActivityRevision=%d, want %d", legacy.FlowerActivityRevision, wantRevision)
	}
	if legacy.FlowerActivitySignature == "" || !strings.Contains(legacy.FlowerActivitySignature, "activity:30000") || !strings.Contains(legacy.FlowerActivitySignature, "message:") {
		t.Fatalf("legacy FlowerActivitySignature=%q, want backfilled activity and message tokens", legacy.FlowerActivitySignature)
	}
	if !tableHasColumnForTest(t, s.db, "ai_queued_turns", "context_action_json") {
		t.Fatalf("missing migrated queued turn column %q", "context_action_json")
	}

	for _, table := range []string{"ai_runs", "ai_tool_calls", "ai_run_events", "ai_thread_todos", "ai_thread_checkpoints", "transcript_messages", "conversation_turns", "execution_spans", "memory_items", "context_snapshots", "provider_capabilities", "structured_user_inputs", "request_user_input_secret_answers", "ai_flower_thread_metadata", "ai_flower_transfers", "ai_flower_handoffs"} {
		var exists int
		if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = ?
`, table).Scan(&exists); err != nil {
			t.Fatalf("check table %s: %v", table, err)
		}
		if exists == 0 {
			t.Fatalf("missing migrated table %q", table)
		}
	}
	if tableExistsForTest(t, s.db, "memory_embeddings") {
		t.Fatalf("memory_embeddings should be removed from the current schema")
	}

	var version int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
}

func TestStore_MigrateFromV27AddsFlowerTables(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	schema := threadstoreSchemaSpec()
	tx, err := raw.Begin()
	if err != nil {
		_ = raw.Close()
		t.Fatalf("begin v27 migration setup: %v", err)
	}
	for _, migration := range schema.Migrations {
		if migration.ToVersion > 27 {
			break
		}
		if err := migration.Apply(tx); err != nil {
			_ = tx.Rollback()
			_ = raw.Close()
			t.Fatalf("apply migration %d->%d: %v", migration.FromVersion, migration.ToVersion, err)
		}
	}
	if _, err := tx.Exec(`PRAGMA user_version=27;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("set user_version v27: %v", err)
	}
	if err := tx.Commit(); err != nil {
		_ = raw.Close()
		t.Fatalf("commit v27 migration setup: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open with v28 migration: %v", err)
	}
	defer func() { _ = s.Close() }()

	for _, table := range []string{"ai_flower_thread_metadata", "ai_flower_transfers", "ai_flower_handoffs"} {
		if !tableExistsForTest(t, s.db, table) {
			t.Fatalf("missing migrated Flower table %q", table)
		}
	}
	for _, indexName := range []string{
		"idx_ai_flower_thread_metadata_owner",
		"idx_ai_flower_thread_metadata_parent",
		"idx_ai_flower_transfers_idempotency",
		"idx_ai_flower_transfers_source",
		"idx_ai_flower_transfers_destination",
		"idx_ai_flower_handoffs_idempotency",
		"idx_ai_flower_handoffs_source",
		"idx_ai_flower_handoffs_destination",
	} {
		if !indexExistsForTest(t, s.db, indexName) {
			t.Fatalf("missing migrated Flower index %q", indexName)
		}
	}

	var version int
	if err := s.db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
}

func TestStore_MigrateFromV30EnsuresFlowerMetadataOwnershipColumns(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	schema := threadstoreSchemaSpec()
	tx, err := raw.Begin()
	if err != nil {
		_ = raw.Close()
		t.Fatalf("begin v30 migration setup: %v", err)
	}
	for _, migration := range schema.Migrations {
		if migration.ToVersion > 30 {
			break
		}
		if err := migration.Apply(tx); err != nil {
			_ = tx.Rollback()
			_ = raw.Close()
			t.Fatalf("apply migration %d->%d: %v", migration.FromVersion, migration.ToVersion, err)
		}
	}
	if _, err := tx.Exec(`CREATE TABLE ai_flower_thread_metadata_reduced (
  endpoint_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  parent_thread_id TEXT NOT NULL DEFAULT '',
  parent_run_id TEXT NOT NULL DEFAULT '',
  context_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  updated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(endpoint_id, thread_id)
);`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("create reduced metadata table: %v", err)
	}
	if _, err := tx.Exec(`INSERT INTO ai_flower_thread_metadata_reduced(endpoint_id, thread_id, owner_kind, owner_id, updated_at_unix_ms)
SELECT endpoint_id, thread_id, owner_kind, owner_id, updated_at_unix_ms
FROM ai_flower_thread_metadata;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("copy reduced metadata table: %v", err)
	}
	if _, err := tx.Exec(`DROP TABLE ai_flower_thread_metadata;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("drop metadata table: %v", err)
	}
	if _, err := tx.Exec(`ALTER TABLE ai_flower_thread_metadata_reduced RENAME TO ai_flower_thread_metadata;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("rename metadata table: %v", err)
	}
	if _, err := tx.Exec(`
CREATE INDEX IF NOT EXISTS idx_ai_flower_thread_metadata_owner ON ai_flower_thread_metadata(endpoint_id, owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS idx_ai_flower_thread_metadata_parent ON ai_flower_thread_metadata(endpoint_id, parent_thread_id, parent_run_id);
`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("create metadata indexes: %v", err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=30;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("set user_version v30: %v", err)
	}
	if err := tx.Commit(); err != nil {
		_ = raw.Close()
		t.Fatalf("commit v30 migration setup: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open with v31 migration: %v", err)
	}
	defer func() { _ = s.Close() }()

	for _, column := range []string{"home_runtime_id", "home_runtime_kind", "origin_env_public_id", "primary_target_id", "active_target_ids_json"} {
		if !tableHasColumnForTest(t, s.db, "ai_flower_thread_metadata", column) {
			t.Fatalf("missing migrated metadata column %q", column)
		}
	}
}

func TestStore_MigrateFromV34BackfillsPermissionType(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	schema := threadstoreSchemaSpec()
	tx, err := raw.Begin()
	if err != nil {
		_ = raw.Close()
		t.Fatalf("begin v34 migration setup: %v", err)
	}
	for _, migration := range schema.Migrations {
		if migration.ToVersion > 34 {
			break
		}
		if err := migration.Apply(tx); err != nil {
			_ = tx.Rollback()
			_ = raw.Close()
			t.Fatalf("apply migration %d->%d: %v", migration.FromVersion, migration.ToVersion, err)
		}
	}
	if _, err := tx.Exec(`
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, model_id, model_locked, reasoning_selection_json,
  execution_mode, working_dir, title, title_source, title_generated_at_unix_ms, title_input_message_id,
  title_model_id, title_prompt_version, followups_revision, pinned_at_unix_ms,
  run_status, run_updated_at_unix_ms, run_error_code, run_error, waiting_user_input_json, last_context_run_id,
  flower_activity_revision, flower_activity_signature, flower_activity_waiting_prompt_id,
  created_by_user_public_id, created_by_user_email, updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms, last_message_at_unix_ms, last_message_preview
) VALUES
  ('th_plan', 'env_1', '', '', 0, '', 'plan', '', 'plan thread', '', 0, '', '', '', 0, 0, 'idle', 0, '', '', '', '', 0, '', '', '', '', '', '', 100, 100, 0, ''),
  ('th_act', 'env_1', '', '', 0, '', 'act', '', 'act thread', '', 0, '', '', '', 0, 0, 'idle', 0, '', '', '', '', 0, '', '', '', '', '', '', 101, 101, 0, '')
`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("insert v34 threads: %v", err)
	}
	if _, err := tx.Exec(`PRAGMA user_version=34;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("set user_version v34: %v", err)
	}
	if err := tx.Commit(); err != nil {
		_ = raw.Close()
		t.Fatalf("commit v34 migration setup: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open with v35 migration: %v", err)
	}
	defer func() { _ = s.Close() }()

	for _, tc := range []struct {
		threadID string
		want     string
	}{
		{threadID: "th_plan", want: "readonly"},
		{threadID: "th_act", want: "approval_required"},
	} {
		th, err := s.GetThread(context.Background(), "env_1", tc.threadID)
		if err != nil {
			t.Fatalf("GetThread(%s): %v", tc.threadID, err)
		}
		if th == nil {
			t.Fatalf("thread %s missing after migration", tc.threadID)
		}
		if th.PermissionType != tc.want {
			t.Fatalf("%s PermissionType=%q, want %q", tc.threadID, th.PermissionType, tc.want)
		}
	}
}

func TestStore_MigrateFromV31EnsuresProviderContinuationStateEnvelope(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	schema := threadstoreSchemaSpec()
	tx, err := raw.Begin()
	if err != nil {
		_ = raw.Close()
		t.Fatalf("begin v31 migration setup: %v", err)
	}
	for _, migration := range schema.Migrations {
		if migration.ToVersion > 31 {
			break
		}
		if err := migration.Apply(tx); err != nil {
			_ = tx.Rollback()
			_ = raw.Close()
			t.Fatalf("apply migration %d->%d: %v", migration.FromVersion, migration.ToVersion, err)
		}
	}
	if _, err := tx.Exec(`PRAGMA user_version=31;`); err != nil {
		_ = tx.Rollback()
		_ = raw.Close()
		t.Fatalf("set user_version v31: %v", err)
	}
	if err := tx.Commit(); err != nil {
		_ = raw.Close()
		t.Fatalf("commit v31 migration setup: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open with v32 migration: %v", err)
	}
	defer func() { _ = s.Close() }()

	for _, column := range []string{
		"provider_continuation_state_json",
		"provider_continuation_provider_id",
		"provider_continuation_model",
		"provider_continuation_base_url",
		"provider_continuation_updated_at_unix_ms",
	} {
		if !tableHasColumnForTest(t, s.db, "ai_thread_state", column) {
			t.Fatalf("missing migrated continuation column %q", column)
		}
	}
	var version int
	if err := s.db.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
}

func TestStore_MigrateFromV9ScrubsLegacyModelDefaultToken(t *testing.T) {
	t.Parallel()

	legacyToken := strings.Join([]string{"is", "default"}, "_")
	toolCallPayload := strings.Replace(`{"TOKEN":true}`, "TOKEN", legacyToken, 1)
	runEventPayload := strings.Replace(`{"legacy":"TOKEN"}`, "TOKEN", legacyToken, 1)

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = raw.Close() }()

	if _, err := raw.Exec(`PRAGMA user_version=9;`); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_tool_calls(run_id, tool_id, tool_name, status, result_json)
VALUES(?, ?, ?, ?, ?)
`, "run_legacy", "tool_legacy", "terminal.exec", "succeeded", toolCallPayload); err != nil {
		t.Fatalf("seed tool call: %v", err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_run_events(endpoint_id, thread_id, run_id, event_type, payload_json)
VALUES(?, ?, ?, ?, ?)
`, "env_legacy", "th_legacy", "run_legacy", "stream_event", runEventPayload); err != nil {
		t.Fatalf("seed legacy data: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close seeded db: %v", err)
	}

	s, err = Open(dbPath)
	if err != nil {
		t.Fatalf("Open after v9 seed: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()

	var cleanedToolCall string
	if err := s.db.QueryRowContext(ctx, `
SELECT result_json
FROM ai_tool_calls
WHERE run_id = 'run_legacy' AND tool_id = 'tool_legacy'
`).Scan(&cleanedToolCall); err != nil {
		t.Fatalf("load tool call: %v", err)
	}
	if strings.Contains(cleanedToolCall, legacyToken) {
		t.Fatalf("tool call result_json still contains legacy token: %s", cleanedToolCall)
	}
	if !strings.Contains(cleanedToolCall, "current_model_id") {
		t.Fatalf("tool call result_json not rewritten: %s", cleanedToolCall)
	}

	var cleanedEvent string
	if err := s.db.QueryRowContext(ctx, `
SELECT payload_json
FROM ai_run_events
WHERE run_id = 'run_legacy'
`).Scan(&cleanedEvent); err != nil {
		t.Fatalf("load run event: %v", err)
	}
	if strings.Contains(cleanedEvent, legacyToken) {
		t.Fatalf("run event payload_json still contains legacy token: %s", cleanedEvent)
	}
	if !strings.Contains(cleanedEvent, "current_model_id") {
		t.Fatalf("run event payload_json not rewritten: %s", cleanedEvent)
	}

	var version int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
}

func TestStore_DeleteThread_CleansThreadScopedPersistence(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	endpointID := "env_delete"
	threadID := "th_delete"

	if err := s.CreateThread(ctx, Thread{ThreadID: threadID, EndpointID: endpointID, Title: "cleanup"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO ai_messages(
  thread_id, endpoint_id, message_id, role,
  author_user_public_id, author_user_email,
  status, created_at_unix_ms, updated_at_unix_ms,
  text_content, message_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, threadID, endpointID, "legacy_msg_1", "user", "u1", "u1@example.com", "complete", 100, 100, "legacy", `{"id":"legacy_msg_1"}`); err != nil {
		t.Fatalf("seed ai_messages: %v", err)
	}
	if _, err := s.AppendMessage(ctx, endpointID, threadID, Message{
		ThreadID:           threadID,
		EndpointID:         endpointID,
		MessageID:          "msg_1",
		Role:               "user",
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
		Status:             "complete",
		CreatedAtUnixMs:    101,
		UpdatedAtUnixMs:    101,
		TextContent:        "hello",
		MessageJSON:        `{"id":"msg_1","role":"user"}`,
	}, "u1", "u1@example.com"); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if _, err := s.AppendConversationTurn(ctx, ConversationTurn{
		TurnID:             "turn_1",
		EndpointID:         endpointID,
		ThreadID:           threadID,
		RunID:              "run_1",
		UserMessageID:      "msg_1",
		AssistantMessageID: "msg_2",
		CreatedAtUnixMs:    102,
	}); err != nil {
		t.Fatalf("AppendConversationTurn: %v", err)
	}
	if err := s.ReplaceStructuredUserInputs(ctx, endpointID, threadID, "assistant_wait_1", []StructuredUserInputRecord{{
		QuestionID:        "q1",
		QuestionText:      "Need detail",
		Text:              "more context",
		ContainsSecret:    false,
		CreatedAtUnixMs:   103,
		PublicSummary:     "user provided detail",
		ResponseMessageID: "assistant_wait_1",
	}}); err != nil {
		t.Fatalf("ReplaceStructuredUserInputs: %v", err)
	}
	if err := s.ReplaceRequestUserInputSecretAnswers(ctx, endpointID, threadID, "assistant_wait_1", []RequestUserInputSecretAnswerRecord{{
		QuestionID:      "q_secret",
		Text:            "secret answer",
		CreatedAtUnixMs: 104,
	}}); err != nil {
		t.Fatalf("ReplaceRequestUserInputSecretAnswers: %v", err)
	}
	if err := s.UpsertMemoryItem(ctx, MemoryItemRecord{
		MemoryID:        "mem_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Scope:           "working",
		Kind:            "fact",
		Content:         "keep track",
		SourceRefsJSON:  "[]",
		CreatedAtUnixMs: 105,
		UpdatedAtUnixMs: 105,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem: %v", err)
	}
	if err := s.InsertContextSnapshot(ctx, ContextSnapshotRecord{
		SnapshotID:      "snap_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		Level:           "thread",
		SummaryText:     "snapshot",
		QualityScore:    0.9,
		CreatedAtUnixMs: 106,
	}); err != nil {
		t.Fatalf("InsertContextSnapshot: %v", err)
	}
	if err := s.UpsertExecutionSpan(ctx, ExecutionSpanRecord{
		SpanID:          "span_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "terminal.exec",
		Status:          "success",
		PayloadJSON:     `{"ok":true}`,
		StartedAtUnixMs: 107,
		EndedAtUnixMs:   107,
		UpdatedAtUnixMs: 107,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan: %v", err)
	}
	if err := s.UpsertThreadState(ctx, ThreadState{
		EndpointID:           endpointID,
		ThreadID:             threadID,
		OpenGoal:             "finish cleanup",
		LastAssistantSummary: "summary",
		UpdatedAtUnixMs:      108,
	}); err != nil {
		t.Fatalf("UpsertThreadState: %v", err)
	}
	if _, err := s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      endpointID,
		ThreadID:        threadID,
		TodosJSON:       `[{"id":"todo_1","title":"cleanup","status":"pending"}]`,
		UpdatedAtUnixMs: 109,
	}, nil); err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot: %v", err)
	}
	if _, _, _, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "followup_1",
		EndpointID:            endpointID,
		ThreadID:              threadID,
		ChannelID:             "ch_1",
		MessageID:             "followup_msg_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "follow up",
		CreatedByUserPublicID: "u1",
		CreatedByUserEmail:    "u1@example.com",
		CreatedAtUnixMs:       110,
	}); err != nil {
		t.Fatalf("CreateFollowup: %v", err)
	}
	if err := s.UpsertRun(ctx, RunRecord{
		RunID:           "run_1",
		EndpointID:      endpointID,
		ThreadID:        threadID,
		State:           "success",
		StartedAtUnixMs: 111,
		EndedAtUnixMs:   112,
		UpdatedAtUnixMs: 112,
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:           "run_1",
		ToolID:          "tool_1",
		ToolName:        "terminal.exec",
		Status:          "success",
		ResultJSON:      `{"stdout":"ok"}`,
		StartedAtUnixMs: 111,
		EndedAtUnixMs:   112,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}
	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  endpointID,
		ThreadID:    threadID,
		RunID:       "run_1",
		EventType:   "tool.result",
		StreamKind:  "tool",
		PayloadJSON: `{"ok":true}`,
		AtUnixMs:    113,
	}); err != nil {
		t.Fatalf("AppendRunEvent: %v", err)
	}
	if _, err := s.CreateThreadCheckpoint(ctx, endpointID, threadID, "cp_1", "run_1", CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
	}
	if err := s.UpsertProviderCapability(ctx, ProviderCapabilityRecord{
		ProviderID:      "openai",
		ModelName:       "gpt-5-mini",
		CapabilityJSON:  `{"supports_reasoning":true}`,
		UpdatedAtUnixMs: 114,
	}); err != nil {
		t.Fatalf("UpsertProviderCapability: %v", err)
	}
	if err := s.UpsertFlowerThreadMetadata(ctx, FlowerThreadMetadata{
		EndpointID:      endpointID,
		ThreadID:        threadID,
		OwnerKind:       "handoff",
		OwnerID:         "handoff_1",
		ContextJSON:     `{"source":"test"}`,
		ActionJSON:      `{"action_id":"assistant.ask.flower"}`,
		UpdatedAtUnixMs: 115,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata: %v", err)
	}
	if _, err := s.InsertFlowerTransfer(ctx, FlowerTransferRecord{
		TransferID:          "transfer_delete_1",
		EndpointID:          endpointID,
		SourceThreadID:      threadID,
		DestinationThreadID: "th_other",
		IdempotencyKey:      "transfer_delete_1",
		ManifestHash:        "sha256:manifest",
		ApprovalHash:        "sha256:approval",
		PlanJSON:            `{"items":[]}`,
		CreatedAtUnixMs:     116,
		UpdatedAtUnixMs:     116,
	}); err != nil {
		t.Fatalf("InsertFlowerTransfer: %v", err)
	}
	if _, err := s.InsertFlowerHandoff(ctx, FlowerHandoffRecord{
		HandoffID:           "handoff_delete_1",
		EndpointID:          endpointID,
		SourceThreadID:      "th_other",
		DestinationThreadID: threadID,
		IdempotencyKey:      "handoff_delete_1",
		EnvelopeHash:        "sha256:envelope",
		EnvelopeJSON:        `{"envelope_id":"handoff_delete_1"}`,
		CreatedAtUnixMs:     117,
		UpdatedAtUnixMs:     117,
	}); err != nil {
		t.Fatalf("InsertFlowerHandoff: %v", err)
	}

	if err := s.DeleteThread(ctx, endpointID, threadID); err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}

	if th, err := s.GetThread(ctx, endpointID, threadID); err != nil {
		t.Fatalf("GetThread after delete: %v", err)
	} else if th != nil {
		t.Fatalf("thread should be deleted, got %+v", th)
	}

	threadScopedCounts := map[string]int{
		"ai_threads":                        countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_threads WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_messages":                       countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"transcript_messages":               countRowsForTest(t, s.db, `SELECT COUNT(1) FROM transcript_messages WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"conversation_turns":                countRowsForTest(t, s.db, `SELECT COUNT(1) FROM conversation_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"structured_user_inputs":            countRowsForTest(t, s.db, `SELECT COUNT(1) FROM structured_user_inputs WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"request_user_input_secret_answers": countRowsForTest(t, s.db, `SELECT COUNT(1) FROM request_user_input_secret_answers WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"memory_items":                      countRowsForTest(t, s.db, `SELECT COUNT(1) FROM memory_items WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"context_snapshots":                 countRowsForTest(t, s.db, `SELECT COUNT(1) FROM context_snapshots WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"execution_spans":                   countRowsForTest(t, s.db, `SELECT COUNT(1) FROM execution_spans WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_thread_state":                   countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_thread_todos":                   countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_thread_todos WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_queued_turns":                   countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_queued_turns WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_runs":                           countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_run_events":                     countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_run_events WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_thread_checkpoints":             countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_thread_checkpoints WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_flower_thread_metadata":         countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_flower_thread_metadata WHERE endpoint_id = ? AND thread_id = ?`, endpointID, threadID),
		"ai_flower_transfers":               countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_flower_transfers WHERE endpoint_id = ? AND (source_thread_id = ? OR destination_thread_id = ?)`, endpointID, threadID, threadID),
		"ai_flower_handoffs":                countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_flower_handoffs WHERE endpoint_id = ? AND (source_thread_id = ? OR destination_thread_id = ?)`, endpointID, threadID, threadID),
		"ai_tool_calls": countRowsForTest(t, s.db, `
SELECT COUNT(1)
FROM ai_tool_calls tc
JOIN ai_runs r ON r.run_id = tc.run_id
WHERE r.endpoint_id = ? AND r.thread_id = ?
`, endpointID, threadID),
	}
	for table, count := range threadScopedCounts {
		if count != 0 {
			t.Fatalf("%s rows=%d, want 0", table, count)
		}
	}
	if count := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM provider_capabilities WHERE provider_id = ? AND model_name = ?`, "openai", "gpt-5-mini"); count != 1 {
		t.Fatalf("provider_capabilities rows=%d, want 1", count)
	}
}

func TestStore_UpdateThreadModelID_DoesNotTouchUpdatedAt(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	updatedAt := th.UpdatedAtUnixMs
	if updatedAt <= 0 {
		t.Fatalf("UpdatedAtUnixMs=%d, want > 0", updatedAt)
	}

	if err := s.UpdateThreadModelID(ctx, "env_1", "th_1", "openai/gpt-5-mini"); err != nil {
		t.Fatalf("UpdateThreadModelID: %v", err)
	}

	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after update: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing after update")
	}
	if th.ModelID != "openai/gpt-5-mini" {
		t.Fatalf("ModelID=%q, want %q", th.ModelID, "openai/gpt-5-mini")
	}
	if th.UpdatedAtUnixMs != updatedAt {
		t.Fatalf("UpdatedAtUnixMs changed: got=%d want=%d", th.UpdatedAtUnixMs, updatedAt)
	}
}

func TestStore_CreateThread_ModelLockDefaultsToFalse(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.ModelLocked {
		t.Fatalf("ModelLocked=%v, want false", th.ModelLocked)
	}
}

func TestStore_UpdateThreadModelLock(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := s.UpdateThreadModelLock(ctx, "env_1", "th_1", true); err != nil {
		t.Fatalf("UpdateThreadModelLock(true): %v", err)
	}
	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if !th.ModelLocked {
		t.Fatalf("ModelLocked=%v, want true", th.ModelLocked)
	}

	if err := s.UpdateThreadModelLock(ctx, "env_1", "th_1", false); err != nil {
		t.Fatalf("UpdateThreadModelLock(false): %v", err)
	}
	th, err = s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after unlock: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing after unlock")
	}
	if th.ModelLocked {
		t.Fatalf("ModelLocked=%v, want false", th.ModelLocked)
	}
}

func TestStore_UpdateTranscriptMessageJSONByRowID_DoesNotTouchThreadUpdatedAt(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rowID, err := s.AppendMessage(ctx, "env_1", "th_1", Message{
		ThreadID:        "th_1",
		EndpointID:      "env_1",
		MessageID:       "msg_1",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: 123,
		UpdatedAtUnixMs: 123,
		TextContent:     "hello",
		MessageJSON:     `{"id":"msg_1","role":"assistant","blocks":[{"type":"markdown","content":"hello"}],"status":"complete","timestamp":123}`,
	}, "u1", "u1@example.com")
	if err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}
	if rowID <= 0 {
		t.Fatalf("rowID=%d, want > 0", rowID)
	}

	th, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	updatedAt := th.UpdatedAtUnixMs
	if updatedAt <= 0 {
		t.Fatalf("UpdatedAtUnixMs=%d, want > 0", updatedAt)
	}
	activityRevision := th.FlowerActivityRevision
	activitySignature := th.FlowerActivitySignature

	nextJSON := `{"id":"msg_1","role":"assistant","blocks":[{"type":"markdown","content":"updated"}],"status":"complete","timestamp":123}`
	if err := s.UpdateTranscriptMessageJSONByRowID(ctx, "env_1", rowID, nextJSON, 0); err != nil {
		t.Fatalf("UpdateTranscriptMessageJSONByRowID: %v", err)
	}

	th2, err := s.GetThread(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThread after update: %v", err)
	}
	if th2 == nil {
		t.Fatalf("thread missing after update")
	}
	if th2.UpdatedAtUnixMs != updatedAt {
		t.Fatalf("UpdatedAtUnixMs changed: got=%d want=%d", th2.UpdatedAtUnixMs, updatedAt)
	}
	if th2.FlowerActivityRevision != activityRevision || th2.FlowerActivitySignature != activitySignature {
		t.Fatalf("Flower activity changed: got=(%d,%q) want=(%d,%q)", th2.FlowerActivityRevision, th2.FlowerActivitySignature, activityRevision, activitySignature)
	}

	_, gotJSON, err := s.GetTranscriptMessageRowIDAndJSONByMessageID(ctx, "env_1", "th_1", "msg_1")
	if err != nil {
		t.Fatalf("GetTranscriptMessageRowIDAndJSONByMessageID: %v", err)
	}
	if gotJSON != nextJSON {
		t.Fatalf("message_json=%q, want %q", gotJSON, nextJSON)
	}
}

func TestStore_ListRecentThreadToolCalls(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_a",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_a",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun run_a: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:      "run_a",
		ToolID:     "tool_a",
		ToolName:   "terminal.exec",
		Status:     "success",
		ArgsJSON:   `{"command":"pwd","cwd":"/"}`,
		ResultJSON: `{"stdout":"/\n","exit_code":0}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall tool_a: %v", err)
	}

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_b",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_b",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun run_b: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:        "run_b",
		ToolID:       "tool_b",
		ToolName:     "terminal.exec",
		Status:       "error",
		ArgsJSON:     `{"command":"rg \"TODO\" .","cwd":"/tmp"}`,
		ErrorCode:    "INVALID_PATH",
		ErrorMessage: "path must be absolute",
	}); err != nil {
		t.Fatalf("UpsertToolCall tool_b: %v", err)
	}

	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_other",
		EndpointID: "env_1",
		ThreadID:   "th_other",
		MessageID:  "msg_other",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun run_other: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:    "run_other",
		ToolID:   "tool_other",
		ToolName: "apply_patch",
		Status:   "success",
		ArgsJSON: `{"patch":"diff --git a/a.txt b/a.txt"}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall tool_other: %v", err)
	}

	recs, err := s.ListRecentThreadToolCalls(ctx, "env_1", "th_1", 10)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls: %v", err)
	}
	if len(recs) != 2 {
		t.Fatalf("len(recs)=%d, want 2", len(recs))
	}
	if recs[0].RunID != "run_a" || recs[0].ToolID != "tool_a" {
		t.Fatalf("recs[0]=%+v, want run_a/tool_a", recs[0])
	}
	if recs[1].RunID != "run_b" || recs[1].ToolID != "tool_b" {
		t.Fatalf("recs[1]=%+v, want run_b/tool_b", recs[1])
	}

	latestOnly, err := s.ListRecentThreadToolCalls(ctx, "env_1", "th_1", 1)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls latest: %v", err)
	}
	if len(latestOnly) != 1 {
		t.Fatalf("len(latestOnly)=%d, want 1", len(latestOnly))
	}
	if latestOnly[0].RunID != "run_b" || latestOnly[0].ToolID != "tool_b" {
		t.Fatalf("latestOnly[0]=%+v, want run_b/tool_b", latestOnly[0])
	}
}

func TestStore_GetToolCall(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.UpsertRun(ctx, RunRecord{
		RunID:      "run_a",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_a",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := s.UpsertToolCall(ctx, ToolCallRecord{
		RunID:      "run_a",
		ToolID:     "tool_a",
		ToolName:   "terminal.exec",
		Status:     "success",
		ArgsJSON:   `{"command":"pwd","cwd":"/tmp"}`,
		ResultJSON: `{"stdout":"ok\n","exit_code":0}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	rec, err := s.GetToolCall(ctx, "env_1", "run_a", "tool_a")
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec == nil {
		t.Fatalf("GetToolCall returned nil record")
	}
	if rec.ToolName != "terminal.exec" {
		t.Fatalf("ToolName=%q, want terminal.exec", rec.ToolName)
	}
	if rec.ResultJSON != `{"stdout":"ok\n","exit_code":0}` {
		t.Fatalf("ResultJSON=%q", rec.ResultJSON)
	}

	if _, err := s.GetToolCall(ctx, "env_1", "run_a", "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetToolCall missing err=%v, want sql.ErrNoRows", err)
	}
	if _, err := s.GetToolCall(ctx, "env_2", "run_a", "tool_a"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetToolCall endpoint mismatch err=%v, want sql.ErrNoRows", err)
	}
}

func TestBuildPreview_AssistantUsesLatestMarkdownBlock(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"markdown","content":"I will quickly scan the project layout first."},{"type":"activity-timeline","schema_version":1,"run_id":"run_1","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},"items":[{"item_id":"tool_terminal","tool_id":"tool_terminal","tool_name":"terminal.exec","kind":"tool","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false}]},{"type":"markdown","content":"Findings:\n- Has clear module boundaries.\nEvidence:\n- README.md defines run steps."}],"status":"complete","timestamp":1}`
	text := "I will quickly scan the project layout first.\nFindings:\n- Has clear module boundaries.\nEvidence:\n- README.md defines run steps."

	preview := buildPreview("assistant", text, messageJSON)
	if !strings.Contains(preview, "Findings:") {
		t.Fatalf("preview=%q, want latest markdown content", preview)
	}
	if strings.Contains(preview, "I will quickly scan the project layout first") {
		t.Fatalf("preview=%q, should not start from earlier attempt preamble", preview)
	}
}

func TestBuildPreview_AssistantUsesLatestVisibleThinkingBlock(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"markdown","content":"Initial summary."},{"type":"thinking","content":"Verified the runtime emits visible reasoning blocks."}],"status":"complete","timestamp":1}`

	preview := buildPreview("assistant", "", messageJSON)
	if !strings.Contains(preview, "visible reasoning blocks") {
		t.Fatalf("preview=%q, want latest visible thinking content", preview)
	}
}

func TestBuildPreview_AssistantUsesThinkingWhenNoMarkdownIsPresent(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"thinking","content":"Visible reasoning should stay user-facing."},{"type":"activity-timeline","schema_version":1,"run_id":"run_1","summary":{"status":"waiting","severity":"blocking","needs_attention":true,"attention_reasons":["waiting"],"total_items":1,"counts":{"waiting":1}},"items":[{"item_id":"tool_1","tool_id":"tool_1","tool_name":"ask_user","kind":"control","status":"waiting","severity":"blocking","needs_attention":true,"attention_reasons":["waiting"],"requires_approval":false}]}],"status":"complete","timestamp":1}`

	preview := buildPreview("assistant", "", messageJSON)
	if !strings.Contains(preview, "Visible reasoning") {
		t.Fatalf("preview=%q, want visible thinking text when no markdown is present", preview)
	}
}

func TestBuildPreview_AssistantFallsBackWhenMessageJSONInvalid(t *testing.T) {
	t.Parallel()

	text := "Fallback preview text"
	preview := buildPreview("assistant", text, "{invalid json")
	if preview != text {
		t.Fatalf("preview=%q, want %q", preview, text)
	}
}

func TestBuildPreview_AssistantReturnsEmptyWithoutVisibleText(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"activity-timeline","schema_version":1,"run_id":"run_1","summary":{"status":"waiting","severity":"blocking","needs_attention":true,"attention_reasons":["waiting"],"total_items":1,"counts":{"waiting":1}},"items":[{"item_id":"tool_1","tool_id":"tool_1","tool_name":"ask_user","kind":"control","status":"waiting","severity":"blocking","needs_attention":true,"attention_reasons":["waiting"],"requires_approval":false}]}],"status":"complete","timestamp":1}`

	preview := buildPreview("assistant", "", messageJSON)
	if preview != "" {
		t.Fatalf("preview=%q, want empty preview without visible text", preview)
	}
}

func TestBuildPreview_AssistantUsesTextBlockForFinalConclusion(t *testing.T) {
	t.Parallel()

	messageJSON := `{"id":"m1","role":"assistant","blocks":[{"type":"activity-timeline","schema_version":1,"run_id":"run_1","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},"items":[{"item_id":"tool_1","tool_id":"tool_1","tool_name":"task_complete","kind":"control","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false}]},{"type":"text","content":"Completed the verification and documented the remaining risks."}],"status":"complete","timestamp":1}`

	preview := buildPreview("assistant", "", messageJSON)
	if !strings.Contains(preview, "Completed the verification") {
		t.Fatalf("preview=%q, want task_complete result fallback", preview)
	}
}

func TestStore_ForkThreadCopiesContextAndClearsRunState(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{
		ThreadID:            "th_src",
		EndpointID:          "env_1",
		NamespacePublicID:   "ns_1",
		ModelID:             "openai/gpt-5",
		PermissionType:      "readonly",
		WorkingDir:          "/workspace/repo",
		Title:               "Source",
		RunStatus:           "success",
		LastContextRunID:    "run_src",
		CreatedAtUnixMs:     100,
		UpdatedAtUnixMs:     200,
		LastMessageAtUnixMs: 300,
		LastMessagePreview:  "latest answer",
		PinnedAtUnixMs:      400,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := s.InsertUpload(ctx, UploadRecord{
		UploadID:        "upl_1",
		EndpointID:      "env_1",
		StorageRelPath:  "upl_1.data",
		Name:            "fixture.txt",
		MimeType:        "text/plain",
		SizeBytes:       12,
		State:           UploadStateStaged,
		CreatedAtUnixMs: 90,
	}); err != nil {
		t.Fatalf("InsertUpload: %v", err)
	}
	if _, err := s.AppendMessageWithUploadRefs(ctx, "env_1", "th_src", Message{
		MessageID:          "msg_user",
		Role:               "user",
		Status:             "complete",
		AuthorUserPublicID: "u1",
		AuthorUserEmail:    "u1@example.com",
		CreatedAtUnixMs:    110,
		UpdatedAtUnixMs:    110,
		TextContent:        "msg_user",
		MessageJSON:        `{"id":"msg_user","role":"user","reply_to":"msg_assistant","note":"msg_user","blocks":[{"type":"text","content":"msg_user"}]}`,
	}, "u1", "u1@example.com", []string{"upl_1"}, 110); err != nil {
		t.Fatalf("AppendMessageWithUploadRefs user: %v", err)
	}
	if _, err := s.AppendMessage(ctx, "env_1", "th_src", Message{
		MessageID:       "msg_assistant",
		Role:            "assistant",
		Status:          "complete",
		CreatedAtUnixMs: 120,
		UpdatedAtUnixMs: 120,
		TextContent:     "done",
		MessageJSON:     `{"id":"msg_assistant","role":"assistant","source":"msg_user","blocks":[{"type":"activity-timeline","schema_version":1,"run_id":"run_src","thread_id":"th_src","turn_id":"msg_assistant","trace_id":"run_src","summary":{"status":"success","severity":"quiet","needs_attention":false,"total_items":1,"counts":{"success":1}},"items":[{"item_id":"tool_terminal","tool_id":"tool_terminal","tool_name":"terminal.exec","kind":"tool","status":"success","severity":"quiet","needs_attention":false,"requires_approval":false,"metadata":{"source":"msg_user"}}]},{"type":"markdown","content":"done"}]}`,
	}, "u1", "u1@example.com"); err != nil {
		t.Fatalf("AppendMessage assistant: %v", err)
	}
	if _, err := s.AppendConversationTurn(ctx, ConversationTurn{
		TurnID:             "turn_src",
		EndpointID:         "env_1",
		ThreadID:           "th_src",
		RunID:              "run_src",
		UserMessageID:      "msg_user",
		AssistantMessageID: "msg_assistant",
		CreatedAtUnixMs:    130,
	}); err != nil {
		t.Fatalf("AppendConversationTurn: %v", err)
	}
	sourceTurns, err := s.ListConversationTurns(ctx, "env_1", "th_src", 10)
	if err != nil {
		t.Fatalf("ListConversationTurns source: %v", err)
	}
	if len(sourceTurns) != 1 {
		t.Fatalf("source turns=%d, want 1", len(sourceTurns))
	}
	if err := s.ReplaceStructuredUserInputs(ctx, "env_1", "th_src", "msg_user", []StructuredUserInputRecord{{
		ResponseMessageID: "msg_user",
		QuestionID:        "q1",
		QuestionText:      "Need detail",
		Text:              "answer",
		PublicSummary:     "answered",
		CreatedAtUnixMs:   135,
	}}); err != nil {
		t.Fatalf("ReplaceStructuredUserInputs: %v", err)
	}
	if err := s.ReplaceRequestUserInputSecretAnswers(ctx, "env_1", "th_src", "msg_user", []RequestUserInputSecretAnswerRecord{{
		ResponseMessageID: "msg_user",
		QuestionID:        "q_secret",
		Text:              "raw secret",
		CreatedAtUnixMs:   136,
	}}); err != nil {
		t.Fatalf("ReplaceRequestUserInputSecretAnswers: %v", err)
	}
	if _, err := s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_src",
		TodosJSON:       `[{"id":"todo_1","content":"ship","status":"in_progress"}]`,
		UpdatedAtUnixMs: 140,
		UpdatedByRunID:  "run_src",
		UpdatedByToolID: "tool_src",
	}, nil); err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot: %v", err)
	}
	if err := s.UpsertMemoryItem(ctx, MemoryItemRecord{
		MemoryID:        "mem_src",
		EndpointID:      "env_1",
		ThreadID:        "th_src",
		Scope:           "working",
		Kind:            "fact",
		Content:         "remember this",
		SourceRefsJSON:  `[{"message_id":"msg_user"}]`,
		CreatedAtUnixMs: 150,
		UpdatedAtUnixMs: 150,
	}); err != nil {
		t.Fatalf("UpsertMemoryItem: %v", err)
	}
	if err := s.SetThreadOpenGoal(ctx, "env_1", "th_src", "finish the forkable task"); err != nil {
		t.Fatalf("SetThreadOpenGoal: %v", err)
	}
	if err := s.InsertContextSnapshot(ctx, ContextSnapshotRecord{
		SnapshotID:       "snap_src",
		EndpointID:       "env_1",
		ThreadID:         "th_src",
		Level:            "thread",
		SummaryText:      "compressed source context",
		CoversTurnFromID: sourceTurns[0].ID,
		CoversTurnToID:   sourceTurns[0].ID,
		QualityScore:     0.9,
		CreatedAtUnixMs:  155,
	}); err != nil {
		t.Fatalf("InsertContextSnapshot: %v", err)
	}
	if err := s.UpsertExecutionSpan(ctx, ExecutionSpanRecord{
		SpanID:          "span_src",
		EndpointID:      "env_1",
		ThreadID:        "th_src",
		RunID:           "run_src",
		Kind:            "tool",
		Name:            "terminal.exec",
		Status:          "success",
		PayloadJSON:     `{"stdout":"ok"}`,
		StartedAtUnixMs: 156,
		EndedAtUnixMs:   157,
		UpdatedAtUnixMs: 157,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan: %v", err)
	}
	if err := s.UpsertRun(ctx, RunRecord{RunID: "run_src", EndpointID: "env_1", ThreadID: "th_src", State: "success"}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := s.UpsertFlowerThreadMetadata(ctx, FlowerThreadMetadata{
		EndpointID:          "env_1",
		ThreadID:            "th_src",
		OwnerKind:           "thread_home",
		OwnerID:             "local-environment",
		ParentRunID:         "run_parent",
		ContextJSON:         `{"ok":true}`,
		ActionJSON:          `{"action":"ask"}`,
		HomeRuntimeID:       "local-environment",
		HomeRuntimeKind:     "local_environment",
		OriginEnvPublicID:   "env_origin",
		PrimaryTargetID:     "target_1",
		ActiveTargetIDsJSON: `["target_1"]`,
		UpdatedAtUnixMs:     160,
	}); err != nil {
		t.Fatalf("UpsertFlowerThreadMetadata: %v", err)
	}
	source, err := s.GetThread(ctx, "env_1", "th_src")
	if err != nil {
		t.Fatalf("GetThread source before fork: %v", err)
	}
	if source == nil {
		t.Fatalf("source thread missing before fork")
	}
	if source.FlowerActivityRevision <= 0 || source.FlowerActivitySignature == "" {
		t.Fatalf("source Flower activity not initialized: %+v", source)
	}

	forked, err := s.ForkThread(ctx, ForkThreadRequest{
		EndpointID:            "env_1",
		SourceThreadID:        "th_src",
		DestinationThreadID:   "th_fork",
		Title:                 "Forked",
		CreatedByUserPublicID: "u2",
		CreatedByUserEmail:    "u2@example.com",
		CreatedAtUnixMs:       1000,
	})
	if err != nil {
		t.Fatalf("ForkThread: %v", err)
	}
	if forked.ThreadID != "th_fork" || forked.Title != "Forked" {
		t.Fatalf("forked thread mismatch: %+v", forked)
	}
	if forked.RunStatus != "idle" || forked.LastContextRunID != "" || forked.WaitingUserInputJSON != "" || forked.PinnedAtUnixMs != 0 {
		t.Fatalf("forked run state not cleared: %+v", forked)
	}
	if source.PermissionType != "readonly" || forked.PermissionType != "readonly" {
		t.Fatalf("fork permission types source=%q forked=%q, want readonly", source.PermissionType, forked.PermissionType)
	}
	if forked.FlowerActivityRevision <= 0 {
		t.Fatalf("forked FlowerActivityRevision=%d, want > 0", forked.FlowerActivityRevision)
	}
	if forked.FlowerActivitySignature == "" || !strings.Contains(forked.FlowerActivitySignature, "status:idle") {
		t.Fatalf("forked FlowerActivitySignature=%q, want idle snapshot", forked.FlowerActivitySignature)
	}
	if forked.FlowerActivitySignature == source.FlowerActivitySignature {
		t.Fatalf("forked FlowerActivitySignature inherited source signature %q", forked.FlowerActivitySignature)
	}
	if forked.FlowerActivityWaitingPromptID != "" {
		t.Fatalf("forked FlowerActivityWaitingPromptID=%q, want empty", forked.FlowerActivityWaitingPromptID)
	}
	msgs, _, _, err := s.ListMessages(ctx, "env_1", "th_fork", 10, 0)
	if err != nil {
		t.Fatalf("ListMessages fork: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("fork messages=%d, want 2", len(msgs))
	}
	if msgs[0].MessageID == "msg_user" || !strings.Contains(msgs[0].MessageJSON, msgs[0].MessageID) || !strings.Contains(msgs[0].MessageJSON, `"note":"msg_user"`) || msgs[0].TextContent != "msg_user" {
		t.Fatalf("fork user message id/json not rewritten: %+v", msgs[0])
	}
	var assistantJSON map[string]any
	if err := json.Unmarshal([]byte(msgs[1].MessageJSON), &assistantJSON); err != nil {
		t.Fatalf("assistant fork message json invalid: %v", err)
	}
	if got := strings.TrimSpace(fmt.Sprint(assistantJSON["id"])); got != msgs[1].MessageID {
		t.Fatalf("assistant fork message id=%q, want %q", got, msgs[1].MessageID)
	}
	if got := strings.TrimSpace(fmt.Sprint(assistantJSON["source"])); got != "msg_user" {
		t.Fatalf("assistant source=%q, want original non-reference source", got)
	}
	blocks, ok := assistantJSON["blocks"].([]any)
	if !ok || len(blocks) != 2 {
		t.Fatalf("assistant blocks=%#v, want 2 blocks", assistantJSON["blocks"])
	}
	timeline, ok := blocks[0].(map[string]any)
	if !ok {
		t.Fatalf("timeline block=%#v, want object", blocks[0])
	}
	if got := strings.TrimSpace(fmt.Sprint(timeline["thread_id"])); got != "th_fork" {
		t.Fatalf("timeline thread_id=%q, want fork thread", got)
	}
	if got := strings.TrimSpace(fmt.Sprint(timeline["turn_id"])); got != msgs[1].MessageID {
		t.Fatalf("timeline turn_id=%q, want %q", got, msgs[1].MessageID)
	}
	items, ok := timeline["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("timeline items=%#v, want one item", timeline["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("timeline item=%#v, want object", items[0])
	}
	metadata, ok := item["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("timeline item metadata=%#v, want object", item["metadata"])
	}
	if got := strings.TrimSpace(fmt.Sprint(metadata["source"])); got != "msg_user" {
		t.Fatalf("timeline metadata source=%q, want original non-reference value", got)
	}
	markdown, ok := blocks[1].(map[string]any)
	if !ok || strings.TrimSpace(fmt.Sprint(markdown["type"])) != "markdown" || strings.TrimSpace(fmt.Sprint(markdown["content"])) != "done" {
		t.Fatalf("assistant final block=%#v, want markdown conclusion", blocks[1])
	}
	turns, err := s.ListConversationTurns(ctx, "env_1", "th_fork", 10)
	if err != nil {
		t.Fatalf("ListConversationTurns fork: %v", err)
	}
	if len(turns) != 1 || turns[0].RunID != "" || turns[0].UserMessageID != msgs[0].MessageID || turns[0].AssistantMessageID != msgs[1].MessageID {
		t.Fatalf("fork turns mismatch: %+v messages=%+v", turns, msgs)
	}
	if todos, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_fork"); err != nil {
		t.Fatalf("GetThreadTodosSnapshot fork: %v", err)
	} else if todos.Version != 1 || todos.UpdatedByRunID != "" || !strings.Contains(todos.TodosJSON, "todo_1") {
		t.Fatalf("fork todos mismatch: %+v", todos)
	}
	if memories, err := s.ListRecentMemoryItems(ctx, "env_1", "th_fork", 10); err != nil {
		t.Fatalf("ListRecentMemoryItems fork: %v", err)
	} else if len(memories) != 2 || memories[0].MemoryID == "mem_src" || !strings.Contains(memories[0].SourceRefsJSON, msgs[0].MessageID) {
		t.Fatalf("fork memory mismatch: %+v", memories)
	}
	if goal, err := s.GetThreadOpenGoal(ctx, "env_1", "th_fork"); err != nil {
		t.Fatalf("GetThreadOpenGoal fork: %v", err)
	} else if goal != "finish the forkable task" {
		t.Fatalf("fork open goal=%q, want source goal", goal)
	}
	if secrets := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM request_user_input_secret_answers WHERE endpoint_id = ? AND thread_id = ?`, "env_1", "th_fork"); secrets != 0 {
		t.Fatalf("fork secret answers=%d, want 0", secrets)
	}
	if snaps, err := s.ListContextSnapshots(ctx, "env_1", "th_fork", "thread", 10); err != nil {
		t.Fatalf("ListContextSnapshots fork: %v", err)
	} else if len(snaps) != 1 || snaps[0].SnapshotID == "snap_src" || snaps[0].SummaryText != "compressed source context" || snaps[0].CoversTurnFromID != turns[0].ID || snaps[0].CoversTurnToID != turns[0].ID {
		t.Fatalf("fork context snapshots mismatch: %+v", snaps)
	}
	if spans, err := s.ListRecentExecutionSpansByThread(ctx, "env_1", "th_fork", 10); err != nil {
		t.Fatalf("ListRecentExecutionSpansByThread fork: %v", err)
	} else if len(spans) != 0 {
		t.Fatalf("fork execution spans=%+v, want none", spans)
	}
	if refs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_upload_refs WHERE endpoint_id = ? AND thread_id = ?`, "env_1", "th_fork"); refs != 1 {
		t.Fatalf("fork upload refs=%d, want 1", refs)
	}
	if runs := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_runs WHERE endpoint_id = ? AND thread_id = ?`, "env_1", "th_fork"); runs != 0 {
		t.Fatalf("fork runs=%d, want 0", runs)
	}
	meta, err := s.GetFlowerThreadMetadata(ctx, "env_1", "th_fork")
	if err != nil {
		t.Fatalf("GetFlowerThreadMetadata fork: %v", err)
	}
	if meta == nil || meta.ParentThreadID != "th_src" || meta.ParentRunID != "" || meta.HomeRuntimeID != "local-environment" {
		t.Fatalf("fork flower metadata mismatch: %+v", meta)
	}
}

func TestStore_ReplaceThreadTodosSnapshot(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	initial, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot initial: %v", err)
	}
	if initial.Version != 0 {
		t.Fatalf("initial.Version=%d, want 0", initial.Version)
	}
	if initial.TodosJSON != "[]" {
		t.Fatalf("initial.TodosJSON=%q, want []", initial.TodosJSON)
	}

	payload1 := `[{"id":"todo_1","content":"Inspect workspace","status":"in_progress"}]`
	updated, err := s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       payload1,
		UpdatedByRunID:  "run_1",
		UpdatedByToolID: "tool_1",
	}, nil)
	if err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot first: %v", err)
	}
	if updated.Version != 1 {
		t.Fatalf("updated.Version=%d, want 1", updated.Version)
	}

	payload2 := `[{"id":"todo_1","content":"Inspect workspace","status":"completed"}]`
	expectedV1 := int64(1)
	updated, err = s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       payload2,
		UpdatedByRunID:  "run_1",
		UpdatedByToolID: "tool_2",
	}, &expectedV1)
	if err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot second: %v", err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated.Version=%d, want 2", updated.Version)
	}

	latest, err := s.GetThreadTodosSnapshot(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot latest: %v", err)
	}
	if latest.Version != 2 {
		t.Fatalf("latest.Version=%d, want 2", latest.Version)
	}
	var decoded []map[string]any
	if err := json.Unmarshal([]byte(latest.TodosJSON), &decoded); err != nil {
		t.Fatalf("decode latest todos: %v", err)
	}
	if len(decoded) != 1 {
		t.Fatalf("len(decoded)=%d, want 1", len(decoded))
	}
	if got := strings.TrimSpace(anyToString(decoded[0]["status"])); got != "completed" {
		t.Fatalf("status=%q, want completed", got)
	}

	stale := int64(1)
	_, err = s.ReplaceThreadTodosSnapshot(ctx, ThreadTodosSnapshot{
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		TodosJSON:       payload1,
		UpdatedByRunID:  "run_2",
		UpdatedByToolID: "tool_3",
	}, &stale)
	if !errors.Is(err, ErrThreadTodosVersionConflict) {
		t.Fatalf("stale replace err=%v, want %v", err, ErrThreadTodosVersionConflict)
	}
}

func TestStore_ListRunEventsPage_ContextCategory(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	appendEvent := func(eventType string) {
		t.Helper()
		err := s.AppendRunEvent(ctx, RunEventRecord{
			EndpointID:  "env_1",
			ThreadID:    "th_1",
			RunID:       "run_1",
			StreamKind:  "lifecycle",
			EventType:   eventType,
			PayloadJSON: "{}",
			AtUnixMs:    time.Now().UnixMilli(),
		})
		if err != nil {
			t.Fatalf("AppendRunEvent(%s): %v", eventType, err)
		}
	}

	appendEvent("context.integrity.repair_applied")
	appendEvent("context.usage.updated")
	appendEvent("context.compaction.updated")
	appendEvent("floret.projected_turn.result")

	firstPage, nextCursor, hasMore, err := s.ListRunEventsPage(ctx, "env_1", "run_1", RunEventsQuery{
		Category: "context",
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListRunEventsPage first: %v", err)
	}
	if len(firstPage) != 2 {
		t.Fatalf("len(firstPage)=%d, want 2", len(firstPage))
	}
	if hasMore {
		t.Fatalf("hasMore=%v, want false", hasMore)
	}
	if strings.TrimSpace(firstPage[0].EventType) != "context.usage.updated" {
		t.Fatalf("firstPage[0].EventType=%q, want context.usage.updated", firstPage[0].EventType)
	}
	if strings.TrimSpace(firstPage[1].EventType) != "context.compaction.updated" {
		t.Fatalf("firstPage[1].EventType=%q, want context.compaction.updated", firstPage[1].EventType)
	}
	if nextCursor <= 0 {
		t.Fatalf("nextCursor=%d, want > 0", nextCursor)
	}

	secondPage, secondCursor, secondHasMore, err := s.ListRunEventsPage(ctx, "env_1", "run_1", RunEventsQuery{
		Category: "context",
		Limit:    2,
		Cursor:   nextCursor,
	})
	if err != nil {
		t.Fatalf("ListRunEventsPage second: %v", err)
	}
	if secondHasMore {
		t.Fatalf("secondHasMore=%v, want false", secondHasMore)
	}
	if len(secondPage) != 0 {
		t.Fatalf("len(secondPage)=%d, want 0", len(secondPage))
	}
	if secondCursor < nextCursor {
		t.Fatalf("secondCursor=%d, want >= %d", secondCursor, nextCursor)
	}
}

func TestStore_AppendRunEvent_AgeRetention(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "chat"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	oldEventTime := time.Now().Add(-(runEventRetentionMaxAge + 24*time.Hour)).UnixMilli()
	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_1",
		StreamKind:  "context",
		EventType:   "context.usage.updated",
		PayloadJSON: "{}",
		AtUnixMs:    oldEventTime,
	}); err != nil {
		t.Fatalf("AppendRunEvent old: %v", err)
	}

	eventsAfterOld, err := s.ListRunEvents(ctx, "env_1", "run_1", 10)
	if err != nil {
		t.Fatalf("ListRunEvents after old: %v", err)
	}
	if len(eventsAfterOld) != 0 {
		t.Fatalf("len(eventsAfterOld)=%d, want 0", len(eventsAfterOld))
	}

	if err := s.AppendRunEvent(ctx, RunEventRecord{
		EndpointID:  "env_1",
		ThreadID:    "th_1",
		RunID:       "run_1",
		StreamKind:  "context",
		EventType:   "context.compaction.updated",
		PayloadJSON: "{}",
		AtUnixMs:    time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("AppendRunEvent fresh: %v", err)
	}

	events, err := s.ListRunEvents(ctx, "env_1", "run_1", 10)
	if err != nil {
		t.Fatalf("ListRunEvents fresh: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("len(events)=%d, want 1", len(events))
	}
	if strings.TrimSpace(events[0].EventType) != "context.compaction.updated" {
		t.Fatalf("EventType=%q, want context.compaction.updated", events[0].EventType)
	}
}

func anyToString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func TestStore_FollowupsCRUDReorderAndRecover(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_queue", EndpointID: "env_queue", Title: "queue"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	first, firstPos, firstRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_1",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneQueued,
		MessageID:             "m_queue_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "first queued turn",
		AttachmentsJSON:       `[{"name":"spec.md","mime_type":"text/markdown","url":"file:///tmp/spec.md"}]`,
		OptionsJSON:           `{"permission_type":"readonly"}`,
		SessionMetaJSON:       `{"channel_id":"ch_queue","endpoint_id":"env_queue","can_read":true,"can_write":true,"can_execute":true}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       1000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup first: %v", err)
	}
	if firstPos != 1 {
		t.Fatalf("firstPos=%d, want 1", firstPos)
	}
	if first.ChannelID != "ch_queue" {
		t.Fatalf("first.ChannelID=%q, want ch_queue", first.ChannelID)
	}
	if !strings.Contains(first.SessionMetaJSON, `"can_execute":true`) {
		t.Fatalf("first.SessionMetaJSON=%q, want persisted execute permission", first.SessionMetaJSON)
	}
	if firstRevision <= 0 {
		t.Fatalf("firstRevision=%d, want > 0", firstRevision)
	}

	_, secondPos, secondRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_2",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneQueued,
		MessageID:             "m_queue_2",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "second queued turn",
		OptionsJSON:           `{"permission_type":"approval_required"}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       2000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup second: %v", err)
	}
	if secondPos != 2 {
		t.Fatalf("secondPos=%d, want 2", secondPos)
	}
	if secondRevision <= firstRevision {
		t.Fatalf("secondRevision=%d, want > %d", secondRevision, firstRevision)
	}

	_, draftPos, draftRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_3",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneDraft,
		MessageID:             "m_draft_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "draft follow-up",
		OptionsJSON:           `{"permission_type":"readonly"}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       3000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup draft: %v", err)
	}
	if draftPos != 1 {
		t.Fatalf("draftPos=%d, want 1", draftPos)
	}
	if draftRevision <= secondRevision {
		t.Fatalf("draftRevision=%d, want > %d", draftRevision, secondRevision)
	}

	count, err := s.CountFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued)
	if err != nil {
		t.Fatalf("CountFollowupsByLane: %v", err)
	}
	if count != 2 {
		t.Fatalf("count=%d, want 2", count)
	}

	counts, err := s.CountFollowupsByThreadAndLane(ctx, "env_queue", []string{"th_queue", "th_other"}, FollowupLaneQueued)
	if err != nil {
		t.Fatalf("CountFollowupsByThreadAndLane: %v", err)
	}
	if counts["th_queue"] != 2 {
		t.Fatalf("counts[th_queue]=%d, want 2", counts["th_queue"])
	}
	if counts["th_other"] != 0 {
		t.Fatalf("counts[th_other]=%d, want 0", counts["th_other"])
	}

	queuedThreads, err := s.ListThreadsWithQueuedTurns(ctx, 10)
	if err != nil {
		t.Fatalf("ListThreadsWithQueuedTurns: %v", err)
	}
	if len(queuedThreads) != 1 {
		t.Fatalf("queuedThreads=%+v, want one thread", queuedThreads)
	}
	if queuedThreads[0].EndpointID != "env_queue" ||
		queuedThreads[0].ThreadID != "th_queue" ||
		queuedThreads[0].QueuedTurnCount != 2 ||
		queuedThreads[0].FirstQueuedTurnID != "fu_1" ||
		queuedThreads[0].FirstQueuedSortIndex != 1 {
		t.Fatalf("queuedThreads[0]=%+v, want queued thread summary for fu_1", queuedThreads[0])
	}

	queued, err := s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued: %v", err)
	}
	if len(queued) != 2 {
		t.Fatalf("len(queued)=%d, want 2", len(queued))
	}
	if queued[0].QueueID != "fu_1" || queued[1].QueueID != "fu_2" {
		t.Fatalf("unexpected queued order: %+v", queued)
	}
	if queued[0].Lane != FollowupLaneQueued {
		t.Fatalf("queued[0].Lane=%q, want %q", queued[0].Lane, FollowupLaneQueued)
	}
	defaultLimited, err := s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 0)
	if err != nil {
		t.Fatalf("ListFollowupsByLane default limit: %v", err)
	}
	if len(defaultLimited) != 2 {
		t.Fatalf("len(defaultLimited)=%d, want 2", len(defaultLimited))
	}

	revision, err := s.GetThreadFollowupsRevision(ctx, "env_queue", "th_queue")
	if err != nil {
		t.Fatalf("GetThreadFollowupsRevision: %v", err)
	}
	if revision != draftRevision {
		t.Fatalf("revision=%d, want %d", revision, draftRevision)
	}

	compatRevisionBefore := revision
	if err := s.UpdateQueuedTurn(ctx, "env_queue", "th_queue", "fu_1", "compat updated first follow-up"); err != nil {
		t.Fatalf("UpdateQueuedTurn: %v", err)
	}
	revision, err = s.GetThreadFollowupsRevision(ctx, "env_queue", "th_queue")
	if err != nil {
		t.Fatalf("GetThreadFollowupsRevision after UpdateQueuedTurn: %v", err)
	}
	if revision <= compatRevisionBefore {
		t.Fatalf("revision after UpdateQueuedTurn=%d, want > %d", revision, compatRevisionBefore)
	}

	updatedRevision, err := s.UpdateFollowupText(ctx, "env_queue", "th_queue", "fu_2", "updated second follow-up")
	if err != nil {
		t.Fatalf("UpdateFollowupText: %v", err)
	}
	if updatedRevision <= revision {
		t.Fatalf("updatedRevision=%d, want > %d", updatedRevision, revision)
	}

	queued, err = s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued updated: %v", err)
	}
	if queued[1].TextContent != "updated second follow-up" {
		t.Fatalf("queued[1].TextContent=%q, want updated second follow-up", queued[1].TextContent)
	}
	if queued[0].TextContent != "compat updated first follow-up" {
		t.Fatalf("queued[0].TextContent=%q, want compat updated first follow-up", queued[0].TextContent)
	}

	reorderedRevision, err := s.ReorderFollowups(ctx, "env_queue", "th_queue", FollowupLaneQueued, []string{"fu_2", "fu_1"}, updatedRevision)
	if err != nil {
		t.Fatalf("ReorderFollowups: %v", err)
	}
	if reorderedRevision <= updatedRevision {
		t.Fatalf("reorderedRevision=%d, want > %d", reorderedRevision, updatedRevision)
	}

	queued, err = s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued reordered: %v", err)
	}
	if queued[0].QueueID != "fu_2" || queued[1].QueueID != "fu_1" {
		t.Fatalf("unexpected reordered queue: %+v", queued)
	}

	if _, err := s.ReorderFollowups(ctx, "env_queue", "th_queue", FollowupLaneQueued, []string{"fu_1", "fu_2"}, updatedRevision); !errors.Is(err, ErrFollowupsRevisionChanged) {
		t.Fatalf("stale ReorderFollowups err=%v, want %v", err, ErrFollowupsRevisionChanged)
	}

	recovered, recoveredRevision, err := s.RecoverQueuedTurnsToDrafts(ctx, "env_queue", "th_queue")
	if err != nil {
		t.Fatalf("RecoverQueuedTurnsToDrafts: %v", err)
	}
	if len(recovered) != 2 {
		t.Fatalf("len(recovered)=%d, want 2", len(recovered))
	}
	if recovered[0].QueueID != "fu_2" || recovered[1].QueueID != "fu_1" {
		t.Fatalf("unexpected recovered followups: %+v", recovered)
	}
	if recoveredRevision <= reorderedRevision {
		t.Fatalf("recoveredRevision=%d, want > %d", recoveredRevision, reorderedRevision)
	}

	finalQueued, err := s.CountFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneQueued)
	if err != nil {
		t.Fatalf("CountFollowupsByLane queued final: %v", err)
	}
	if finalQueued != 0 {
		t.Fatalf("finalQueued=%d, want 0", finalQueued)
	}

	drafts, err := s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane draft: %v", err)
	}
	if len(drafts) != 3 {
		t.Fatalf("len(drafts)=%d, want 3", len(drafts))
	}
	if drafts[0].QueueID != "fu_3" || drafts[1].QueueID != "fu_2" || drafts[2].QueueID != "fu_1" {
		t.Fatalf("unexpected draft order: %+v", drafts)
	}

	queuedFromDraft, queuedFromDraftPos, queuedFromDraftRevision, err := s.CreateFollowup(ctx, QueuedTurn{
		QueueID:               "fu_4",
		EndpointID:            "env_queue",
		ThreadID:              "th_queue",
		ChannelID:             "ch_queue",
		Lane:                  FollowupLaneQueued,
		MessageID:             "m_draft_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "queued copy of draft message",
		OptionsJSON:           `{"permission_type":"approval_required"}`,
		CreatedByUserPublicID: "u_queue",
		CreatedByUserEmail:    "u_queue@example.com",
		CreatedAtUnixMs:       4000,
	})
	if err != nil {
		t.Fatalf("CreateFollowup queued copy of draft message: %v", err)
	}
	if queuedFromDraft.QueueID != "fu_4" || queuedFromDraft.Lane != FollowupLaneQueued {
		t.Fatalf("queuedFromDraft=%+v, want new queued followup", queuedFromDraft)
	}
	if queuedFromDraftPos != 1 {
		t.Fatalf("queuedFromDraftPos=%d, want 1", queuedFromDraftPos)
	}
	if queuedFromDraftRevision <= recoveredRevision {
		t.Fatalf("queuedFromDraftRevision=%d, want > %d", queuedFromDraftRevision, recoveredRevision)
	}

	deletedRevision, err := s.DeleteFollowup(ctx, "env_queue", "th_queue", "fu_1")
	if err != nil {
		t.Fatalf("DeleteFollowup: %v", err)
	}
	if deletedRevision <= queuedFromDraftRevision {
		t.Fatalf("deletedRevision=%d, want > %d", deletedRevision, queuedFromDraftRevision)
	}

	drafts, err = s.ListFollowupsByLane(ctx, "env_queue", "th_queue", FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane draft after delete: %v", err)
	}
	if len(drafts) != 2 {
		t.Fatalf("len(drafts)=%d, want 2", len(drafts))
	}
}

func TestStore_QueuedTurnCompatibilityAPIsBumpFollowupsRevision(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	if err := s.CreateThread(ctx, Thread{ThreadID: "th_queue_compat", EndpointID: "env_queue_compat", Title: "queue"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	enqueue := func(queueID string, messageID string, text string) {
		t.Helper()
		if _, _, err := s.EnqueueQueuedTurn(ctx, QueuedTurn{
			QueueID:     queueID,
			EndpointID:  "env_queue_compat",
			ThreadID:    "th_queue_compat",
			ChannelID:   "ch_queue_compat",
			MessageID:   messageID,
			TextContent: text,
		}); err != nil {
			t.Fatalf("EnqueueQueuedTurn(%s): %v", queueID, err)
		}
	}
	revision := func() int64 {
		t.Helper()
		out, err := s.GetThreadFollowupsRevision(ctx, "env_queue_compat", "th_queue_compat")
		if err != nil {
			t.Fatalf("GetThreadFollowupsRevision: %v", err)
		}
		return out
	}
	wantBumped := func(label string, before int64) int64 {
		t.Helper()
		after := revision()
		if after <= before {
			t.Fatalf("%s revision=%d, want > %d", label, after, before)
		}
		return after
	}

	enqueue("q_1", "m_1", "first")
	enqueue("q_2", "m_2", "second")
	rev := revision()
	if rev != 2 {
		t.Fatalf("revision=%d, want 2 after two enqueues", rev)
	}

	if err := s.UpdateQueuedTurn(ctx, "env_queue_compat", "th_queue_compat", "q_1", "updated first"); err != nil {
		t.Fatalf("UpdateQueuedTurn: %v", err)
	}
	rev = wantBumped("UpdateQueuedTurn", rev)

	popped, err := s.PopNextQueuedTurn(ctx, "env_queue_compat", "th_queue_compat")
	if err != nil {
		t.Fatalf("PopNextQueuedTurn: %v", err)
	}
	if popped == nil || popped.QueueID != "q_1" {
		t.Fatalf("popped=%+v, want q_1", popped)
	}
	rev = wantBumped("PopNextQueuedTurn", rev)

	enqueue("q_3", "m_3", "third")
	rev = wantBumped("EnqueueQueuedTurn q_3", rev)

	if err := s.DeleteQueuedTurn(ctx, "env_queue_compat", "th_queue_compat", "q_2"); err != nil {
		t.Fatalf("DeleteQueuedTurn: %v", err)
	}
	rev = wantBumped("DeleteQueuedTurn", rev)

	enqueue("q_4", "m_4", "fourth")
	rev = wantBumped("EnqueueQueuedTurn q_4", rev)

	if err := s.DeleteQueuedTurns(ctx, "env_queue_compat", "th_queue_compat"); err != nil {
		t.Fatalf("DeleteQueuedTurns: %v", err)
	}
	rev = wantBumped("DeleteQueuedTurns", rev)

	if err := s.DeleteQueuedTurns(ctx, "env_queue_compat", "th_queue_compat"); err != nil {
		t.Fatalf("DeleteQueuedTurns empty: %v", err)
	}
	if after := revision(); after != rev {
		t.Fatalf("empty DeleteQueuedTurns revision=%d, want unchanged %d", after, rev)
	}
}

func TestStore_ThreadProviderContinuationCRUD(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	if err := s.CreateThread(ctx, Thread{
		ThreadID:              "th_resume",
		EndpointID:            "env_resume",
		NamespacePublicID:     "ns_resume",
		CreatedByUserPublicID: "u1",
		CreatedByUserEmail:    "u1@example.com",
		UpdatedByUserPublicID: "u1",
		UpdatedByUserEmail:    "u1@example.com",
		CreatedAtUnixMs:       1,
		UpdatedAtUnixMs:       1,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	continuation := ThreadProviderContinuation{
		State: ProviderContinuationState{
			Kind:       "openai_responses",
			ID:         "resp_1",
			Attributes: map[string]string{"cursor": "cur_1", "region": "iad"},
		},
		ProviderID:      "openai",
		Model:           "gpt-5-mini",
		BaseURL:         "https://api.openai.com/v1",
		UpdatedAtUnixMs: 10,
	}
	if err := s.SetThreadProviderContinuation(ctx, "env_resume", "th_resume", continuation); err != nil {
		t.Fatalf("SetThreadProviderContinuation: %v", err)
	}

	got, err := s.GetThreadProviderContinuation(ctx, "env_resume", "th_resume")
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation: %v", err)
	}
	if got == nil {
		t.Fatalf("expected continuation state")
	}
	if !reflect.DeepEqual(*got, continuation) {
		t.Fatalf("continuation=%+v, want %+v", *got, continuation)
	}
	got.State.Attributes["cursor"] = "mutated"
	again, err := s.GetThreadProviderContinuation(ctx, "env_resume", "th_resume")
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation again: %v", err)
	}
	if again == nil || again.State.Attributes["cursor"] != "cur_1" {
		t.Fatalf("continuation attributes after mutation=%+v, want original", again)
	}

	state, err := s.GetThreadState(ctx, "env_resume", "th_resume")
	if err != nil {
		t.Fatalf("GetThreadState: %v", err)
	}
	if state == nil {
		t.Fatalf("expected thread state row")
	}
	if !reflect.DeepEqual(state.ProviderContinuation, continuation) {
		t.Fatalf("thread state continuation=%+v, want %+v", state.ProviderContinuation, continuation)
	}

	if err := s.ClearThreadProviderContinuation(ctx, "env_resume", "th_resume"); err != nil {
		t.Fatalf("ClearThreadProviderContinuation: %v", err)
	}
	got, err = s.GetThreadProviderContinuation(ctx, "env_resume", "th_resume")
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation after clear: %v", err)
	}
	if got != nil {
		t.Fatalf("continuation after clear=%+v, want nil", got)
	}
}

func TestStore_SetThreadProviderContinuationAndCompactedContext(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	if err := s.CreateThread(ctx, Thread{
		ThreadID:        "th_compacted_pair",
		EndpointID:      "env_compacted_pair",
		CreatedAtUnixMs: 1,
		UpdatedAtUnixMs: 1,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	continuation := ThreadProviderContinuation{
		State: ProviderContinuationState{
			Kind:       "openai_responses",
			ID:         "resp_pair",
			Attributes: map[string]string{"cursor": "cur_pair"},
		},
		ProviderID:      "openai",
		Model:           "gpt-5-mini",
		BaseURL:         "https://api.openai.com/v1",
		UpdatedAtUnixMs: 10,
	}
	compacted := ThreadCompactedContext{
		OperationID:             "compact-pair",
		RequestID:               "manual-pair",
		Source:                  "slash_command",
		CompactionID:            "cmp-pair",
		CompactionGeneration:    2,
		CompactionWindowID:      "window-pair",
		CompactedThroughEntryID: "entry-pair",
		CoveredThroughTurnRowID: 42,
		CoveredThroughMessageID: 99,
		Transcript: []ThreadCompactedMessage{{
			Role:    "user",
			Content: "summary",
			Kind:    "compaction_summary",
		}},
		CreatedAtUnixMs: 100,
		UpdatedAtUnixMs: 101,
	}

	if err := s.SetThreadProviderContinuationAndCompactedContext(ctx, "env_compacted_pair", "th_compacted_pair", continuation, compacted); err != nil {
		t.Fatalf("SetThreadProviderContinuationAndCompactedContext: %v", err)
	}
	state, err := s.GetThreadState(ctx, "env_compacted_pair", "th_compacted_pair")
	if err != nil {
		t.Fatalf("GetThreadState: %v", err)
	}
	if state == nil {
		t.Fatalf("expected thread state")
	}
	if !reflect.DeepEqual(state.ProviderContinuation, continuation) {
		t.Fatalf("continuation=%+v, want %+v", state.ProviderContinuation, continuation)
	}
	if state.CompactedContext.CoveredThroughTurnRowID != 42 || state.CompactedContext.CoveredThroughMessageID != 99 {
		t.Fatalf("compacted boundary=%+v", state.CompactedContext)
	}

	compacted.OperationID = "compact-pair-cleared-continuation"
	compacted.RequestID = "manual-cleared"
	if err := s.SetThreadProviderContinuationAndCompactedContext(ctx, "env_compacted_pair", "th_compacted_pair", ThreadProviderContinuation{}, compacted); err != nil {
		t.Fatalf("SetThreadProviderContinuationAndCompactedContext clear continuation: %v", err)
	}
	state, err = s.GetThreadState(ctx, "env_compacted_pair", "th_compacted_pair")
	if err != nil {
		t.Fatalf("GetThreadState after clear: %v", err)
	}
	if state == nil {
		t.Fatalf("expected thread state after clear")
	}
	if !state.ProviderContinuation.IsZero() {
		t.Fatalf("continuation after paired clear=%+v, want zero", state.ProviderContinuation)
	}
	if state.CompactedContext.OperationID != "compact-pair-cleared-continuation" {
		t.Fatalf("compacted context after paired clear=%+v", state.CompactedContext)
	}
}

func TestStore_SetThreadProviderContinuationAndCompactedContextRejectsDeletedThread(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	if err := s.CreateThread(ctx, Thread{ThreadID: "th_deleted_compact", EndpointID: "env_deleted_compact"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := s.DeleteThreadResources(ctx, "env_deleted_compact", "th_deleted_compact"); err != nil {
		t.Fatalf("DeleteThreadResources: %v", err)
	}
	compacted := ThreadCompactedContext{
		OperationID:             "compact-deleted",
		RequestID:               "manual-deleted",
		Source:                  "slash_command",
		CompactionID:            "cmp-deleted",
		CompactionGeneration:    1,
		CompactionWindowID:      "window-deleted",
		CoveredThroughTurnRowID: 1,
		CoveredThroughMessageID: 1,
		Transcript: []ThreadCompactedMessage{{
			Role:    "user",
			Content: "summary",
			Kind:    "compaction_summary",
		}},
		CreatedAtUnixMs: 100,
		UpdatedAtUnixMs: 101,
	}
	if err := s.SetThreadProviderContinuationAndCompactedContext(ctx, "env_deleted_compact", "th_deleted_compact", ThreadProviderContinuation{}, compacted); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("SetThreadProviderContinuationAndCompactedContext err=%v, want %v", err, sql.ErrNoRows)
	}
	if rows := countRowsForTest(t, s.db, `SELECT COUNT(1) FROM ai_thread_state WHERE endpoint_id = ? AND thread_id = ?`, "env_deleted_compact", "th_deleted_compact"); rows != 0 {
		t.Fatalf("thread state rows=%d, want none after rejected commit", rows)
	}
}

func TestStore_SetThreadProviderContinuationAndCompactedContextRejectsChangedBoundary(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	if err := s.CreateThread(ctx, Thread{ThreadID: "th_boundary_compact", EndpointID: "env_boundary_compact"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	expected, err := s.CurrentThreadContextBoundary(ctx, "env_boundary_compact", "th_boundary_compact")
	if err != nil {
		t.Fatalf("CurrentThreadContextBoundary: %v", err)
	}
	start := startUserTurnRecordForTest("env_boundary_compact", "th_boundary_compact", "m_user_boundary", "run_boundary", "m_assistant_boundary")
	if _, err := s.StartUserTurn(ctx, start); err != nil {
		t.Fatalf("StartUserTurn: %v", err)
	}
	compacted := ThreadCompactedContext{
		OperationID:             "compact-boundary",
		RequestID:               "manual-boundary",
		Source:                  "slash_command",
		CompactionID:            "cmp-boundary",
		CompactionGeneration:    1,
		CompactionWindowID:      "window-boundary",
		CoveredThroughTurnRowID: expected.TurnRowID,
		CoveredThroughMessageID: expected.MessageID,
		Transcript: []ThreadCompactedMessage{{
			Role:    "user",
			Content: "summary",
			Kind:    "compaction_summary",
		}},
		CreatedAtUnixMs: 100,
		UpdatedAtUnixMs: 101,
	}
	if err := s.SetThreadProviderContinuationAndCompactedContextIfBoundaryMatches(ctx, "env_boundary_compact", "th_boundary_compact", expected, ThreadProviderContinuation{}, compacted); !errors.Is(err, ErrThreadContextBoundaryChanged) {
		t.Fatalf("SetThreadProviderContinuationAndCompactedContextIfBoundaryMatches err=%v, want %v", err, ErrThreadContextBoundaryChanged)
	}
	state, err := s.GetThreadState(ctx, "env_boundary_compact", "th_boundary_compact")
	if err != nil {
		t.Fatalf("GetThreadState: %v", err)
	}
	if state != nil {
		t.Fatalf("thread state=%+v, want no compacted state after rejected boundary", state)
	}
}

func countRowsForTest(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()

	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows query failed: %v", err)
	}
	return count
}

func tableExistsForTest(t *testing.T, db *sql.DB, tableName string) bool {
	t.Helper()

	return countRowsForTest(t, db, `
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'table' AND name = ?
`, tableName) == 1
}

func indexExistsForTest(t *testing.T, db *sql.DB, indexName string) bool {
	t.Helper()

	return countRowsForTest(t, db, `
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'index' AND name = ?
`, indexName) == 1
}

func storeThreadIDs(threads []Thread) []string {
	out := make([]string, 0, len(threads))
	for _, thread := range threads {
		out = append(out, thread.ThreadID)
	}
	return out
}

func tableHasColumnForTest(t *testing.T, db *sql.DB, tableName string, columnName string) bool {
	t.Helper()

	rows, err := db.Query(`PRAGMA table_info(` + tableName + `)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info(%s): %v", tableName, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var typ string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan table_info(%s): %v", tableName, err)
		}
		if strings.TrimSpace(name) == columnName {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("table_info(%s) rows: %v", tableName, err)
	}
	return false
}
