package ai

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/session"
)

// fileActivityTarget is a historical navigation fact, never read authority.
func fileActivityTarget(path, kind string) *fltools.ActivityTargetRef {
	if path == "" || path != strings.TrimSpace(path) || !filepath.IsAbs(path) || !utf8.ValidString(path) || utf8.RuneCountInString(path) > 500 || strings.ContainsAny(path, "\x00\r\n") {
		return nil
	}
	label, _ := contractSafeString(displayNameForFilePath(path), 240)
	if label == "" {
		label = path
	}
	return &fltools.ActivityTargetRef{Kind: kind, Label: label, Path: path}
}

func fileMutationActivityPayload(record map[string]any) fltools.FileMutationActivityPayload {
	return fltools.FileMutationActivityPayload{
		DisplayName:           strings.TrimSpace(anyToString(record["display_name"])),
		ChangeType:            strings.TrimSpace(anyToString(record["change_type"])),
		Additions:             readIntField(record, "additions"),
		Deletions:             readIntField(record, "deletions"),
		UnifiedDiff:           anyToString(record["unified_diff"]),
		DiffUnavailableReason: strings.TrimSpace(anyToString(record["diff_unavailable_reason"])),
		Truncated:             readBoolField(record, "truncated"),
	}
}

func mutationActivityTarget(data map[string]any) *fltools.ActivityTargetRef {
	if data["error"] != nil || data["status"] != nil && anyToString(data["status"]) != "success" {
		return nil
	}
	paths := []string{anyToString(data["new_path"]), anyToString(data["file_path"]), anyToString(data["old_path"])}
	if anyToString(data["change_type"]) == "delete" {
		paths = []string{anyToString(data["old_path"]), anyToString(data["file_path"])}
	}
	for _, path := range paths {
		if path == "" {
			continue
		}
		// Validate the complete raw path before deriving its parent. Generic
		// presentation helpers trim strings and cannot establish an exact target.
		if fileActivityTarget(path, "file") == nil {
			return nil
		}
		if anyToString(data["change_type"]) == "delete" {
			return fileActivityTarget(filepath.Dir(path), "directory")
		}
		return fileActivityTarget(path, "file")
	}
	return nil
}

func localFileActivityTool(name string) bool {
	switch name {
	case "read_file", "file.read", "read_files", "file.edit", "file.write", "file.present", "apply_patch", "image.read":
		return true
	}
	return false
}

// applyFileActivityTargets uses complete execution data, never display text or
// positional references. The same mapper serves new and canonical old results.
func applyFileActivityTargets(activity *fltools.ActivityPresentation, name string, data any) {
	if activity == nil || !localFileActivityTool(name) {
		return
	}
	normalized, err := normalizeJSONCompatibleToolPayload(data)
	if err != nil {
		return
	}
	payload, _ := normalized.(map[string]any)
	// Routed results carry explicit target provenance, never local filesystem paths.
	if payload["target_id"] != nil || payload["execution_location"] != nil || payload["target_kind"] != nil {
		return
	}
	switch name {
	case "read_files":
		structured, ok := activity.Payload.(fltools.StructuredActivityPayload)
		if !ok {
			return
		}
		structured.Rows = structuredToolResults(name, data, nil, true)
		activity.Payload = structured
	case "apply_patch":
		patch, ok := activity.Payload.(fltools.PatchActivityPayload)
		if !ok {
			return
		}
		mutations := fltools.FileMutationActivityPayloads{}
		for _, entry := range toAnySlice(payload["mutations"]) {
			record, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			safe, _ := boundedJSONMap(record, 0)
			target := mutationActivityTarget(record)
			mutation := fileMutationActivityPayload(safe)
			mutation.Target = target
			mutations = append(mutations, mutation)
			if len(mutations) == 200 {
				break
			}
		}
		if len(mutations) > 0 {
			patch.Mutations = &mutations
		}
		activity.Payload = patch
	default:
		target := mutationActivityTarget(payload)
		if target != nil {
			activity.TargetRefs = append(activity.TargetRefs, *target)
		}
	}
}

