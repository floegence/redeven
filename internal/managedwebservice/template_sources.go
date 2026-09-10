package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type TemplateSourceInspectRequest struct {
	TemplateID string                     `json:"template_id,omitempty"`
	Source     templatecontract.GitSource `json:"source"`
	Token      string                     `json:"token,omitempty"`
	Snapshot   *templatecontract.Snapshot `json:"snapshot,omitempty"`
}
type TemplateSourceDiscoverRequest struct {
	Source templatecontract.GitSource `json:"source"`
	Token  string                     `json:"token,omitempty"`
}
type TemplateSourceConfirmRequest struct {
	RequestID      string `json:"request_id"`
	CandidateID    string `json:"candidate_id"`
	SHA256         string `json:"sha256"`
	ExpectedSHA256 string `json:"expected_sha256,omitempty"`
}
type TemplateSourceFileChange struct {
	Path   string `json:"path"`
	Change string `json:"change"`
	Mode   string `json:"mode,omitempty"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}
type TemplateSourceFileContent struct {
	Mode   string `json:"mode"`
	SHA256 string `json:"sha256"`
	Binary bool   `json:"binary"`
	Text   string `json:"text,omitempty"`
}
type TemplateSourceFilePreview struct {
	Path   string                     `json:"path"`
	Before *TemplateSourceFileContent `json:"before,omitempty"`
	After  *TemplateSourceFileContent `json:"after,omitempty"`
}
type TemplateSourcePreview struct {
	CandidateID           string                     `json:"candidate_id"`
	SHA256                string                     `json:"sha256"`
	ExpectedSHA256        string                     `json:"expected_sha256"`
	ExpiresAtUnixMs       int64                      `json:"expires_at_unix_ms"`
	Changed               bool                       `json:"changed"`
	Template              Template                   `json:"template"`
	PreviousTemplate      *Template                  `json:"previous_template,omitempty"`
	Files                 []TemplateSourceFileChange `json:"files"`
	AffectedServiceIDs    []string                   `json:"affected_service_ids"`
	SourceDocumentVersion int                        `json:"source_document_version"`
	SourceSpecVersion     int                        `json:"source_spec_version"`
}
type cachedTemplateSource struct {
	Owner       string
	Snapshot    templatecontract.Snapshot
	Preview     TemplateSourcePreview
	BeforeFiles []templatecontract.File
}
type TemplateSourceBackend interface {
	DiscoverTemplateSources(context.Context, TemplateSourceDiscoverRequest) (templatecontract.SourceCatalog, error)
	InspectTemplateSource(context.Context, string, TemplateSourceInspectRequest) (*TemplateSourcePreview, error)
	ConfirmTemplateSource(context.Context, string, TemplateSourceConfirmRequest) (*Template, error)
	DiscardTemplateSource(context.Context, string, string) error
	PreviewTemplateSourceFile(context.Context, string, string, string) (*TemplateSourceFilePreview, error)
}

func sourceIdentity(repositoryID int64, documentID string) string {
	return "git_" + requestFingerprint(strconv.FormatInt(repositoryID, 10), documentID)[:48]
}
func (m *Manager) sourceRoot() string { return filepath.Join(m.stateDir, "template-sources") }
func (m *Manager) sourceDirectory(source pfregistry.ManagedTemplateSource) (string, error) {
	if !managedWorkspaceIdentityPattern.MatchString(source.Directory) || strings.ContainsAny(source.Directory, "./\\") {
		return "", serviceError("TEMPLATE_SOURCE_INVALID", "The template directory identity is invalid.", 409, false, nil)
	}
	return filepath.Join(m.sourceRoot(), source.Directory), nil
}

func (m *Manager) DiscoverTemplateSources(ctx context.Context, req TemplateSourceDiscoverRequest) (templatecontract.SourceCatalog, error) {
	client := templatecontract.GitHubClient{Client: m.templateSourceClient}
	result, err := client.Discover(ctx, req.Source, req.Token)
	return result, templateContractError(err)
}
func (m *Manager) InspectTemplateSource(ctx context.Context, owner string, req TemplateSourceInspectRequest) (*TemplateSourcePreview, error) {
	var old *pfregistry.ManagedTemplateSource
	var err error
	if req.TemplateID != "" {
		old, err = m.registry.GetManagedTemplateSource(ctx, req.TemplateID)
		if err != nil {
			return nil, err
		}
		if old == nil {
			return nil, serviceError("TEMPLATE_NOT_FOUND", "The GitHub template was not found.", 404, false, nil)
		}
		req.Source = templatecontract.GitSource{Repository: old.Repository, Ref: old.Ref, Path: old.Path}
	}
	var snapshot templatecontract.Snapshot
	if req.Snapshot != nil {
		if req.Token != "" {
			return nil, serviceError("REQUEST_INVALID", "Transferred sources must not include a repository credential.", 400, false, nil)
		}
		snapshot = *req.Snapshot
	} else {
		client := templatecontract.GitHubClient{Client: m.templateSourceClient}
		snapshot, err = client.Capture(ctx, req.Source, req.Token)
		if err != nil {
			return nil, templateContractError(err)
		}
	}
	if err := snapshot.Validate(); err != nil {
		return nil, templateContractError(err)
	}
	parsed, err := templatecontract.Read(snapshot.Files)
	if err != nil {
		return nil, templateContractError(err)
	}
	source := sourceRecord(snapshot, parsed)
	if old == nil {
		old, err = m.registry.GetManagedTemplateSource(ctx, source.TemplateID)
		if err != nil {
			return nil, err
		}
	}
	if old != nil && (old.TemplateID != source.TemplateID || old.RepositoryID != source.RepositoryID || !strings.EqualFold(old.Repository, source.Repository) || old.Ref != source.Ref || old.Path != source.Path || old.DocumentFamilyID != source.DocumentFamilyID || old.Deployment != source.Deployment) {
		return nil, serviceError("TEMPLATE_SOURCE_IDENTITY_CONFLICT", "The source must preserve its repository, ref, directory, template identity, service family, and deployment type.", 409, false, nil)
	}
	current, err := m.sourceTemplate(ctx, source, parsed)
	if err != nil {
		return nil, err
	}
	preview := TemplateSourcePreview{Template: *current, SHA256: snapshot.SHA256, Changed: old == nil || old.SHA256 != snapshot.SHA256, ExpiresAtUnixMs: time.Now().Add(15 * time.Minute).UnixMilli(), AffectedServiceIDs: []string{}, SourceDocumentVersion: parsed.SourceDocumentVersion, SourceSpecVersion: parsed.SourceSpecVersion}
	var oldFiles []templatecontract.File
	if old != nil {
		preview.ExpectedSHA256 = old.SHA256
		previous, files, err := m.readSourceTemplate(ctx, *old)
		if err != nil {
			return nil, err
		}
		preview.PreviousTemplate = previous
		oldFiles = files
	}
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return nil, err
	}
	for _, service := range services {
		if service.TemplateID == source.TemplateID {
			preview.AffectedServiceIDs = append(preview.AffectedServiceIDs, service.ServiceID)
		}
	}
	preview.Files = sourceFileChanges(oldFiles, snapshot.Files)
	preview.CandidateID, err = randomID("source_candidate")
	if err != nil {
		return nil, err
	}
	// Capture an independent immutable candidate; caller-owned transfer buffers
	// must not become mutable authority after the review is returned.
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.templateSources == nil {
		m.templateSources = map[string]cachedTemplateSource{}
	}
	for key, candidate := range m.templateSources {
		if candidate.Preview.ExpiresAtUnixMs < time.Now().UnixMilli() {
			delete(m.templateSources, key)
		}
	}
	if len(m.templateSources) >= 8 {
		return nil, serviceError("TEMPLATE_SOURCE_REVIEW_LIMIT", "Close an existing source preview before creating another.", 429, true, nil)
	}
	m.templateSources[preview.CandidateID] = cachedTemplateSource{Owner: owner, Snapshot: snapshot, Preview: preview, BeforeFiles: oldFiles}
	return &preview, nil
}

func sourceRecord(snapshot templatecontract.Snapshot, parsed *templatecontract.Template) pfregistry.ManagedTemplateSource {
	doc := parsed.Document
	localized := parsed.Localized(doc.DefaultLocale)
	return pfregistry.ManagedTemplateSource{TemplateID: sourceIdentity(snapshot.Source.RepositoryID, doc.TemplateID), Repository: snapshot.Source.Repository, RepositoryID: snapshot.Source.RepositoryID, Ref: snapshot.Source.Ref, Path: snapshot.Source.Path, CommitSHA: snapshot.Source.CommitSHA, SHA256: snapshot.SHA256, DocumentTemplateID: doc.TemplateID, DocumentFamilyID: doc.ServiceFamilyID, Deployment: string(parsed.Spec.Kind), Revision: doc.Revision, Name: localized.Name, Description: localized.Description, DefaultLocale: doc.DefaultLocale}
}

func (m *Manager) sourceTemplate(ctx context.Context, source pfregistry.ManagedTemplateSource, parsed *templatecontract.Template) (*Template, error) {
	platform := runtime.GOOS + "-" + runtime.GOARCH
	if parsed.Spec.Kind != DeploymentHost {
		platform = "linux-" + runtime.GOARCH
	}
	spec, err := parsed.ForPlatform(platform)
	if err != nil {
		return nil, templateContractError(err)
	}
	if spec.Container != nil && spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
		return nil, serviceError("TEMPLATE_RUNTIME_PROFILE_RESERVED", "The interactive desktop runtime profile is reserved for reviewed Redeven templates.", 400, false, nil)
	}
	if err := validateTemplateSpec(spec); err != nil {
		return nil, err
	}
	effective, err := effectiveTemplateSpec(spec)
	if err != nil {
		return nil, err
	}
	workspace, err := m.defaultWorkspacePath(source.TemplateID)
	if err != nil {
		return nil, err
	}
	available, code, reason := m.customTemplateAvailability(ctx, spec.Kind)
	doc := parsed.Document
	access := doc.DefaultAccessMode
	if access == "" {
		access = pfregistry.AccessModeUnifiedProxy
	}
	result := &Template{TemplateID: source.TemplateID, ServiceFamilyID: sourceIdentity(source.RepositoryID, source.DocumentFamilyID), Source: "git", GitSource: &source, SourceSHA256: source.SHA256, DefaultLocale: doc.DefaultLocale, Name: source.Name, Description: source.Description, Revision: source.Revision, Deployment: spec.Kind, ContainerMode: containerMode(spec.Kind), Available: available, ReasonCode: code, Reason: reason, Deployments: []DeploymentAvailability{{Deployment: spec.Kind, Available: available, ReasonCode: code, Reason: reason}}, Spec: &spec, EffectiveSpec: &effective, HostLifecyclePlan: hostLifecyclePlan(spec), DefaultWorkspacePath: workspace, WorkspaceRoots: m.workspaceRoots(), DefaultAccessMode: access, Localizations: parsed.Localizations, Icon: parsed.Icon, Notices: doc.Notices, DeveloperPreview: doc.DeveloperPreview, DiskBytes: doc.DiskBytes, SourceURL: doc.SourceURL, DockerSourceURL: doc.DockerSourceURL}
	if source.Directory != "" {
		result.SourceDirectory, err = m.sourceDirectory(source)
		if err != nil {
			return nil, err
		}
	}
	result.RecommendedRelease = recommendedReleaseForTemplate(*result)
	if result.RecommendedRelease != nil {
		result.ReleaseSource = result.RecommendedRelease.Kind
	}
	return result, nil
}

func (m *Manager) readSourceTemplate(ctx context.Context, source pfregistry.ManagedTemplateSource) (*Template, []templatecontract.File, error) {
	m.templateSourceMu.RLock()
	defer m.templateSourceMu.RUnlock()
	directory, err := m.sourceDirectory(source)
	if err != nil {
		return nil, nil, err
	}
	files, err := templatecontract.ReadDirectory(directory)
	if err != nil {
		return nil, nil, serviceError("TEMPLATE_SOURCE_UNAVAILABLE", "The saved template source is missing or unreadable. Restore its original directory before using this template.", 409, false, nil)
	}
	parsed, err := templatecontract.Read(files)
	if err != nil {
		return nil, nil, templateContractError(err)
	}
	if parsed.SHA256 != source.SHA256 || parsed.Document.TemplateID != source.DocumentTemplateID || parsed.Document.ServiceFamilyID != source.DocumentFamilyID || string(parsed.Spec.Kind) != source.Deployment {
		return nil, nil, serviceError("TEMPLATE_SOURCE_DIGEST_MISMATCH", "The saved template source changed outside its reviewed update. Its original definition must be restored.", 409, false, nil)
	}
	result, err := m.sourceTemplate(ctx, source, parsed)
	return result, files, err
}

func (m *Manager) ConfirmTemplateSource(ctx context.Context, owner string, req TemplateSourceConfirmRequest) (*Template, error) {
	if err := validateRequestID(req.RequestID); err != nil {
		return nil, err
	}
	fingerprint := requestFingerprint("source-confirm", owner, req.CandidateID, req.SHA256, req.ExpectedSHA256)
	m.requestMu.Lock()
	defer m.requestMu.Unlock()
	receipt, err := m.registry.GetManagedTemplateRequest(ctx, req.RequestID)
	if err != nil {
		return nil, err
	}
	if receipt != nil {
		if receipt.RequestFingerprint != fingerprint {
			return nil, serviceError("IDEMPOTENCY_CONFLICT", "This request was already used for another confirmation.", 409, false, nil)
		}
		return m.Template(ctx, receipt.TemplateID)
	}
	m.mu.Lock()
	candidate, ok := m.templateSources[req.CandidateID]
	m.mu.Unlock()
	if !ok || candidate.Owner != owner || candidate.Preview.ExpiresAtUnixMs < time.Now().UnixMilli() || candidate.Snapshot.SHA256 != req.SHA256 || candidate.Preview.ExpectedSHA256 != req.ExpectedSHA256 {
		return nil, serviceError("TEMPLATE_SOURCE_REVIEW_STALE", "Check the template source again before confirming this update.", 409, true, nil)
	}
	source := *candidate.Preview.Template.GitSource
	if m.templateSourceUses[source.TemplateID] > 0 {
		return nil, sourceCommitError(pfregistry.ErrManagedTemplateSourceBusy)
	}
	old, err := m.registry.GetManagedTemplateSource(ctx, source.TemplateID)
	if err != nil {
		return nil, err
	}
	if old != nil {
		if old.SHA256 != req.ExpectedSHA256 {
			return nil, sourceCommitError(pfregistry.ErrManagedTemplateSourceChanged)
		}
		if _, _, err := m.readSourceTemplate(ctx, *old); err != nil {
			return nil, err
		}
	}
	parsed, err := templatecontract.Read(candidate.Snapshot.Files)
	if err != nil {
		return nil, templateContractError(err)
	}
	if parsed.SHA256 != req.SHA256 {
		return nil, sourceCommitError(pfregistry.ErrManagedTemplateSourceChanged)
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
	if err := templatecontract.WriteDirectory(directory, candidate.Snapshot.Files); err != nil {
		_ = os.RemoveAll(directory)
		return nil, err
	}
	m.templateSourceMu.Lock()
	err = m.registry.CommitManagedTemplateSource(ctx, source, req.ExpectedSHA256, pfregistry.ManagedTemplateRequest{RequestID: req.RequestID, RequestFingerprint: fingerprint, TemplateID: source.TemplateID, Action: "source-confirm"})
	if err != nil {
		// A cancelled connection or commit I/O error can make the outcome
		// uncertain. Never remove a directory that may already be authoritative.
		// An unclaimed complete directory is collected on the next startup.
		active, readErr := m.registry.GetManagedTemplateSource(ctx, source.TemplateID)
		if readErr == nil && (active == nil || active.Directory != source.Directory) {
			_ = os.RemoveAll(directory)
		}
		m.templateSourceMu.Unlock()
		return nil, sourceCommitError(err)
	}
	if old != nil {
		if previous, err := m.sourceDirectory(*old); err == nil {
			_ = os.RemoveAll(previous)
		}
	}
	m.templateSourceMu.Unlock()
	m.mu.Lock()
	delete(m.templateSources, req.CandidateID)
	m.mu.Unlock()
	return m.Template(ctx, source.TemplateID)
}
func sourceCommitError(err error) error {
	if errors.Is(err, pfregistry.ErrManagedTemplateSourceChanged) {
		return serviceError("TEMPLATE_SOURCE_REVIEW_STALE", "The saved source changed after review. Check it again before confirming.", 409, true, nil)
	}
	if errors.Is(err, pfregistry.ErrManagedTemplateSourceBusy) {
		return serviceError("TEMPLATE_OPERATION_CONFLICT", "Wait for this template's service operation to finish before updating.", 409, true, nil)
	}
	return err
}
func (m *Manager) DiscardTemplateSource(_ context.Context, owner, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if candidate, ok := m.templateSources[id]; ok && candidate.Owner == owner {
		delete(m.templateSources, id)
	}
	return nil
}

func (m *Manager) PreviewTemplateSourceFile(_ context.Context, owner, id, path string) (*TemplateSourceFilePreview, error) {
	m.mu.Lock()
	candidate, ok := m.templateSources[id]
	m.mu.Unlock()
	if !ok || candidate.Owner != owner || candidate.Preview.ExpiresAtUnixMs < time.Now().UnixMilli() {
		return nil, serviceError("TEMPLATE_SOURCE_REVIEW_STALE", "Check the template source again before viewing its files.", 409, true, nil)
	}
	// Only immutable captured bytes are visible; this endpoint never opens a
	// caller-supplied filesystem path or fetches another repository resource.
	find := func(files []templatecontract.File) *TemplateSourceFileContent {
		for _, file := range files {
			if file.Path == path {
				content := &TemplateSourceFileContent{Mode: file.Mode, SHA256: sourceFileHash(file.Content), Binary: !utf8.Valid(file.Content) || strings.ContainsRune(string(file.Content), 0)}
				if !content.Binary {
					content.Text = string(file.Content)
				}
				return content
			}
		}
		return nil
	}
	result := &TemplateSourceFilePreview{Path: path, Before: find(candidate.BeforeFiles), After: find(candidate.Snapshot.Files)}
	if result.Before == nil && result.After == nil {
		return nil, serviceError("TEMPLATE_SOURCE_FILE_NOT_FOUND", "The file is not part of this source preview.", 404, false, nil)
	}
	return result, nil
}

func sourceFileHash(content []byte) string {
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:])
}

func sourceFileChanges(before, after []templatecontract.File) []TemplateSourceFileChange {
	previous := map[string]templatecontract.File{}
	next := map[string]templatecontract.File{}
	paths := map[string]bool{}
	for _, file := range before {
		previous[file.Path] = file
		paths[file.Path] = true
	}
	for _, file := range after {
		next[file.Path] = file
		paths[file.Path] = true
	}
	keys := []string{}
	for key := range paths {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	result := []TemplateSourceFileChange{}
	for _, key := range keys {
		a, had := previous[key]
		b, has := next[key]
		if had && has && a.Mode == b.Mode && string(a.Content) == string(b.Content) {
			continue
		}
		change := "modified"
		if !had {
			change = "added"
		}
		if !has {
			change = "removed"
		}
		result = append(result, TemplateSourceFileChange{Path: key, Change: change, Mode: b.Mode, Before: sourceFileHash(a.Content), After: sourceFileHash(b.Content)})
	}
	return result
}

func (m *Manager) cleanupTemplateSourceOrphans(ctx context.Context) error {
	sources, err := m.registry.ListManagedTemplateSources(ctx)
	if err != nil {
		return err
	}
	active := map[string]bool{}
	for _, source := range sources {
		active[source.Directory] = true
	}
	entries, err := os.ReadDir(m.sourceRoot())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "source_") && !active[entry.Name()] {
			if err := os.RemoveAll(filepath.Join(m.sourceRoot(), entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
