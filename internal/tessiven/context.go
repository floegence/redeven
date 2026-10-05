package tessiven

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
)

type Selection struct {
	CanvasID   string   `json:"canvas_id"`
	VersionID  int64    `json:"version_id"`
	ObjectRefs []string `json:"object_refs"`
}

// SelectionContext reads exactly the selected immutable version. Names, evidence,
// and relationships are data, never tool authority or execution instructions.
func (s *Service) SelectionContext(ctx context.Context, selection Selection) (string, error) {
	if selection.CanvasID == "" || selection.VersionID <= 0 || len(selection.ObjectRefs) > 100 {
		return "", ErrInvalidRequest
	}
	version, err := s.Version(ctx, selection.CanvasID, selection.VersionID)
	if err != nil {
		return "", err
	}
	raw, _ := json.Marshal(version.Document)
	var document map[string]json.RawMessage
	_ = json.Unmarshal(raw, &document)
	objects := map[string]json.RawMessage{}
	observations := map[string]*Observation{}
	for _, kind := range []string{"nodes", "groups", "services", "instances", "resources", "relations", "evidence"} {
		var items []json.RawMessage
		_ = json.Unmarshal(document[kind], &items)
		for _, item := range items {
			var identity struct {
				ID          string       `json:"id"`
				Observation *Observation `json:"observation"`
			}
			_ = json.Unmarshal(item, &identity)
			objects[identity.ID] = item
			observations[identity.ID] = identity.Observation
		}
	}
	refs := map[string]bool{}
	requested := map[string]bool{}
	for _, id := range selection.ObjectRefs {
		if _, ok := objects[id]; !ok {
			return "", fmt.Errorf("%w: object %s", ErrNotFound, id)
		}
		refs[id] = true
		requested[id] = true
	}
	for _, group := range version.Document.Groups {
		if refs[group.ID] {
			for _, node := range group.NodeRefs {
				refs[node] = true
			}
		}
	}
	selectedScope := make(map[string]bool, len(refs))
	for id := range refs {
		selectedScope[id] = true
	}
	for _, instance := range version.Document.Instances {
		if selectedScope[instance.ID] || selectedScope[instance.NodeRef] || selectedScope[instance.ServiceRef] {
			refs[instance.ID] = true
			refs[instance.NodeRef] = true
			refs[instance.ServiceRef] = true
		}
	}
	directScope := make(map[string]bool, len(refs))
	for id := range refs {
		directScope[id] = true
	}
	for _, relation := range version.Document.Relations {
		if directScope[relation.ID] || directScope[relation.From] || directScope[relation.To] {
			refs[relation.ID] = true
			refs[relation.From] = true
			refs[relation.To] = true
			for _, id := range relation.EvidenceRefs {
				refs[id] = true
			}
		}
	}
	for id := range refs {
		if observation := observations[id]; observation != nil {
			for _, evidence := range observation.EvidenceRefs {
				refs[evidence] = true
			}
		}
	}
	ids := make([]string, 0, len(refs))
	for id := range refs {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		if requested[ids[i]] != requested[ids[j]] {
			return requested[ids[i]]
		}
		return ids[i] < ids[j]
	})
	selected := []json.RawMessage{}
	used := 0
	truncated := false
	for _, id := range ids {
		item := objects[id]
		if len(selected) >= 100 || used+len(item) > 6000 {
			truncated = true
			continue
		}
		selected = append(selected, item)
		used += len(item)
	}
	out, err := json.Marshal(struct {
		Selection
		Title     string            `json:"title"`
		Digest    string            `json:"digest"`
		SavedAt   int64             `json:"saved_at"`
		Counts    map[string]int    `json:"counts"`
		Objects   []json.RawMessage `json:"objects"`
		Truncated bool              `json:"truncated"`
	}{selection, version.Document.Metadata.Title, version.Digest, version.CreatedAt, map[string]int{"nodes": len(version.Document.Nodes), "services": len(version.Document.Services), "instances": len(version.Document.Instances), "resources": len(version.Document.Resources), "relations": len(version.Document.Relations)}, selected, truncated})
	return string(out), err
}