func canonicalActivityResultData(content string) (any, bool) {
	var result struct {
		Status string
		Data   json.RawMessage
		Error  json.RawMessage
	}
	if json.Unmarshal([]byte(content), &result) != nil || result.Status != "success" || len(result.Data) == 0 || len(result.Error) > 0 && string(result.Error) != "null" {
		return nil, false
	}
	var data any
	if json.Unmarshal(result.Data, &data) != nil {
		return nil, false
	}
	return data, true
}

// hydrateActivityTargets enriches response copies only. Canonical records
// remain immutable and no filesystem operation runs while reading history.
func (s *Service) hydrateActivityTargets(ctx context.Context, meta *session.Meta, threadID string, items []flruntime.ThreadItem) ([]flruntime.ThreadItem, error) {
	reader, ok := s.threadRuntime.(flruntime.ThreadQueryReader)
	if !ok {
		return items, nil
	}
	type key struct {
		thread identity.ThreadID
		turn   identity.TurnID
		run    identity.RunID
		call   string
	}
	pending := map[key]int{}
	for i, item := range items {
		if item.Activity == nil || item.Activity.Status != observation.ActivityStatusSuccess || (!localFileActivityTool(item.Activity.ToolName) && item.Activity.ToolName != "subagent_events" && item.Activity.ToolName != "report_to_parent") {
			continue
		}
		activity := item.Activity.Presentation
		if activity == nil {
			continue
		}
		if item.TurnID == "" || item.RunID == "" || item.Activity.ToolID == "" {
			continue
		}
		if !activityTargetsComplete(item.Activity.ToolName, activity) {
			pending[key{identity.ThreadID(threadID), item.TurnID, item.RunID, item.Activity.ToolID}] = i
		}
	}
	if len(pending) == 0 {
		return items, nil
	}
	out := append([]flruntime.ThreadItem(nil), items...)
	// Re-authorize the exact thread on every page and read; refs grant no access.
	authorize := func() (threadquery.Scope, error) {
		settings, err := s.threadSettingsForRead(ctx, meta, threadID)
		if err != nil {
			return threadquery.Scope{}, err
		}
		if settings == nil {
			return threadquery.Scope{}, flruntime.ErrThreadNotFound
		}
		if strings.TrimSpace(meta.UserPublicID) == "" {
			return threadquery.Scope{}, errReadPermissionDenied
		}
		authority, err := json.Marshal([]string{meta.UserPublicID, meta.EndpointID, meta.NamespacePublicID})
		if err != nil {
			return threadquery.Scope{}, err
		}
		return threadquery.Scope{Authority: string(authority), ThreadIDs: []identity.ThreadID{identity.ThreadID(threadID)}}, nil
	}
	filter := threadquery.Filter{ThreadIDs: []identity.ThreadID{identity.ThreadID(threadID)}, Statuses: []string{"success"}, ToolKinds: []string{"local"}}
	turns, runs, names := map[identity.TurnID]bool{}, map[identity.RunID]bool{}, map[string]bool{}
	for k, index := range pending {
		if !turns[k.turn] {
			filter.TurnIDs = append(filter.TurnIDs, k.turn)
			turns[k.turn] = true
		}
		if !runs[k.run] {
			filter.RunIDs = append(filter.RunIDs, k.run)
			runs[k.run] = true
		}
		name := items[index].Activity.ToolName
		if !names[name] {
			filter.ToolNames = append(filter.ToolNames, name)
			names[name] = true
		}
	}
	input := threadquery.QueryInput{Object: threadquery.ToolCalls, Filter: filter, Limit: 200}
	for {
		scope, err := authorize()
		if err != nil {
			return nil, err
		}
		page, err := reader.Query(ctx, scope, input)
		if err != nil {
			return nil, err
		}
		for _, record := range page.Records {
			k := key{record.ThreadID, record.TurnID, record.RunID, record.ToolCallID}
			index, wanted := pending[k]
			if !wanted || record.ToolName != out[index].Activity.ToolName || record.Status != "success" {
				continue
			}
			var content strings.Builder
			read := threadquery.ReadInput{Ref: record.Ref}
			for {
				scope, err := authorize()
				if err != nil {
					return nil, err
				}
				part, err := reader.Read(ctx, scope, read)
				if err != nil {
					return nil, err
				}
				if part.Record.ThreadID != record.ThreadID || part.Record.TurnID != record.TurnID || part.Record.RunID != record.RunID || part.Record.ToolCallID != record.ToolCallID || part.Record.ToolName != record.ToolName || part.Record.Status != "success" {
					return nil, errors.New("canonical activity result identity changed")
				}
				for _, chunk := range part.Chunks {
					if chunk.Field == "result" {
						if chunk.Offset != content.Len() {
							return nil, errors.New("canonical activity result chunk discontinuity")
						}
						content.WriteString(chunk.Text)
					}
				}
				if part.NextCursor == "" {
					break
				}
				read.Cursor = part.NextCursor
			}
			if data, confirmed := canonicalActivityResultData(content.String()); confirmed {
				item := *out[index].Activity
				item.Presentation = fltools.CloneActivityPresentation(item.Presentation)
				kept := item.Presentation.TargetRefs[:0]
				for _, target := range item.Presentation.TargetRefs {
					if !strings.HasPrefix(target.Kind, "file_action:") {
						kept = append(kept, target)
					}
				}
				item.Presentation.TargetRefs = kept
				if record.ToolName == "subagent_events" || record.ToolName == "report_to_parent" {
					applyParentEventActivity(item.Presentation, record.ToolName, data)
				} else {
					mergeHistoricalFileActivityTargets(item.Presentation, record.ToolName, data)
				}
				out[index].Activity = &item
			}
			delete(pending, k)
		}
		if len(pending) == 0 || page.NextCursor == "" {
			break
		}
		input.Cursor = page.NextCursor
	}
	return out, nil
}

