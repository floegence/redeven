package retriever

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
)

// RetrieveOptions controls multi-plane retrieval.
type RetrieveOptions struct {
	EndpointID string
	ThreadID   string
	Objective  string
	UserInput  string

	MaxTurns             int
	MaxExecutionEvidence int
	MaxMemoryItems       int
}

// RetrievalResult is the normalized retrieval output consumed by packer.
type RetrievalResult struct {
	RecentDialogue      []model.DialogueTurn
	ExecutionEvidence   []model.ExecutionEvidence
	ActiveConstraints   []string
	PendingTodos        []model.MemoryItem
	Blockers            []model.MemoryItem
	LongTermMemory      []model.MemoryItem
	ThreadSnapshot      string
	MemoryRecallHitRate float64
}

type Retriever struct {
	repo *contextstore.Repository
	now  func() time.Time
}

func New(repo *contextstore.Repository) *Retriever {
	return &Retriever{repo: repo, now: time.Now}
}

func (r *Retriever) Retrieve(ctx context.Context, opts RetrieveOptions) (RetrievalResult, error) {
	result := RetrievalResult{}
	if r == nil || r.repo == nil || !r.repo.Ready() {
		return result, nil
	}

	maxTurns := opts.MaxTurns
	if maxTurns <= 0 {
		maxTurns = 10
	}
	maxExec := opts.MaxExecutionEvidence
	if maxExec <= 0 {
		maxExec = 20
	}
	maxMem := opts.MaxMemoryItems
	if maxMem <= 0 {
		maxMem = 40
	}

	turns, err := r.repo.ListRecentDialogueTurns(ctx, opts.EndpointID, opts.ThreadID, maxTurns)
	if err != nil {
		return result, err
	}
	execEvidence, err := r.repo.ListRecentExecutionEvidence(ctx, opts.EndpointID, opts.ThreadID, maxExec)
	if err != nil {
		return result, err
	}
	blockers, err := r.repo.ListThreadBlockers(ctx, opts.EndpointID, opts.ThreadID, 12)
	if err != nil {
		return result, err
	}
	memoryItems, err := r.repo.ListRecentMemoryItems(ctx, opts.EndpointID, opts.ThreadID, maxMem)
	if err != nil {
		return result, err
	}
	threadSnapshot, err := r.repo.LatestSnapshot(ctx, opts.EndpointID, opts.ThreadID, "thread")
	if err != nil {
		return result, err
	}

	query := strings.TrimSpace(strings.Join([]string{opts.Objective, opts.UserInput}, " "))
	scored := scoreMemory(memoryItems, query, r.now().UnixMilli())

	constraints := make([]string, 0, 8)
	pending := make([]model.MemoryItem, 0, 8)
	longTerm := make([]model.MemoryItem, 0, 12)
	recallHit := 0
	for _, item := range scored {
		if item.memory.Content == "" {
			continue
		}
		if item.memory.Kind == model.MemoryKindBlocker {
			// Blockers are retrieved separately from thread working memory to avoid polluting pending_todos.
			continue
		}
		if item.score >= 0.45 {
			recallHit++
		}
		switch item.memory.Kind {
		case model.MemoryKindConstraint:
			constraints = append(constraints, item.memory.Content)
		case model.MemoryKindTodo:
			pending = append(pending, item.memory)
		}
		if item.memory.Scope == model.MemoryScopeLongTerm && len(longTerm) < 12 {
			longTerm = append(longTerm, item.memory)
		}
	}
	if len(constraints) > 8 {
		constraints = constraints[:8]
	}
	if len(pending) > 8 {
		pending = pending[:8]
	}

	recallRate := 0.0
	if len(scored) > 0 {
		recallRate = float64(recallHit) / float64(len(scored))
	}

	result.RecentDialogue = turns
	result.ExecutionEvidence = execEvidence
	result.ActiveConstraints = dedupeStrings(constraints)
	result.PendingTodos = pending
	result.Blockers = blockers
	result.LongTermMemory = longTerm
	result.ThreadSnapshot = strings.TrimSpace(threadSnapshot)
	result.MemoryRecallHitRate = recallRate
	return result, nil
}

type scoredMemory struct {
	memory model.MemoryItem
	score  float64
}

func scoreMemory(items []model.MemoryItem, query string, nowUnixMs int64) []scoredMemory {
	if len(items) == 0 {
		return nil
	}
	queryTokens := tokenize(query)
	kindSeen := map[model.MemoryKind]int{}
	out := make([]scoredMemory, 0, len(items))
	for _, item := range items {
		relevance := overlapScore(queryTokens, tokenize(item.Content))
		recency := recencyScore(nowUnixMs, item.UpdatedAtUnix)
		importance := clamp01(item.Importance, 0.5)
		confidence := clamp01(item.Confidence, 0.6)
		kindSeen[item.Kind]++
		divPenalty := 0.0
		if kindSeen[item.Kind] > 1 {
			divPenalty = math.Min(0.4, float64(kindSeen[item.Kind]-1)*0.08)
		}
		score := 0.35*relevance + 0.25*recency + 0.20*importance + 0.10*confidence + 0.10*(1.0-divPenalty)
		out = append(out, scoredMemory{memory: item, score: score})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].score == out[j].score {
			return out[i].memory.UpdatedAtUnix > out[j].memory.UpdatedAtUnix
		}
		return out[i].score > out[j].score
	})
	return out
}

func overlapScore(a []string, b []string) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	set := map[string]struct{}{}
	for _, token := range a {
		set[token] = struct{}{}
	}
	hit := 0
	for _, token := range b {
		if _, ok := set[token]; ok {
			hit++
		}
	}
	if hit == 0 {
		return 0
	}
	den := len(a)
	if len(b) > den {
		den = len(b)
	}
	return float64(hit) / float64(den)
}

func recencyScore(nowUnixMs int64, updatedUnixMs int64) float64 {
	if nowUnixMs <= 0 || updatedUnixMs <= 0 {
		return 0.4
	}
	delta := nowUnixMs - updatedUnixMs
	if delta <= 0 {
		return 1
	}
	minutes := float64(delta) / float64(time.Minute.Milliseconds())
	score := math.Exp(-minutes / 240)
	if score < 0.1 {
		return 0.1
	}
	return score
}

func tokenize(input string) []string {
	input = strings.ToLower(strings.TrimSpace(input))
	if input == "" {
		return nil
	}
	r := strings.NewReplacer(",", " ", ".", " ", ":", " ", ";", " ", "\n", " ", "\t", " ", "(", " ", ")", " ", "[", " ", "]", " ", "{", " ", "}", " ", "\"", " ", "'", " ")
	input = r.Replace(input)
	parts := strings.Fields(input)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if len(p) < 2 {
			continue
		}
		out = append(out, p)
	}
	return out
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func clamp01(v float64, fallback float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	if v == 0 {
		return fallback
	}
	return v
}
