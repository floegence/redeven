package extractor

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
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

	type toolSpanPayload struct {
		ToolName string `json:"tool_name"`
		Error    *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	parseToolPayload := func(raw string) (toolName string, errCode string, errMsg string, ok bool) {
		raw = strings.TrimSpace(raw)
		if raw == "" || !json.Valid([]byte(raw)) {
			return "", "", "", false
		}
		var p toolSpanPayload
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			return "", "", "", false
		}
		toolName = strings.TrimSpace(p.ToolName)
		if p.Error != nil {
			errCode = strings.TrimSpace(p.Error.Code)
			errMsg = strings.TrimSpace(p.Error.Message)
		}
		ok = toolName != "" || errCode != "" || errMsg != ""
		return toolName, errCode, errMsg, ok
	}
	truncateRunes := func(s string, max int) string {
		s = strings.TrimSpace(s)
		if s == "" || max <= 0 {
			return ""
		}
		r := []rune(s)
		if len(r) <= max {
			return s
		}
		return string(r[:max])
	}

	blockerIDsToClear := make(map[string]struct{}, 8)

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

		toolNameFromPayload := ""
		errCode := ""
		errMsg := ""
		if strings.EqualFold(strings.TrimSpace(ev.Kind), "tool") {
			if toolName, code, msg, ok := parseToolPayload(ev.PayloadJSON); ok {
				toolNameFromPayload = toolName
				errCode = code
				errMsg = msg
			}
		}

		blockerKey := ""
		if strings.EqualFold(strings.TrimSpace(ev.Kind), "tool") {
			toolName := strings.TrimSpace(toolNameFromPayload)
			if toolName == "" {
				toolName = strings.TrimSpace(ev.Name)
			}
			if toolName != "" {
				blockerKey = "tool:" + strings.ToLower(toolName)
			}
		}
		if blockerKey == "" {
			if k := strings.TrimSpace(ev.Kind); k != "" {
				blockerKey = strings.ToLower(k) + ":" + strings.ToLower(strings.TrimSpace(ev.Name))
			}
		}
		blockerID := ""
		if blockerKey != "" {
			blockerID = buildMemoryID(in.ThreadID, "blocker", blockerKey)
		}

		switch status {
		case "failed", "timed_out", "canceled":
			kind = model.MemoryKindBlocker
			scope = model.MemoryScopeWorking
			importance = 0.92
			confidence = 0.92
			if blockerKey != "" && strings.HasPrefix(blockerKey, "tool:") {
				toolLabel := strings.TrimPrefix(blockerKey, "tool:")
				toolLabel = strings.TrimSpace(toolLabel)
				content = "Tool blocked: " + toolLabel
				if errCode != "" || errMsg != "" {
					msg := truncateRunes(errMsg, 220)
					if errCode != "" && msg != "" {
						content = fmt.Sprintf("%s (%s): %s", content, errCode, msg)
					} else if errCode != "" {
						content = fmt.Sprintf("%s (%s)", content, errCode)
					} else if msg != "" {
						content = fmt.Sprintf("%s: %s", content, msg)
					}
				}
			} else {
				content = "Blocked: " + content
			}
		case "success":
			kind = model.MemoryKindFact
			scope = model.MemoryScopeEpisodic
			importance = 0.7
			confidence = 0.85
			content = "Evidence: " + content
			if blockerID != "" && strings.HasPrefix(blockerKey, "tool:") {
				blockerIDsToClear[blockerID] = struct{}{}
			}
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
		memoryID := buildMemoryID(in.ThreadID, in.RunID, ev.SpanID, string(kind))
		if kind == model.MemoryKindBlocker && blockerID != "" {
			memoryID = blockerID
		}
		items = append(items, model.MemoryItem{
			MemoryID:       memoryID,
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

	// If a tool eventually succeeded in the same run, do not persist the intermediate failure
	// as an active blocker.
	if len(blockerIDsToClear) > 0 {
		filtered := items[:0]
		for _, item := range items {
			if _, ok := blockerIDsToClear[strings.TrimSpace(item.MemoryID)]; ok {
				continue
			}
			filtered = append(filtered, item)
		}
		items = filtered
	}

	for id := range blockerIDsToClear {
		_ = e.repo.DeleteThreadMemoryItem(ctx, in.EndpointID, in.ThreadID, id)
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
