package managedwebservice

import (
	"context"
	"encoding/json"
	"os"
	"time"

	template "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func sourceSelectionFingerprint(source *SourceSelection, owner string) string {
	if source == nil {
		return ""
	}
	raw, _ := json.Marshal(source)
	return requestFingerprint(string(raw), owner)
}
func templateReleaseScope(t Template, source *SourceSelection) string {
	scope := "template:" + t.TemplateID
	if source != nil {
		scope += ":" + t.SourceSHA256
	}
	return scope
}
func (m *Manager) selectedSource(id string, selection *SourceSelection, owner string) (cachedTemplateSource, error) {
	m.mu.Lock()
	candidate, ok := m.templateSources[selection.CandidateID]
	m.mu.Unlock()
	if !ok || candidate.Owner != owner || candidate.Preview.ExpiresAtUnixMs < time.Now().UnixMilli() || candidate.Preview.Template.TemplateID != id || candidate.Snapshot.SHA256 != selection.SHA256 || candidate.Preview.ExpectedSHA256 != selection.ExpectedSHA256 {
		return cachedTemplateSource{}, serviceError("TEMPLATE_SOURCE_REVIEW_STALE", "Review the template source again before deploying.", 409, true, nil)
	}
	return candidate, nil
}
func (m *Manager) installTemplate(ctx context.Context, id string, selection *SourceSelection, owner string) (*Template, error) {
	if selection == nil {
		return m.template(ctx, id, false)
	}
	candidate, err := m.selectedSource(id, selection, owner)
	if err != nil {
		return nil, err
	}
	result := candidate.Preview.Template
	return &result, nil
}
func (m *Manager) stageInstallSource(ctx context.Context, id string, selection *SourceSelection, owner string) (*pfregistry.ManagedTemplateSource, error) {
	candidate, err := m.selectedSource(id, selection, owner)
	if err != nil {
		return nil, err
	}
	source := *candidate.Preview.Template.GitSource
	retained, err := m.registry.GetTemplateSourceVersion(ctx, id, selection.SHA256)
	if err != nil {
		return nil, err
	}
	if retained != nil {
		if _, _, err := m.readSourceTemplate(ctx, *retained); err != nil {
			return nil, err
		}
		source.Directory = retained.Directory
		return &source, nil
	}
	if err := os.MkdirAll(m.sourceRoot(), 0700); err != nil {
		return nil, err
	}
	source.Directory, err = randomID("source")
	if err != nil {
		return nil, err
	}
	directory, err := m.sourceDirectory(source)
	if err != nil {
		return nil, err
	}
	if err := template.WriteDirectory(directory, candidate.Snapshot.Files); err != nil {
		_ = os.RemoveAll(directory)
		return nil, err
	}
	// Only a complete immutable directory is staged. The database transaction
	// makes it authoritative; unreferenced staging is collected at startup.
	return &source, nil
}
