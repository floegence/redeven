package ai

import (
	"strings"

	"github.com/floegence/redeven/internal/ai/pendinginputlegacy"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

// These adapters feed the current authorization and effect builder. They do
// not decode persisted bytes or construct canonical migration content.
func pendingInputEffectMeta(value pendinginputlegacy.Session) session.Meta {
	return session.Meta{ChannelID: value.ChannelID,
		EndpointID:        value.EndpointID,
		FloeApp:           value.FloeApp,
		CodeSpaceID:       value.CodeSpaceID,
		SessionKind:       value.SessionKind,
		UserPublicID:      value.UserPublicID,
		UserEmail:         value.UserEmail,
		NamespacePublicID: value.NamespacePublicID,
		CanRead:           value.CanRead,
		CanWrite:          value.CanWrite,
		CanExecute:        value.CanExecute,
		CanAdmin:          value.CanAdmin,
		CreatedAtUnixMs:   value.CreatedAtUnixMs}
}

func pendingInputEffectOptions(value pendinginputlegacy.Options) RunOptions {
	return RunOptions{ReasoningOnly: value.ReasoningOnly,
		NoUserInteraction:   value.NoUserInteraction,
		ToolAllowlist:       value.ToolAllowlist,
		PermissionType:      value.PermissionType,
		CacheControl:        value.CacheControl,
		ResponseFormat:      value.ResponseFormat,
		Temperature:         value.Temperature,
		TopP:                value.TopP,
		MaxInputTokens:      value.MaxInputTokens,
		MaxOutputTokens:     value.MaxOutputTokens,
		MaxCostUSD:          value.MaxCostUSD,
		CompactionThreshold: value.CompactionThreshold,
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevel(value.ReasoningSelection.Level), BudgetTokens: value.ReasoningSelection.BudgetTokens},
	}
}

func pendingInputEffectInput(text string, attachments []pendinginputlegacy.Attachment, action *pendinginputlegacy.ContextActionEnvelope) RunInput {
	out := RunInput{Text: strings.TrimSpace(text)}
	for _, attachment := range attachments {
		out.Attachments = append(out.Attachments, RunAttachmentIn{AttachmentID: attachment.AttachmentID})
	}
	if action == nil {
		return out
	}
	context := &ContextActionEnvelope{
		SchemaVersion: action.SchemaVersion, ActionID: action.ActionID, Provider: action.Provider,
		Target:              ContextActionTarget{TargetID: action.Target.TargetID, Locality: action.Target.Locality},
		Source:              ContextActionSource{Surface: action.Source.Surface, SurfaceID: action.Source.SurfaceID},
		Presentation:        ContextActionPresentation{Label: action.Presentation.Label, Priority: action.Presentation.Priority, StatusLabel: action.Presentation.StatusLabel, DisabledReason: action.Presentation.DisabledReason},
		SuggestedWorkingDir: action.SuggestedWorkingDir,
	}
	if hint := action.ExecutionContext; hint != nil {
		context.ExecutionContext = &ContextActionExecutionHint{CurrentTargetID: hint.CurrentTargetID, SourceEnvPublicID: hint.SourceEnvPublicID, RuntimeHint: hint.RuntimeHint, SessionSource: hint.SessionSource}
	}
	for _, item := range action.Context {
		context.Context = append(context.Context, ContextActionContextItem{Kind: item.Kind,
			Path:           item.Path,
			IsDirectory:    item.IsDirectory,
			RootLabel:      item.RootLabel,
			Selection:      item.Selection,
			SelectionChars: item.SelectionChars,
			WorkingDir:     item.WorkingDir,
			PID:            item.PID,
			Name:           item.Name,
			Username:       item.Username,
			CPUPercent:     item.CPUPercent,
			MemoryBytes:    item.MemoryBytes,
			Platform:       item.Platform,
			CapturedAtMs:   item.CapturedAtMs,
			Title:          item.Title,
			Detail:         item.Detail,
			Content:        item.Content})
	}
	out.ContextAction = context
	return out
}
