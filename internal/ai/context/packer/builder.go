package packer

import (
	"context"
	"fmt"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/context/adapter"
	"github.com/floegence/redeven-agent/internal/ai/context/compactor"
	"github.com/floegence/redeven-agent/internal/ai/context/model"
	"github.com/floegence/redeven-agent/internal/ai/context/retriever"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
)

// BuildInput captures all runtime dimensions for prompt pack assembly.
type BuildInput struct {
	EndpointID string
	ThreadID   string
	RunID      string

	Objective string
	UserInput string

	Attachments []model.AttachmentManifest
	Capability  model.ModelCapability

	MaxInputTokens int
}

// Builder assembles a budgeted prompt pack from multi-plane context.
type Builder struct {
	repo      *contextstore.Repository
	retriever *retriever.Retriever
	compactor *compactor.SnapshotCompactor
}

func New(repo *contextstore.Repository, rt *retriever.Retriever, cp *compactor.SnapshotCompactor) *Builder {
	return &Builder{repo: repo, retriever: rt, compactor: cp}
}

func (b *Builder) BuildPromptPack(ctx context.Context, in BuildInput) (model.PromptPack, error) {
	pack := model.PromptPack{
		ThreadID:                  strings.TrimSpace(in.ThreadID),
		RunID:                     strings.TrimSpace(in.RunID),
		ContextSectionsTokenUsage: map[string]int{},
	}
	if b == nil || b.retriever == nil {
		return pack, nil
	}

	cap := model.NormalizeCapability(in.Capability)
	totalBudget := in.MaxInputTokens
	if totalBudget <= 0 {
		totalBudget = cap.MaxContextTokens
	}
	if totalBudget <= 0 {
		totalBudget = 128000
	}
	if totalBudget > cap.MaxContextTokens {
		totalBudget = cap.MaxContextTokens
	}

	retrieved, err := b.retriever.Retrieve(ctx, retriever.RetrieveOptions{
		EndpointID:           strings.TrimSpace(in.EndpointID),
		ThreadID:             strings.TrimSpace(in.ThreadID),
		Objective:            strings.TrimSpace(in.Objective),
		UserInput:            strings.TrimSpace(in.UserInput),
		MaxTurns:             16,
		MaxExecutionEvidence: 30,
		MaxMemoryItems:       80,
	})
	if err != nil {
		return pack, err
	}

	objective := strings.TrimSpace(in.Objective)
	if objective == "" && b.repo != nil && b.repo.Ready() {
		if goal, err := b.repo.GetOpenGoal(ctx, in.EndpointID, in.ThreadID); err == nil {
			objective = strings.TrimSpace(goal)
		}
	}
	if objective == "" {
		objective = strings.TrimSpace(in.UserInput)
	}

	systemContract := strings.Join([]string{
		"Context contract:",
		"- The transcript is for display only; rely on structured memory and execution evidence.",
		"- Preserve hard constraints and unresolved todos.",
		"- Cite concrete execution evidence before claiming completion.",
	}, "\n")

	pack.SystemContract = systemContract
	pack.Objective = objective
	pack.ActiveConstraints = append([]string(nil), retrieved.ActiveConstraints...)
	pack.RecentDialogue = append([]model.DialogueTurn(nil), retrieved.RecentDialogue...)
	pack.ExecutionEvidence = append([]model.ExecutionEvidence(nil), retrieved.ExecutionEvidence...)
	pack.PendingTodos = append([]model.MemoryItem(nil), retrieved.PendingTodos...)
	pack.RetrievedLongTermMemory = append([]model.MemoryItem(nil), retrieved.LongTermMemory...)
	pack.ThreadSnapshot = strings.TrimSpace(retrieved.ThreadSnapshot)
	pack.AttachmentsManifest = adapter.AdaptAttachments(cap, in.Attachments)

	sectionBudget := splitSectionBudget(totalBudget)
	pack = enforceSectionBudget(pack, sectionBudget)
	pack.EstimatedInputTokens = estimatePackTokens(pack)
	pack.ContextSectionsTokenUsage = collectSectionTokens(pack)

	if pack.EstimatedInputTokens > totalBudget && b.compactor != nil {
		compressed, changed, verify, err := b.compactor.CompactPromptPack(ctx, in.EndpointID, totalBudget, pack)
		if err != nil {
			return model.PromptPack{}, err
		}
		if changed {
			compressed.ContextSectionsTokenUsage = collectSectionTokens(compressed)
			compressed.EstimatedInputTokens = estimatePackTokens(compressed)
			compressed.CompressionSavingRatio = verify.SavingRatio
			compressed.CompressionQualityPass = verify.Pass
			pack = compressed
		} else {
			pack.CompressionSavingRatio = verify.SavingRatio
			pack.CompressionQualityPass = verify.Pass
		}
	}

	return pack, nil
}

