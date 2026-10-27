package ai

import (
	"context"
	"errors"
	"slices"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/redeven/internal/session"
)

// New runs use one script path. Explicit primitive consumers and already
// admitted provider surfaces retain their tools, including restart/retry.
// This changes discovery, never grants authority or replays historical input.
func compactComputerToolSurface(all []ToolDef, explicit map[string]struct{}, initial *flruntime.ProviderToolSurface, historical ...map[string]struct{}) []ToolDef {
	if !slices.ContainsFunc(all, func(d ToolDef) bool { return d.Name == "computer.exec" }) {
		return all
	}
	retained := map[string]bool{"computer.targets": true, "computer.select_target": true, "computer.exec": true}
	for name := range explicit {
		retained[name] = true
	}
	for _, names := range historical {
		for name := range names {
			retained[name] = true
		}
	}
	if initial != nil {
		for _, d := range initial.ToolDefinitions {
			retained[d.Name] = true
		}
	}
	return slices.DeleteFunc(slices.Clone(all), func(d ToolDef) bool { return isComputerUseToolName(d.Name) && !retained[d.Name] })
}

// Canonical Retry is a new Turn, so its first checkpoint cannot supply the
// source tools. Read only used primitive names from the authorized source Turn;
// never expand every retry or reconstruct provider history in the host.
func (s *Service) retryComputerToolNames(ctx context.Context, meta *session.Meta, request flruntime.AgentRequest) (map[string]struct{}, error) {
	reader, ok := s.threadRuntime.(flruntime.ThreadQueryReader)
	if !ok {
		return nil, errors.New("canonical retry tool query is unavailable")
	}
	scope, err := s.flowerHistoryScope(ctx, meta, request.ThreadID.String())
	if err != nil {
		return nil, err
	}
	var primitives []string
	for _, def := range builtInComputerToolDefinitions() {
		if def.Name != "computer.targets" && def.Name != "computer.select_target" && def.Name != "computer.exec" {
			primitives = append(primitives, def.Name)
		}
	}
	input := threadquery.QueryInput{Object: threadquery.ToolCalls, Filter: threadquery.Filter{ThreadIDs: []identity.ThreadID{request.ThreadID}, TurnIDs: []identity.TurnID{request.RetrySource}, ToolNames: primitives}, Limit: 100}
	names := map[string]struct{}{}
	for {
		page, err := reader.Query(ctx, scope, input)
		if errors.Is(err, threadquery.ErrThreadQueryIndexNotReady) && input.Cursor == "" && s.prepareFloretThread != nil {
			// Released stores may be readable before query metadata is ready.
			// Floret alone prepares it; never infer names or read its storage.
			if err := s.prepareFloretThread(ctx, request.ThreadID); err != nil {
				return nil, err
			}
			scope, err = s.flowerHistoryScope(ctx, meta, request.ThreadID.String())
			if err != nil {
				return nil, err
			}
			page, err = reader.Query(ctx, scope, input)
		}
		if err != nil {
			return nil, err
		}
		for _, record := range page.Records {
			names[record.ToolName] = struct{}{}
		}
		if page.NextCursor == "" {
			return names, nil
		}
		input.Cursor = page.NextCursor
		scope, err = s.flowerHistoryScope(ctx, meta, request.ThreadID.String())
		if err != nil {
			return nil, err
		}
	}
}
