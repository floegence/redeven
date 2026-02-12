package extractor

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
)

// ExtractInput is the run-level extraction request.
type ExtractInput struct {
	EndpointID         string
	ThreadID           string
	RunID              string
	Objective          string
	AssistantText      string
	FinalizationReason string
}

type MemoryExtractor struct {
	repo *contextstore.Repository
	now  func() time.Time
}

func New(repo *contextstore.Repository) *MemoryExtractor {
	return &MemoryExtractor{repo: repo, now: time.Now}
}

func (e *MemoryExtractor) Extract(ctx context.Context, in ExtractInput) ([]model.MemoryItem, error) {
	if e == nil || e.repo == nil || !e.repo.Ready() {
		return nil, nil
	}
	in.EndpointID = strings.TrimSpace(in.EndpointID)
	in.ThreadID = strings.TrimSpace(in.ThreadID)
	in.RunID = strings.TrimSpace(in.RunID)
	if in.EndpointID == "" || in.ThreadID == "" || in.RunID == "" {
		return nil, nil
	}

	evidence, err := e.repo.ListRunExecutionEvidence(ctx, in.EndpointID, in.RunID, 500)
	if err != nil {
		return nil, err
	}

	items := make([]model.MemoryItem, 0, len(evidence)+2)
	nowUnix := e.now().UnixMilli()

	for _, ev := range evidence {
		status := strings.ToLower(strings.TrimSpace(ev.Status))
		var kind model.MemoryKind
		var scope model.MemoryScope
		var importance float64
		freshness := 0.9
		var confidence float64
		content := strings.TrimSpace(ev.Summary)
		if content == "" {
			content = strings.TrimSpace(ev.Name)
		}
		if content == "" {
			content = strings.TrimSpace(ev.Kind)
		}
		switch status {
		case "failed", "timed_out", "canceled":
			kind = model.MemoryKindTodo
			scope = model.MemoryScopeWorking
			importance = 0.85
			confidence = 0.9
			content = "Action blocked: " + content
		case "success":
			kind = model.MemoryKindFact
			scope = model.MemoryScopeEpisodic
			importance = 0.7
			confidence = 0.85
			content = "Evidence: " + content
		default:
			kind = model.MemoryKindArtifact
			scope = model.MemoryScopeEpisodic
			importance = 0.5
			confidence = 0.6
		}
		src, _ := json.Marshal([]map[string]any{{
			"run_id":  in.RunID,
			"span_id": ev.SpanID,
			"kind":    ev.Kind,
			"name":    ev.Name,
			"status":  ev.Status,
		}})
		items = append(items, model.MemoryItem{
			MemoryID:       buildMemoryID(in.ThreadID, in.RunID, ev.SpanID, string(kind)),
			ThreadID:       in.ThreadID,
			Scope:          scope,
			Kind:           kind,
			Content:        strings.TrimSpace(content),
			SourceRefsJSON: string(src),
			Importance:     importance,
			Freshness:      freshness,
			Confidence:     confidence,
			CreatedAtUnix:  nowUnix,
			UpdatedAtUnix:  nowUnix,
		})
	}

	assistantText := strings.TrimSpace(in.AssistantText)
	if assistantText != "" {
		summary := assistantText
		if len([]rune(summary)) > 500 {
			summary = string([]rune(summary)[:500])
		}
		scope := model.MemoryScopeEpisodic
		kind := model.MemoryKindArtifact
		importance := 0.65
		if strings.Contains(strings.ToLower(strings.TrimSpace(in.FinalizationReason)), "task_complete") {
			scope = model.MemoryScopeLongTerm
			kind = model.MemoryKindDecision
			importance = 0.9
		}
		src, _ := json.Marshal([]map[string]any{{
			"run_id": in.RunID,
			"type":   "assistant_summary",
		}})
		items = append(items, model.MemoryItem{
			MemoryID:       buildMemoryID(in.ThreadID, in.RunID, "assistant_summary", string(kind)),
			ThreadID:       in.ThreadID,
			Scope:          scope,
			Kind:           kind,
			Content:        summary,
			SourceRefsJSON: string(src),
			Importance:     importance,
			Freshness:      0.8,
			Confidence:     0.75,
			CreatedAtUnix:  nowUnix,
			UpdatedAtUnix:  nowUnix,
		})
	}

	if objective := strings.TrimSpace(in.Objective); objective != "" {
		src, _ := json.Marshal([]map[string]any{{
			"run_id": in.RunID,
			"type":   "objective",
		}})
		items = append(items, model.MemoryItem{
			MemoryID:       buildMemoryID(in.ThreadID, "objective", objective, "constraint"),
			ThreadID:       in.ThreadID,
			Scope:          model.MemoryScopeWorking,
			Kind:           model.MemoryKindConstraint,
			Content:        objective,
			SourceRefsJSON: string(src),
			Importance:     0.95,
			Freshness:      1,
			Confidence:     0.95,
			CreatedAtUnix:  nowUnix,
			UpdatedAtUnix:  nowUnix,
		})
	}

	if err := e.repo.UpsertMemoryItems(ctx, in.EndpointID, in.ThreadID, items); err != nil {
		return nil, err
	}
	return items, nil
}

func buildMemoryID(parts ...string) string {
	h := sha1.New() // #nosec G401 -- deterministic id generation, not security sensitive.
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte("|"))
	}
	return "mem_" + hex.EncodeToString(h.Sum(nil))
}
