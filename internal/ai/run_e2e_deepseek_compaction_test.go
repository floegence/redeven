package ai

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

const deepSeekCompactionEETurnTimeout = 8 * time.Minute

func assertOfficialDeepSeekCompactionEndpoint(t *testing.T, raw string) {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "api.deepseek.com") {
		t.Fatalf("real compaction qualification requires https://api.deepseek.com, received %q", raw)
	}
}

func createDeepSeekCompactionThread(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, modelID string, title string) string {
	t.Helper()
	thread, err := svc.CreateThread(ctx, meta, title, modelID, config.AIPermissionFullAccess, "")
	if err != nil {
		t.Fatalf("create compaction thread: %v", err)
	}
	if thread == nil || strings.TrimSpace(thread.ThreadID) == "" {
		t.Fatal("create compaction thread returned no identity")
	}
	return thread.ThreadID
}

func sendDeepSeekCompactionTurn(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, requestID string, threadID string, modelID string, text string) *FlowerThreadDetail {
	t.Helper()
	response, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ClientRequestID: requestID, ThreadID: threadID, Model: modelID,
		Input: RunInput{Text: text},
		Options: RunOptions{
			ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
			NoUserInteraction:  true,
		},
	})
	if err != nil {
		t.Fatalf("send compaction turn %s: %v", requestID, err)
	}
	if response.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("send compaction turn %s activity=%q, want active", requestID, response.Current.Activity)
	}
	turnID := response.Current.TurnID
	deadline := time.NewTimer(deepSeekCompactionEETurnTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		detail, detailErr := svc.GetFlowerThreadDetail(ctx, meta, threadID)
		if detailErr != nil {
			t.Fatalf("read compaction turn %s: %v", requestID, detailErr)
		}
		if detail != nil && detail.Current.TurnID == turnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				failureCode, failureHash, failureClasses := safeDeepSeekFailureFingerprint(detail.Current.Failure)
				t.Fatalf("compaction turn %s outcome=%q error_code=%q canonical_code=%q canonical_hash=%s classes=%v",
					requestID, *detail.Current.LastOutcome, detail.Thread.RunErrorCode, failureCode, failureHash, failureClasses)
			}
			return detail
		}
		select {
		case <-ctx.Done():
			t.Fatalf("wait for compaction turn %s: %v", requestID, ctx.Err())
		case <-deadline.C:
			t.Fatalf("compaction turn %s exceeded %s", requestID, deepSeekCompactionEETurnTimeout)
		case <-ticker.C:
		}
	}
}

func safeDeepSeekFailureFingerprint(failure *flruntime.ThreadTurnFailure) (string, string, []string) {
	if failure == nil {
		return "", "", nil
	}
	message := strings.ToLower(strings.TrimSpace(failure.Message))
	classes := make([]string, 0, 4)
	for _, class := range []string{"prefix", "progress", "control", "incomplete", "continuation", "tool", "provider", "usage", "context", "checkpoint", "segment", "model", "schema"} {
		if strings.Contains(message, class) {
			classes = append(classes, class)
		}
	}
	return string(failure.Code), sha256Hex([]byte(message)), classes
}

func requireDeepSeekCompaction(t *testing.T, detail *FlowerThreadDetail, match func(FlowerContextCompaction) bool) FlowerContextCompaction {
	t.Helper()
	if detail == nil {
		t.Fatal("compaction detail is nil")
	}
	for _, item := range detail.Thread.ContextCompactions {
		if match(item) {
			if item.Status != "compacted" || item.Phase != "complete" {
				t.Fatalf("compaction=%#v, want compacted/complete", item)
			}
			return item
		}
	}
	t.Fatalf("canonical context did not contain the expected compaction: %#v", detail.Thread.ContextCompactions)
	return FlowerContextCompaction{}
}

func assertDeepSeekCompactionSavings(t *testing.T, compaction FlowerContextCompaction) {
	t.Helper()
	if compaction.TokensBefore <= 0 || compaction.TokensAfterEstimate <= 0 || compaction.TokensAfterEstimate >= compaction.TokensBefore {
		t.Fatalf("compaction token change=%d -> %d, want positive savings", compaction.TokensBefore, compaction.TokensAfterEstimate)
	}
}