func fileActivityTargetsComplete(activity *fltools.ActivityPresentation) bool {
	switch payload := activity.Payload.(type) {
	case fltools.StructuredActivityPayload:
		if len(payload.Rows) == 0 {
			return false
		}
		for _, row := range payload.Rows {
			if row.Target != nil {
				return true
			}
		}
		return false
	case fltools.PatchActivityPayload:
		if payload.Mutations == nil || len(*payload.Mutations) == 0 {
			return false
		}
		for _, mutation := range *payload.Mutations {
			if mutation.Target != nil {
				return true
			}
		}
		return false
	}
	for _, target := range activity.TargetRefs {
		if target.Path != "" {
			return true
		}
	}
	return false
}

// Canonical re-rendering must prove the complete row/mutation shape before
// enriching old presentation. No filename, display-text or ordinal lookup runs.
func mergeHistoricalFileActivityTargets(activity *fltools.ActivityPresentation, name string, data any) {
	mapped := fltools.CloneActivityPresentation(activity)
	applyFileActivityTargets(mapped, name, data)
	switch original := activity.Payload.(type) {
	case fltools.StructuredActivityPayload:
		derived := mapped.Payload.(fltools.StructuredActivityPayload)
		plain := append([]fltools.StructuredActivityRow(nil), derived.Rows...)
		before := append([]fltools.StructuredActivityRow(nil), original.Rows...)
		for i := range plain {
			plain[i].Target = nil
		}
		for i := range before {
			before[i].Target = nil
		}
		if reflect.DeepEqual(before, plain) {
			original.Rows = derived.Rows
			activity.Payload = original
		}
	case fltools.PatchActivityPayload:
		derived := mapped.Payload.(fltools.PatchActivityPayload)
		if original.Mutations == nil || derived.Mutations == nil {
			return
		}
		before := append(fltools.FileMutationActivityPayloads(nil), (*original.Mutations)...)
		plain := append(fltools.FileMutationActivityPayloads(nil), (*derived.Mutations)...)
		for i := range before {
			before[i].Target = nil
		}
		for i := range plain {
			plain[i].Target = nil
		}
		if reflect.DeepEqual(before, plain) {
			original.Mutations = derived.Mutations
			activity.Payload = original
		}
	default:
		activity.TargetRefs = mapped.TargetRefs
	}
}
