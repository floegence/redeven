package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

type floretProjectedCompactionSummarizer struct {
	gateway  flruntime.ModelGateway
	provider string
	model    string
	labels   flruntime.RunLabels
}

func (s floretProjectedCompactionSummarizer) GenerateCompactionSummary(ctx context.Context, req flruntime.ProjectedCompactionSummaryRequest) (flruntime.ProjectedCompactionSummaryResult, error) {
	if s.gateway == nil {
		return flruntime.ProjectedCompactionSummaryResult{}, errors.New("projected compaction summarizer requires a model gateway")
	}
	prompt := floretCompactionSummaryPrompt(req)
	if strings.TrimSpace(prompt) == "" {
		return flruntime.ProjectedCompactionSummaryResult{}, errors.New("projected compaction summary prompt is empty")
	}
	stream, err := s.gateway.StreamModel(ctx, flruntime.ModelRequest{
		RunID:           req.RunID,
		ThreadID:        req.ThreadID,
		TurnID:          req.TurnID,
		TraceID:         req.TraceID,
		PromptScopeID:   req.PromptScopeID,
		Step:            req.Step,
		Provider:        s.provider,
		Model:           s.model,
		Messages:        floretCompactionSummaryMessages(prompt),
		MaxOutputTokens: floretCompactionSummaryOutputTokens(req),
		Labels:          s.labels,
	})
	if err != nil {
		return flruntime.ProjectedCompactionSummaryResult{}, err
	}
	var summary strings.Builder
	for ev := range stream {
		switch ev.Type {
		case flruntime.ModelEventDelta:
			summary.WriteString(ev.Text)
		case flruntime.ModelEventError:
			if ev.Err != nil {
				return flruntime.ProjectedCompactionSummaryResult{}, ev.Err
			}
			return flruntime.ProjectedCompactionSummaryResult{}, errors.New(strings.TrimSpace(firstNonEmptyString(ev.Reason, "compaction summary model error")))
		}
		if ev.Err != nil {
			return flruntime.ProjectedCompactionSummaryResult{}, ev.Err
		}
	}
	text := strings.TrimSpace(summary.String())
	if text == "" {
		return flruntime.ProjectedCompactionSummaryResult{}, errors.New("projected compaction summary is empty")
	}
	return flruntime.ProjectedCompactionSummaryResult{
		Summary: text,
		Details: map[string]string{
			"summary_provider": strings.TrimSpace(s.provider),
			"summary_model":    strings.TrimSpace(s.model),
		},
	}, nil
}

func floretCompactionSummaryMessages(prompt string) []flruntime.ModelMessage {
	return []flruntime.ModelMessage{
		{
			Role: "system",
			Content: strings.TrimSpace(`You are Redeven's context compaction writer. Summarize the compacted conversation so the next assistant turn can continue accurately.

Preserve user constraints, decisions, file paths, command results, tool outcomes, errors, and unresolved tasks. Do not include decorative prose.`),
		},
		{
			Role:    "user",
			Content: prompt,
		},
	}
}

func floretCompactionSummaryPrompt(req flruntime.ProjectedCompactionSummaryRequest) string {
	var b strings.Builder
	b.WriteString("Create a concise checkpoint summary for the conversation segment below.\n\n")
	if req.PreviousSummary != "" {
		b.WriteString("Previous checkpoint summary:\n")
		b.WriteString(strings.TrimSpace(req.PreviousSummary))
		b.WriteString("\n\n")
	}
	b.WriteString("Compaction trigger: ")
	b.WriteString(strings.TrimSpace(req.Trigger))
	b.WriteString("\nCompaction reason: ")
	b.WriteString(strings.TrimSpace(req.Reason))
	b.WriteString("\n\nCompacted conversation segment:\n")
	for i, msg := range req.CompactedHead {
		content := strings.TrimSpace(msg.Content)
		if content == "" && strings.TrimSpace(msg.Reasoning) == "" && strings.TrimSpace(msg.ToolArgs) == "" {
			continue
		}
		b.WriteString(fmt.Sprintf("\n[%d] %s\n", i+1, strings.TrimSpace(msg.Role)))
		if content != "" {
			b.WriteString(content)
			b.WriteString("\n")
		}
		if reasoning := strings.TrimSpace(msg.Reasoning); reasoning != "" {
			b.WriteString("Reasoning summary material:\n")
			b.WriteString(reasoning)
			b.WriteString("\n")
		}
		if toolName := strings.TrimSpace(msg.ToolName); toolName != "" {
			b.WriteString("Tool: ")
			b.WriteString(toolName)
			b.WriteString("\n")
		}
		if toolArgs := strings.TrimSpace(msg.ToolArgs); toolArgs != "" {
			b.WriteString("Tool args:\n")
			b.WriteString(toolArgs)
			b.WriteString("\n")
		}
	}
	b.WriteString("\nRetained tail starts after this summary. Do not repeat retained-tail content unless needed to preserve continuity.\n")
	return truncateRunes(b.String(), 64_000)
}

func floretCompactionSummaryOutputTokens(req flruntime.ProjectedCompactionSummaryRequest) int64 {
	const defaultSummaryTokens int64 = 2048
	const maxSummaryTokens int64 = 4096
	tokens := req.Policy.ReservedSummaryTokens
	if tokens <= 0 {
		return defaultSummaryTokens
	}
	if tokens > maxSummaryTokens {
		return maxSummaryTokens
	}
	if tokens < 512 {
		return 512
	}
	return tokens
}