func splitSectionBudget(total int) map[string]int {
	if total <= 0 {
		total = 128000
	}
	sections := map[string]float64{
		"system":    0.15,
		"objective": 0.20,
		"dialogue":  0.30,
		"execution": 0.25,
		"long_term": 0.10,
	}
	out := make(map[string]int, len(sections))
	for key, ratio := range sections {
		out[key] = int(float64(total) * ratio)
	}
	return out
}

func enforceSectionBudget(pack model.PromptPack, budget map[string]int) model.PromptPack {
	out := pack
	out.SystemContract = truncateToTokens(out.SystemContract, budget["system"])
	out.Objective = truncateToTokens(out.Objective, budget["objective"])
	out.ThreadSnapshot = truncateToTokens(out.ThreadSnapshot, budget["objective"]/2)

	dialogueBudget := budget["dialogue"]
	dialogue := make([]model.DialogueTurn, 0, len(out.RecentDialogue))
	for i := len(out.RecentDialogue) - 1; i >= 0; i-- {
		turn := out.RecentDialogue[i]
		turnTokens := textTokens(turn.UserText) + textTokens(turn.AssistantText)
		if dialogueBudget-turnTokens < 0 {
			continue
		}
		dialogueBudget -= turnTokens
		dialogue = append(dialogue, turn)
	}
	for i, j := 0, len(dialogue)-1; i < j; i, j = i+1, j-1 {
		dialogue[i], dialogue[j] = dialogue[j], dialogue[i]
	}
	out.RecentDialogue = dialogue

	execBudget := budget["execution"]
	execOut := make([]model.ExecutionEvidence, 0, len(out.ExecutionEvidence))
	for _, ev := range out.ExecutionEvidence {
		cost := textTokens(ev.Summary) + textTokens(ev.PayloadJSON)
		if execBudget-cost < 0 {
			continue
		}
		execBudget -= cost
		execOut = append(execOut, ev)
	}
	out.ExecutionEvidence = execOut

	longBudget := budget["long_term"]
	longOut := make([]model.MemoryItem, 0, len(out.RetrievedLongTermMemory))
	for _, mem := range out.RetrievedLongTermMemory {
		cost := textTokens(mem.Content)
		if longBudget-cost < 0 {
			continue
		}
		longBudget -= cost
		longOut = append(longOut, mem)
	}
	out.RetrievedLongTermMemory = longOut

	return out
}

func collectSectionTokens(pack model.PromptPack) map[string]int {
	usage := map[string]int{}
	usage["system"] = textTokens(pack.SystemContract)
	usage["objective"] = textTokens(pack.Objective) + textTokens(pack.ThreadSnapshot)
	dialogue := 0
	for _, turn := range pack.RecentDialogue {
		dialogue += textTokens(turn.UserText)
		dialogue += textTokens(turn.AssistantText)
	}
	usage["dialogue"] = dialogue
	execTokens := 0
	for _, ev := range pack.ExecutionEvidence {
		execTokens += textTokens(ev.Summary)
		execTokens += textTokens(ev.PayloadJSON)
	}
	usage["execution"] = execTokens
	memoryTokens := 0
	for _, mem := range pack.PendingTodos {
		memoryTokens += textTokens(mem.Content)
	}
	for _, mem := range pack.RetrievedLongTermMemory {
		memoryTokens += textTokens(mem.Content)
	}
	usage["long_term"] = memoryTokens
	return usage
}

func estimatePackTokens(pack model.PromptPack) int {
	usage := collectSectionTokens(pack)
	total := 0
	for _, v := range usage {
		total += v
	}
	return total
}

func truncateToTokens(text string, maxTokens int) string {
	text = strings.TrimSpace(text)
	if text == "" || maxTokens <= 0 {
		return ""
	}
	runes := []rune(text)
	maxRunes := maxTokens * 4
	if len(runes) <= maxRunes {
		return text
	}
	return string(runes[:maxRunes]) + " ..."
}

func textTokens(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	return len([]rune(text))/4 + 1
}

func (b *Builder) DebugSummary(pack model.PromptPack) string {
	usage := collectSectionTokens(pack)
	return fmt.Sprintf("tokens(system=%d objective=%d dialogue=%d execution=%d long_term=%d total=%d)",
		usage["system"], usage["objective"], usage["dialogue"], usage["execution"], usage["long_term"], estimatePackTokens(pack))
}
