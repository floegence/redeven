package compactor

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/ai/context/verifier"
)

// SnapshotCompactor performs semantic compression and quality verification.
type SnapshotCompactor struct {
	repo *contextstore.Repository
	now  func() time.Time
}

func New(repo *contextstore.Repository) *SnapshotCompactor {
	return &SnapshotCompactor{repo: repo, now: time.Now}
}

func (c *SnapshotCompactor) CompactPromptPack(ctx context.Context, endpointID string, targetInputTokens int, in model.PromptPack) (model.PromptPack, bool, verifier.VerifyResult, error) {
	before := clonePromptPack(in)
	if targetInputTokens <= 0 {
		targetInputTokens = 12000
	}
	if estimatePromptTokens(before) <= targetInputTokens {
		verify := verifier.Verify(verifier.VerifyInput{Before: before, After: before, RequiredSavingRatio: 0})
		verify.Pass = true
		return before, false, verify, nil
	}

	working := clonePromptPack(before)

	// L1: compact verbose execution evidence while preserving span references.
	for i := range working.ExecutionEvidence {
		s := strings.TrimSpace(working.ExecutionEvidence[i].Summary)
		if len([]rune(s)) > 220 {
			working.ExecutionEvidence[i].Summary = string([]rune(s)[:220]) + " ... [compressed]"
		}
		if len([]rune(working.ExecutionEvidence[i].PayloadJSON)) > 400 {
			working.ExecutionEvidence[i].PayloadJSON = string([]rune(working.ExecutionEvidence[i].PayloadJSON)[:400]) + " ..."
		}
	}

	// L2: fold old dialogue turns into a snapshot sentence.
	if estimatePromptTokens(working) > targetInputTokens && len(working.RecentDialogue) > 4 {
		cutoff := len(working.RecentDialogue) - 4
		archived := working.RecentDialogue[:cutoff]
		kept := working.RecentDialogue[cutoff:]
		summary := summarizeTurns(archived)
		if summary != "" {
			if strings.TrimSpace(working.ThreadSnapshot) != "" {
				working.ThreadSnapshot = strings.TrimSpace(working.ThreadSnapshot + "\n" + summary)
			} else {
				working.ThreadSnapshot = summary
			}
			working.RecentDialogue = kept
			_ = c.persistSnapshot(ctx, endpointID, strings.TrimSpace(in.ThreadID), "episode", summary, 0, 0, 0.72)
		}
	}

	// L3: aggressive pruning for low-priority memory/evidence.
	if estimatePromptTokens(working) > targetInputTokens {
		if len(working.ExecutionEvidence) > 8 {
			working.ExecutionEvidence = append([]model.ExecutionEvidence(nil), working.ExecutionEvidence[len(working.ExecutionEvidence)-8:]...)
		}
		if len(working.RetrievedLongTermMemory) > 8 {
			working.RetrievedLongTermMemory = append([]model.MemoryItem(nil), working.RetrievedLongTermMemory[:8]...)
		}
		if len(working.PendingTodos) > 6 {
			working.PendingTodos = append([]model.MemoryItem(nil), working.PendingTodos[:6]...)
		}
		if len(working.Blockers) > 6 {
			working.Blockers = append([]model.MemoryItem(nil), working.Blockers[:6]...)
		}
	}

	verify := verifier.Verify(verifier.VerifyInput{
		Before:              before,
		After:               working,
		RequiredSavingRatio: 0.2,
	})
	if !verify.Pass {
		return before, false, verify, nil
	}

	working.CompressionSavingRatio = verify.SavingRatio
	working.CompressionQualityPass = true
	working.EstimatedInputTokens = estimatePromptTokens(working)
	if strings.TrimSpace(working.ThreadSnapshot) != "" {
		_ = c.persistSnapshot(ctx, endpointID, strings.TrimSpace(in.ThreadID), "thread", working.ThreadSnapshot, 0, 0, 0.78)
	}
	return working, true, verify, nil
}

func (c *SnapshotCompactor) CompactThread(ctx context.Context, endpointID string, threadID string, turns []model.DialogueTurn, level string) (string, error) {
	if len(turns) == 0 {
		return "", nil
	}
	summary := summarizeTurns(turns)
	if strings.TrimSpace(summary) == "" {
		return "", nil
	}
	if err := c.persistSnapshot(ctx, endpointID, threadID, level, summary, 0, 0, 0.74); err != nil {
		return "", err
	}
	return summary, nil
}

func (c *SnapshotCompactor) persistSnapshot(ctx context.Context, endpointID string, threadID string, level string, summary string, fromID int64, toID int64, quality float64) error {
	if c == nil || c.repo == nil || !c.repo.Ready() {
		return nil
	}
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return nil
	}
	nowUnix := c.now().UnixMilli()
	h := sha1.Sum([]byte(fmt.Sprintf("%s|%s|%s|%d|%s", endpointID, threadID, level, nowUnix, summary))) // #nosec G401
	snapshotID := "snap_" + hex.EncodeToString(h[:])
	return c.repo.InsertSnapshot(ctx, endpointID, threadID, level, snapshotID, summary, fromID, toID, quality, nowUnix)
}

func summarizeTurns(turns []model.DialogueTurn) string {
	if len(turns) == 0 {
		return ""
	}
	lines := make([]string, 0, len(turns)*2)
	for _, turn := range turns {
		user := strings.TrimSpace(turn.UserText)
		assistant := strings.TrimSpace(turn.AssistantText)
		if user != "" {
			if len([]rune(user)) > 100 {
				user = string([]rune(user)[:100]) + " ..."
			}
			lines = append(lines, "- User: "+user)
		}
		if assistant != "" {
			if len([]rune(assistant)) > 120 {
				assistant = string([]rune(assistant)[:120]) + " ..."
			}
			lines = append(lines, "- Assistant: "+assistant)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > 12 {
		lines = lines[len(lines)-12:]
	}
	return "Episode snapshot:\n" + strings.Join(lines, "\n")
}

func estimatePromptTokens(pack model.PromptPack) int {
	text := pack.ApproxText()
	if strings.TrimSpace(text) == "" {
		return 0
	}
	chars := len([]rune(text))
	tokens := chars/4 + 32
	if tokens < 0 {
		return 0
	}
	return tokens
}

func clonePromptPack(in model.PromptPack) model.PromptPack {
	out := in
	out.ActiveConstraints = append([]string(nil), in.ActiveConstraints...)
	out.RecentDialogue = append([]model.DialogueTurn(nil), in.RecentDialogue...)
	out.ExecutionEvidence = append([]model.ExecutionEvidence(nil), in.ExecutionEvidence...)
	out.PendingTodos = append([]model.MemoryItem(nil), in.PendingTodos...)
	out.Blockers = append([]model.MemoryItem(nil), in.Blockers...)
	out.RetrievedLongTermMemory = append([]model.MemoryItem(nil), in.RetrievedLongTermMemory...)
	out.AttachmentsManifest = append([]model.AttachmentManifest(nil), in.AttachmentsManifest...)
	if in.ContextSectionsTokenUsage != nil {
		out.ContextSectionsTokenUsage = make(map[string]int, len(in.ContextSectionsTokenUsage))
		for k, v := range in.ContextSectionsTokenUsage {
			out.ContextSectionsTokenUsage[k] = v
		}
	}
	return out
}
