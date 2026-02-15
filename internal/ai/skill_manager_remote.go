package ai

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const (
	ErrCodeAISkillsInvalidScope      = "AI_SKILLS_INVALID_SCOPE"
	ErrCodeAISkillsInvalidSource     = "AI_SKILLS_INVALID_SOURCE"
	ErrCodeAISkillsInvalidPath       = "AI_SKILLS_INVALID_PATH"
	ErrCodeAISkillsPathEscape        = "AI_SKILLS_PATH_ESCAPE"
	ErrCodeAISkillsSkillExists       = "AI_SKILLS_SKILL_EXISTS"
	ErrCodeAISkillsSkillNotFound     = "AI_SKILLS_SKILL_NOT_FOUND"
	ErrCodeAISkillsFrontmatterBad    = "AI_SKILLS_FRONTMATTER_INVALID"
	ErrCodeAISkillsGitHubFetchFailed = "AI_SKILLS_GITHUB_FETCH_FAILED"
	ErrCodeAISkillsGitFallbackFailed = "AI_SKILLS_GIT_FALLBACK_FAILED"
	ErrCodeAISkillsArchiveInvalid    = "AI_SKILLS_ARCHIVE_INVALID"
	ErrCodeAISkillsBrowseForbidden   = "AI_SKILLS_BROWSE_FORBIDDEN"
	ErrCodeAISkillsFileTooLarge      = "AI_SKILLS_FILE_TOO_LARGE"
	ErrCodeAISkillsInternal          = "AI_SKILLS_INTERNAL_ERROR"
)

type SkillError struct {
	code       string
	httpStatus int
	message    string
	cause      error
}

func (e *SkillError) Error() string {
	if e == nil {
		return ""
	}
	msg := strings.TrimSpace(e.message)
	if msg != "" {
		return msg
	}
	if e.cause != nil {
		return e.cause.Error()
	}
	return "skill operation failed"
}

func (e *SkillError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func (e *SkillError) Code() string {
	if e == nil {
		return ""
	}
	return strings.TrimSpace(e.code)
}

func (e *SkillError) HTTPStatus() int {
	if e == nil || e.httpStatus <= 0 {
		return http.StatusInternalServerError
	}
	return e.httpStatus
}

func newSkillError(code string, status int, message string, cause error) *SkillError {
	if status <= 0 {
		status = http.StatusInternalServerError
	}
	return &SkillError{
		code:       strings.TrimSpace(code),
		httpStatus: status,
		message:    strings.TrimSpace(message),
		cause:      cause,
	}
}

func AsSkillError(err error) (*SkillError, bool) {
	if err == nil {
		return nil, false
	}
	var out *SkillError
	if errors.As(err, &out) && out != nil {
		return out, true
	}
	return nil, false
}

func SkillErrorStatus(err error) int {
	if se, ok := AsSkillError(err); ok {
		return se.HTTPStatus()
	}
	return http.StatusInternalServerError
}

func SkillErrorCode(err error) string {
	if se, ok := AsSkillError(err); ok {
		return se.Code()
	}
	return ""
}

func firstNonEmpty(v ...string) string {
	for i := range v {
		if strings.TrimSpace(v[i]) != "" {
			return strings.TrimSpace(v[i])
		}
	}
	return ""
}

type SkillSourceType string

const (
	SkillSourceTypeLocalManual SkillSourceType = "local_manual"
	SkillSourceTypeGitHub      SkillSourceType = "github_import"
	SkillSourceTypeSystem      SkillSourceType = "system_bundle"
)

type SkillSourceRecord struct {
	SkillPath           string          `json:"skill_path"`
	SourceType          SkillSourceType `json:"source_type"`
	SourceID            string          `json:"source_id"`
	Repo                string          `json:"repo,omitempty"`
	Ref                 string          `json:"ref,omitempty"`
	RepoPath            string          `json:"repo_path,omitempty"`
	InstallMode         string          `json:"install_mode,omitempty"`
	InstalledCommit     string          `json:"installed_commit,omitempty"`
	InstalledAtUnixMs   int64           `json:"installed_at_unix_ms,omitempty"`
	LastCheckedAtUnixMs int64           `json:"last_checked_at_unix_ms,omitempty"`
}

type SkillSourcesView struct {
	Items []SkillSourceRecord `json:"items"`
}

type skillSourcesStateFile struct {
	SchemaVersion int                 `json:"schema_version"`
	Items         []SkillSourceRecord `json:"items,omitempty"`
}

type SkillGitHubCatalogRequest struct {
	Repo        string `json:"repo,omitempty"`
	Ref         string `json:"ref,omitempty"`
	BasePath    string `json:"base_path,omitempty"`
	ForceReload bool   `json:"force_reload,omitempty"`
}

type SkillGitHubCatalog struct {
	Source SkillGitHubCatalogSource `json:"source"`
	Skills []SkillGitHubCatalogItem `json:"skills"`
}

type SkillGitHubCatalogSource struct {
	Repo     string `json:"repo"`
	Ref      string `json:"ref"`
	BasePath string `json:"base_path"`
}

type SkillGitHubCatalogItem struct {
	RemoteID       string   `json:"remote_id"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	RepoPath       string   `json:"repo_path"`
	ExistsLocal    bool     `json:"exists_local"`
	InstalledPaths []string `json:"installed_paths,omitempty"`
}

type SkillGitHubAuth struct {
	GitHubToken            string `json:"github_token,omitempty"`
	UseLocalGitCredentials bool   `json:"use_local_git_credentials,omitempty"`
}

type SkillGitHubImportRequest struct {
	Scope     string          `json:"scope"`
	Repo      string          `json:"repo,omitempty"`
	Ref       string          `json:"ref,omitempty"`
	Paths     []string        `json:"paths,omitempty"`
	URL       string          `json:"url,omitempty"`
	Overwrite bool            `json:"overwrite,omitempty"`
	Auth      SkillGitHubAuth `json:"auth,omitempty"`
}

type SkillGitHubValidateResult struct {
	Resolved []SkillGitHubResolvedSkill `json:"resolved"`
}

type SkillGitHubResolvedSkill struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	Scope           string `json:"scope,omitempty"`
	Repo            string `json:"repo"`
	Ref             string `json:"ref"`
	RepoPath        string `json:"repo_path"`
	TargetDir       string `json:"target_dir"`
	TargetSkillPath string `json:"target_skill_path"`
	AlreadyExists   bool   `json:"already_exists"`
}

type SkillGitHubImportResult struct {
	Catalog SkillCatalog            `json:"catalog"`
	Imports []SkillGitHubImportItem `json:"imports"`
}

type SkillGitHubImportItem struct {
	Name            string          `json:"name"`
	Scope           string          `json:"scope"`
	SkillPath       string          `json:"skill_path"`
	SourceType      SkillSourceType `json:"source_type"`
	SourceID        string          `json:"source_id"`
	InstallMode     string          `json:"install_mode"`
	InstalledCommit string          `json:"installed_commit,omitempty"`
}

type SkillReinstallResult struct {
	Catalog     SkillCatalog         `json:"catalog"`
	Reinstalled []SkillReinstallItem `json:"reinstalled"`
}

type SkillReinstallItem struct {
	SkillPath   string `json:"skill_path"`
	SourceID    string `json:"source_id"`
	InstallMode string `json:"install_mode"`
}

type SkillBrowseTreeResult struct {
	Root    string                 `json:"root"`
	Dir     string                 `json:"dir"`
	Entries []SkillBrowseTreeEntry `json:"entries"`
}

type SkillBrowseTreeEntry struct {
	Name             string `json:"name"`
	Path             string `json:"path"`
	IsDir            bool   `json:"is_dir"`
	Size             int64  `json:"size"`
	ModifiedAtUnixMs int64  `json:"modified_at_unix_ms"`
}

type SkillBrowseFileResult struct {
	Root      string `json:"root"`
	File      string `json:"file"`
	Encoding  string `json:"encoding"`
	Truncated bool   `json:"truncated"`
	Size      int64  `json:"size"`
	Content   string `json:"content"`
}

type githubContentsEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

type resolvedGitHubImportInput struct {
	scope     string
	repo      string
	ref       string
	repoPaths []string
	overwrite bool
	auth      SkillGitHubAuth
}

func (m *skillManager) loadSourcesLocked() error {
	if m == nil || m.sourcesLoaded {
		return nil
	}
	m.sourcesLoaded = true
	m.sources = map[string]SkillSourceRecord{}
	if strings.TrimSpace(m.sourcePath) == "" {
		return nil
	}
	raw, err := os.ReadFile(m.sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var payload skillSourcesStateFile
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != nil {
		if err != io.EOF {
			return err
		}
	}
	for i := range payload.Items {
		item := payload.Items[i]
		p := filepath.Clean(strings.TrimSpace(item.SkillPath))
		if p == "" {
			continue
		}
		item.SkillPath = p
		item.SourceType = SkillSourceType(strings.TrimSpace(string(item.SourceType)))
		item.SourceID = strings.TrimSpace(item.SourceID)
		item.Repo = strings.TrimSpace(item.Repo)
		item.Ref = strings.TrimSpace(item.Ref)
		item.RepoPath = strings.TrimSpace(item.RepoPath)
		item.InstallMode = strings.TrimSpace(item.InstallMode)
		item.InstalledCommit = strings.TrimSpace(item.InstalledCommit)
		m.sources[p] = item
	}
	return nil
}

func (m *skillManager) saveSourcesLocked() error {
	if m == nil || strings.TrimSpace(m.sourcePath) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.sourcePath), 0o700); err != nil {
		return err
	}
	items := make([]SkillSourceRecord, 0, len(m.sources))
	for pathKey := range m.sources {
		item := m.sources[pathKey]
		p := filepath.Clean(strings.TrimSpace(item.SkillPath))
		if p == "" {
			continue
		}
		item.SkillPath = p
		item.SourceType = SkillSourceType(strings.TrimSpace(string(item.SourceType)))
		item.SourceID = strings.TrimSpace(item.SourceID)
		item.Repo = strings.TrimSpace(item.Repo)
		item.Ref = strings.TrimSpace(item.Ref)
		item.RepoPath = strings.TrimSpace(item.RepoPath)
		item.InstallMode = strings.TrimSpace(item.InstallMode)
		item.InstalledCommit = strings.TrimSpace(item.InstalledCommit)
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].SkillPath < items[j].SkillPath
	})
	payload := skillSourcesStateFile{SchemaVersion: 1}
	if len(items) > 0 {
		payload.Items = items
	}
	buf, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.sourcePath + ".tmp"
	if err := os.WriteFile(tmp, append(buf, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, m.sourcePath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (m *skillManager) pruneSourcesLocked() {
	if m == nil {
		return
	}
	if len(m.sources) == 0 {
		return
	}
	changed := false
	for p := range m.sources {
		_, err := os.Stat(p)
		if err == nil {
			continue
		}
		if !os.IsNotExist(err) {
			continue
		}
		delete(m.sources, p)
		changed = true
	}
	if changed {
		_ = m.saveSourcesLocked()
	}
}

func (m *skillManager) ListSources() (SkillSourcesView, error) {
	if m == nil {
		return SkillSourcesView{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	items := make([]SkillSourceRecord, 0, len(m.catalogEntries))
	for i := range m.catalogEntries {
		entry := m.catalogEntries[i]
		p := filepath.Clean(strings.TrimSpace(entry.Path))
		if p == "" {
			continue
		}
		item, ok := m.sources[p]
		if !ok {
			now := time.Now().UnixMilli()
			item = SkillSourceRecord{
				SkillPath:           p,
				SourceType:          SkillSourceTypeLocalManual,
				SourceID:            "local:" + entry.Scope + ":" + entry.Name,
				InstalledAtUnixMs:   now,
				LastCheckedAtUnixMs: now,
			}
		}
		item.SkillPath = p
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].SourceType == items[j].SourceType {
			return items[i].SkillPath < items[j].SkillPath
		}
		return string(items[i].SourceType) < string(items[j].SourceType)
	})
	return SkillSourcesView{Items: items}, nil
}

func (m *skillManager) ValidateGitHubImport(req SkillGitHubImportRequest) (SkillGitHubValidateResult, error) {
	if m == nil {
		return SkillGitHubValidateResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	input, err := m.resolveGitHubImportInputLocked(req)
	if err != nil {
		return SkillGitHubValidateResult{}, err
	}
	resolved, err := m.resolveGitHubSkillsLocked(input)
	if err != nil {
		return SkillGitHubValidateResult{}, err
	}
	return SkillGitHubValidateResult{Resolved: resolved}, nil
}

func (m *skillManager) ImportFromGitHub(req SkillGitHubImportRequest) (SkillGitHubImportResult, error) {
	if m == nil {
		return SkillGitHubImportResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	input, err := m.resolveGitHubImportInputLocked(req)
	if err != nil {
		return SkillGitHubImportResult{}, err
	}
	resolved, err := m.resolveGitHubSkillsLocked(input)
	if err != nil {
		return SkillGitHubImportResult{}, err
	}
	if len(resolved) == 0 {
		return SkillGitHubImportResult{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "no skills resolved from request", nil)
	}
	for i := range resolved {
		if resolved[i].AlreadyExists && !input.overwrite {
			return SkillGitHubImportResult{}, newSkillError(ErrCodeAISkillsSkillExists, http.StatusConflict, fmt.Sprintf("skill already exists: %s", resolved[i].Name), nil)
		}
	}

	tmpRoot, err := os.MkdirTemp("", "redeven-skill-import-*")
	if err != nil {
		return SkillGitHubImportResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to allocate temp dir", err)
	}
	defer os.RemoveAll(tmpRoot)

	extracted, installMode, commit, err := m.fetchGitHubSkillTreesLocked(input, resolved, tmpRoot)
	if err != nil {
		return SkillGitHubImportResult{}, err
	}

	imports := make([]SkillGitHubImportItem, 0, len(resolved))
	for i := range resolved {
		item := resolved[i]
		srcDir := extracted[item.RepoPath]
		if strings.TrimSpace(srcDir) == "" {
			return SkillGitHubImportResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "internal source mapping missing", nil)
		}
		if err := m.installOneSkillLocked(srcDir, item.TargetDir, input.overwrite); err != nil {
			return SkillGitHubImportResult{}, err
		}
		sourceID := buildGitHubSourceID(item.Repo, item.Ref, item.RepoPath)
		skillPath := filepath.Clean(item.TargetSkillPath)
		now := time.Now().UnixMilli()
		m.sources[skillPath] = SkillSourceRecord{
			SkillPath:           skillPath,
			SourceType:          SkillSourceTypeGitHub,
			SourceID:            sourceID,
			Repo:                item.Repo,
			Ref:                 item.Ref,
			RepoPath:            item.RepoPath,
			InstallMode:         installMode,
			InstalledCommit:     commit,
			InstalledAtUnixMs:   now,
			LastCheckedAtUnixMs: now,
		}
		imports = append(imports, SkillGitHubImportItem{
			Name:            item.Name,
			Scope:           input.scope,
			SkillPath:       skillPath,
			SourceType:      SkillSourceTypeGitHub,
			SourceID:        sourceID,
			InstallMode:     installMode,
			InstalledCommit: commit,
		})
	}

	if err := m.saveSourcesLocked(); err != nil {
		return SkillGitHubImportResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to persist skill source metadata", err)
	}
	m.discoverLocked()
	return SkillGitHubImportResult{Catalog: m.catalogLocked(), Imports: imports}, nil
}

func (m *skillManager) Reinstall(paths []string, overwrite bool) (SkillReinstallResult, error) {
	if m == nil {
		return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	if len(paths) == 0 {
		return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "missing paths", nil)
	}
	reinstalled := make([]SkillReinstallItem, 0, len(paths))
	for _, rawPath := range paths {
		skillPath := filepath.Clean(strings.TrimSpace(rawPath))
		if skillPath == "" {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "invalid skill path", nil)
		}
		source, ok := m.sources[skillPath]
		if !ok {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusUnprocessableEntity, fmt.Sprintf("skill source metadata missing: %s", skillPath), nil)
		}
		scope := m.scopeForSkillPathLocked(skillPath)
		if scope == "" {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsSkillNotFound, http.StatusNotFound, fmt.Sprintf("skill not found: %s", skillPath), nil)
		}
		if source.SourceType != SkillSourceTypeGitHub {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusUnprocessableEntity, fmt.Sprintf("skill source is not github import: %s", skillPath), nil)
		}
		if strings.TrimSpace(source.Repo) == "" || strings.TrimSpace(source.Ref) == "" || strings.TrimSpace(source.RepoPath) == "" {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusUnprocessableEntity, fmt.Sprintf("invalid github source metadata: %s", skillPath), nil)
		}
		importReq := SkillGitHubImportRequest{
			Scope:     scope,
			Repo:      source.Repo,
			Ref:       source.Ref,
			Paths:     []string{source.RepoPath},
			Overwrite: overwrite,
		}
		resolvedInput, err := m.resolveGitHubImportInputLocked(importReq)
		if err != nil {
			return SkillReinstallResult{}, err
		}
		resolved, err := m.resolveGitHubSkillsLocked(resolvedInput)
		if err != nil {
			return SkillReinstallResult{}, err
		}
		if len(resolved) != 1 {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "unexpected reinstall resolution size", nil)
		}
		if filepath.Clean(resolved[0].TargetSkillPath) != skillPath {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusUnprocessableEntity, fmt.Sprintf("reinstall target changed: %s", skillPath), nil)
		}

		tmpRoot, err := os.MkdirTemp("", "redeven-skill-reinstall-*")
		if err != nil {
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to allocate temp dir", err)
		}
		extracted, installMode, commit, err := m.fetchGitHubSkillTreesLocked(resolvedInput, resolved, tmpRoot)
		if err != nil {
			_ = os.RemoveAll(tmpRoot)
			return SkillReinstallResult{}, err
		}
		srcDir := extracted[resolved[0].RepoPath]
		if strings.TrimSpace(srcDir) == "" {
			_ = os.RemoveAll(tmpRoot)
			return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "internal source mapping missing", nil)
		}
		if err := m.installOneSkillLocked(srcDir, resolved[0].TargetDir, true); err != nil {
			_ = os.RemoveAll(tmpRoot)
			return SkillReinstallResult{}, err
		}
		_ = os.RemoveAll(tmpRoot)
		now := time.Now().UnixMilli()
		source.InstallMode = installMode
		source.InstalledCommit = commit
		source.LastCheckedAtUnixMs = now
		m.sources[skillPath] = source
		reinstalled = append(reinstalled, SkillReinstallItem{
			SkillPath:   skillPath,
			SourceID:    source.SourceID,
			InstallMode: installMode,
		})
	}
	if err := m.saveSourcesLocked(); err != nil {
		return SkillReinstallResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to persist skill source metadata", err)
	}
	m.discoverLocked()
	return SkillReinstallResult{Catalog: m.catalogLocked(), Reinstalled: reinstalled}, nil
}

func (m *skillManager) BrowseTree(skillPath string, dir string) (SkillBrowseTreeResult, error) {
	if m == nil {
		return SkillBrowseTreeResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	root, err := m.resolveSkillRootLocked(skillPath)
	if err != nil {
		return SkillBrowseTreeResult{}, err
	}
	relDir, err := normalizeSkillRelativePath(dir, true)
	if err != nil {
		return SkillBrowseTreeResult{}, err
	}
	targetDir := root
	if relDir != "." {
		targetDir = filepath.Join(root, filepath.FromSlash(relDir))
	}
	if err := ensurePathWithinRoot(root, targetDir); err != nil {
		return SkillBrowseTreeResult{}, newSkillError(ErrCodeAISkillsPathEscape, http.StatusUnprocessableEntity, "path escapes skill root", err)
	}
	entries, err := os.ReadDir(targetDir)
	if err != nil {
		if os.IsNotExist(err) {
			return SkillBrowseTreeResult{}, newSkillError(ErrCodeAISkillsSkillNotFound, http.StatusNotFound, "directory not found", err)
		}
		return SkillBrowseTreeResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to read skill directory", err)
	}
	out := make([]SkillBrowseTreeEntry, 0, len(entries))
	for _, entry := range entries {
		if entry == nil {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if name == "" {
			continue
		}
		abs := filepath.Join(targetDir, name)
		if err := ensurePathWithinRoot(root, abs); err != nil {
			continue
		}
		rel, err := filepath.Rel(root, abs)
		if err != nil {
			continue
		}
		rel = filepath.ToSlash(rel)
		info, infoErr := entry.Info()
		size := int64(0)
		modified := int64(0)
		if infoErr == nil && info != nil {
			if !entry.IsDir() {
				size = info.Size()
			}
			modified = info.ModTime().UnixMilli()
		}
		out = append(out, SkillBrowseTreeEntry{
			Name:             name,
			Path:             rel,
			IsDir:            entry.IsDir(),
			Size:             size,
			ModifiedAtUnixMs: modified,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return SkillBrowseTreeResult{Root: root, Dir: relDir, Entries: out}, nil
}

func (m *skillManager) BrowseFile(skillPath string, file string, encoding string, maxBytes int) (SkillBrowseFileResult, error) {
	if m == nil {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	root, err := m.resolveSkillRootLocked(skillPath)
	if err != nil {
		return SkillBrowseFileResult{}, err
	}
	relFile, err := normalizeSkillRelativePath(file, false)
	if err != nil {
		return SkillBrowseFileResult{}, err
	}
	encoding = strings.TrimSpace(strings.ToLower(encoding))
	if encoding == "" {
		encoding = "utf8"
	}
	if encoding != "utf8" && encoding != "base64" {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "invalid encoding", nil)
	}
	if maxBytes <= 0 {
		maxBytes = 1 << 20
	}
	if maxBytes > 10*1024*1024 {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsFileTooLarge, http.StatusUnprocessableEntity, "max_bytes exceeds allowed limit", nil)
	}
	abs := filepath.Join(root, filepath.FromSlash(relFile))
	if err := ensurePathWithinRoot(root, abs); err != nil {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsPathEscape, http.StatusUnprocessableEntity, "path escapes skill root", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsSkillNotFound, http.StatusNotFound, "file not found", err)
		}
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to read file metadata", err)
	}
	if info.IsDir() {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "target is a directory", nil)
	}
	if info.Size() > int64(10*1024*1024) {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsFileTooLarge, http.StatusUnprocessableEntity, "file exceeds maximum allowed size", nil)
	}
	f, err := os.Open(abs)
	if err != nil {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to open file", err)
	}
	defer f.Close()

	buf := make([]byte, maxBytes+1)
	n, readErr := io.ReadFull(f, buf)
	if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to read file", readErr)
	}
	truncated := n > maxBytes
	if truncated {
		n = maxBytes
	}
	contentRaw := buf[:n]
	content := ""
	if encoding == "utf8" {
		if !utf8.Valid(contentRaw) {
			return SkillBrowseFileResult{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusUnprocessableEntity, "file is not valid utf-8, use base64 encoding", nil)
		}
		content = string(contentRaw)
	} else {
		content = base64.StdEncoding.EncodeToString(contentRaw)
	}
	return SkillBrowseFileResult{
		Root:      root,
		File:      relFile,
		Encoding:  encoding,
		Truncated: truncated,
		Size:      info.Size(),
		Content:   content,
	}, nil
}

func (m *skillManager) resolveSkillRootLocked(skillPath string) (string, error) {
	skillPath = filepath.Clean(strings.TrimSpace(skillPath))
	if skillPath == "" {
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "missing skill_path", nil)
	}
	for i := range m.catalogEntries {
		entry := m.catalogEntries[i]
		if filepath.Clean(strings.TrimSpace(entry.Path)) == skillPath {
			return filepath.Dir(skillPath), nil
		}
	}
	return "", newSkillError(ErrCodeAISkillsBrowseForbidden, http.StatusNotFound, "skill not found in catalog", nil)
}

func (m *skillManager) scopeForSkillPathLocked(skillPath string) string {
	skillPath = filepath.Clean(strings.TrimSpace(skillPath))
	if skillPath == "" {
		return ""
	}
	for _, root := range m.roots() {
		rootDir := filepath.Clean(strings.TrimSpace(root.Path))
		if rootDir == "" {
			continue
		}
		rootPrefix := rootDir + string(os.PathSeparator)
		if strings.HasPrefix(skillPath, rootPrefix) {
			return root.Scope
		}
	}
	return ""
}

func (m *skillManager) ListGitHubCatalog(req SkillGitHubCatalogRequest) (SkillGitHubCatalog, error) {
	if m == nil {
		return SkillGitHubCatalog{}, newSkillError(ErrCodeAISkillsInternal, http.StatusServiceUnavailable, "skill manager unavailable", nil)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.discoverLocked()

	repo, err := normalizeGitHubRepo(firstNonEmpty(req.Repo, "openai/skills"))
	if err != nil {
		return SkillGitHubCatalog{}, err
	}
	ref := strings.TrimSpace(req.Ref)
	if ref == "" {
		ref = "main"
	}
	basePath := strings.TrimSpace(req.BasePath)
	if basePath == "" {
		basePath = "skills/.curated"
	}
	basePath, err = normalizeRepoPath(basePath)
	if err != nil {
		return SkillGitHubCatalog{}, err
	}
	entries, err := m.fetchGitHubContentsLocked(repo, ref, basePath, "")
	if err != nil {
		return SkillGitHubCatalog{}, err
	}
	if len(entries) == 0 {
		return SkillGitHubCatalog{Source: SkillGitHubCatalogSource{Repo: repo, Ref: ref, BasePath: basePath}, Skills: []SkillGitHubCatalogItem{}}, nil
	}

	installedBySourceID := map[string][]string{}
	for p, src := range m.sources {
		sourceID := strings.TrimSpace(src.SourceID)
		if sourceID == "" {
			continue
		}
		installedBySourceID[sourceID] = append(installedBySourceID[sourceID], p)
	}
	for sourceID := range installedBySourceID {
		sort.Strings(installedBySourceID[sourceID])
	}

	items := make([]SkillGitHubCatalogItem, 0, len(entries))
	for i := range entries {
		entry := entries[i]
		if strings.TrimSpace(entry.Type) != "dir" {
			continue
		}
		repoPath, err := normalizeRepoPath(entry.Path)
		if err != nil {
			continue
		}
		skillFilePath := path.Join(repoPath, "SKILL.md")
		skillRaw, err := m.fetchGitHubRawFileLocked(repo, ref, skillFilePath, "")
		if err != nil {
			continue
		}
		meta, err := parseSkillFrontmatter(skillRaw)
		if err != nil {
			continue
		}
		if strings.TrimSpace(meta.Name) != path.Base(repoPath) {
			continue
		}
		remoteID := buildGitHubSourceID(repo, ref, repoPath)
		installed := installedBySourceID[remoteID]
		items = append(items, SkillGitHubCatalogItem{
			RemoteID:       remoteID,
			Name:           meta.Name,
			Description:    meta.Description,
			RepoPath:       repoPath,
			ExistsLocal:    len(installed) > 0,
			InstalledPaths: append([]string(nil), installed...),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Name < items[j].Name
	})
	return SkillGitHubCatalog{
		Source: SkillGitHubCatalogSource{Repo: repo, Ref: ref, BasePath: basePath},
		Skills: items,
	}, nil
}

func (m *skillManager) resolveGitHubImportInputLocked(req SkillGitHubImportRequest) (resolvedGitHubImportInput, error) {
	scope := strings.TrimSpace(strings.ToLower(req.Scope))
	if _, err := m.scopeRootLocked(scope); err != nil {
		return resolvedGitHubImportInput{}, newSkillError(ErrCodeAISkillsInvalidScope, http.StatusBadRequest, err.Error(), err)
	}
	urlValue := strings.TrimSpace(req.URL)
	repoValue := strings.TrimSpace(req.Repo)
	hasURL := urlValue != ""
	hasRepoPath := repoValue != "" || len(req.Paths) > 0
	if hasURL && hasRepoPath {
		return resolvedGitHubImportInput{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "use either url or repo/ref/paths", nil)
	}
	if !hasURL && !hasRepoPath {
		return resolvedGitHubImportInput{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "missing github source", nil)
	}

	repo := ""
	ref := strings.TrimSpace(req.Ref)
	paths := make([]string, 0, len(req.Paths))
	if hasURL {
		parsedRepo, parsedRef, parsedPath, err := parseGitHubTreeURL(urlValue)
		if err != nil {
			return resolvedGitHubImportInput{}, err
		}
		repo = parsedRepo
		if ref == "" {
			ref = parsedRef
		}
		paths = append(paths, parsedPath)
	} else {
		normRepo, err := normalizeGitHubRepo(repoValue)
		if err != nil {
			return resolvedGitHubImportInput{}, err
		}
		repo = normRepo
		paths = append(paths, req.Paths...)
	}
	if ref == "" {
		ref = "main"
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return resolvedGitHubImportInput{}, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "missing github ref", nil)
	}

	dedup := map[string]struct{}{}
	normPaths := make([]string, 0, len(paths))
	for i := range paths {
		norm, err := normalizeRepoPath(paths[i])
		if err != nil {
			return resolvedGitHubImportInput{}, err
		}
		if strings.HasSuffix(norm, "/SKILL.md") {
			norm = path.Dir(norm)
		}
		if norm == "." {
			return resolvedGitHubImportInput{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "invalid github path", nil)
		}
		if _, exists := dedup[norm]; exists {
			continue
		}
		dedup[norm] = struct{}{}
		normPaths = append(normPaths, norm)
	}
	if len(normPaths) == 0 {
		return resolvedGitHubImportInput{}, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "missing github paths", nil)
	}
	sort.Strings(normPaths)

	return resolvedGitHubImportInput{
		scope:     scope,
		repo:      repo,
		ref:       ref,
		repoPaths: normPaths,
		overwrite: req.Overwrite,
		auth: SkillGitHubAuth{
			GitHubToken:            strings.TrimSpace(req.Auth.GitHubToken),
			UseLocalGitCredentials: req.Auth.UseLocalGitCredentials,
		},
	}, nil
}

func (m *skillManager) resolveGitHubSkillsLocked(input resolvedGitHubImportInput) ([]SkillGitHubResolvedSkill, error) {
	skillRoot, err := m.scopeRootLocked(input.scope)
	if err != nil {
		return nil, newSkillError(ErrCodeAISkillsInvalidScope, http.StatusBadRequest, err.Error(), err)
	}
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		return nil, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to create skill scope root", err)
	}
	resolved := make([]SkillGitHubResolvedSkill, 0, len(input.repoPaths))
	targets := map[string]struct{}{}
	for i := range input.repoPaths {
		repoPath := input.repoPaths[i]
		skillRaw, err := m.fetchGitHubRawFileLocked(input.repo, input.ref, path.Join(repoPath, "SKILL.md"), input.auth.GitHubToken)
		if err != nil {
			return nil, err
		}
		meta, err := parseSkillFrontmatter(skillRaw)
		if err != nil {
			return nil, newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("invalid SKILL.md frontmatter under %s", repoPath), err)
		}
		name := strings.TrimSpace(meta.Name)
		if !skillNameRE.MatchString(name) {
			return nil, newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("invalid skill name: %s", name), nil)
		}
		dirName := path.Base(repoPath)
		if name != dirName {
			return nil, newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("skill name %q does not match directory %q", name, dirName), nil)
		}
		targetDir := filepath.Join(skillRoot, name)
		targetSkillPath := filepath.Join(targetDir, "SKILL.md")
		if _, exists := targets[targetSkillPath]; exists {
			return nil, newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, fmt.Sprintf("duplicate install target: %s", targetSkillPath), nil)
		}
		targets[targetSkillPath] = struct{}{}
		alreadyExists := false
		if _, statErr := os.Stat(targetSkillPath); statErr == nil {
			alreadyExists = true
		} else if statErr != nil && !os.IsNotExist(statErr) {
			return nil, newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to inspect target path", statErr)
		}
		resolved = append(resolved, SkillGitHubResolvedSkill{
			Name:            name,
			Description:     strings.TrimSpace(meta.Description),
			Scope:           input.scope,
			Repo:            input.repo,
			Ref:             input.ref,
			RepoPath:        repoPath,
			TargetDir:       targetDir,
			TargetSkillPath: targetSkillPath,
			AlreadyExists:   alreadyExists,
		})
	}
	sort.Slice(resolved, func(i, j int) bool {
		return resolved[i].Name < resolved[j].Name
	})
	return resolved, nil
}

func (m *skillManager) fetchGitHubSkillTreesLocked(input resolvedGitHubImportInput, resolved []SkillGitHubResolvedSkill, tmpRoot string) (map[string]string, string, string, error) {
	extracted, commit, err := m.fetchGitHubSkillTreesByZipLocked(input, resolved, tmpRoot)
	if err == nil {
		return extracted, "zip", commit, nil
	}
	if se, ok := AsSkillError(err); ok {
		if se.Code() == ErrCodeAISkillsGitHubFetchFailed || se.Code() == ErrCodeAISkillsArchiveInvalid {
			fallback, commit2, fallbackErr := m.fetchGitHubSkillTreesByGitLocked(input, resolved, tmpRoot)
			if fallbackErr == nil {
				return fallback, "git", commit2, nil
			}
			return nil, "", "", fallbackErr
		}
	}
	return nil, "", "", err
}

func (m *skillManager) fetchGitHubSkillTreesByZipLocked(input resolvedGitHubImportInput, resolved []SkillGitHubResolvedSkill, tmpRoot string) (map[string]string, string, error) {
	archiveBytes, commit, err := m.fetchGitHubZipballLocked(input.repo, input.ref, input.auth.GitHubToken)
	if err != nil {
		return nil, "", err
	}
	zr, err := zip.NewReader(bytes.NewReader(archiveBytes), int64(len(archiveBytes)))
	if err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, "invalid github archive", err)
	}
	rootPrefix := ""
	for _, file := range zr.File {
		name := strings.TrimSpace(file.Name)
		if name == "" {
			continue
		}
		parts := strings.Split(name, "/")
		if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
			continue
		}
		rootPrefix = parts[0]
		break
	}
	if rootPrefix == "" {
		return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, "empty github archive", nil)
	}
	resolvedByRepoPath := map[string]SkillGitHubResolvedSkill{}
	for i := range resolved {
		resolvedByRepoPath[resolved[i].RepoPath] = resolved[i]
	}
	out := make(map[string]string, len(resolved))
	for i := range resolved {
		r := resolved[i]
		dst := filepath.Join(tmpRoot, "zip", r.Name)
		if err := os.MkdirAll(dst, 0o755); err != nil {
			return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to prepare temp skill dir", err)
		}
		archivePrefix := rootPrefix + "/" + r.RepoPath
		hit := false
		for _, zf := range zr.File {
			name := strings.TrimSpace(zf.Name)
			if name == "" {
				continue
			}
			if name == archivePrefix {
				hit = true
				continue
			}
			if !strings.HasPrefix(name, archivePrefix+"/") {
				continue
			}
			hit = true
			rel := strings.TrimPrefix(name, archivePrefix+"/")
			rel = strings.TrimSpace(rel)
			if rel == "" {
				continue
			}
			rel = path.Clean(rel)
			if rel == "." {
				continue
			}
			if rel == ".." || strings.HasPrefix(rel, "../") {
				return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, "archive contains path escape", nil)
			}
			target := filepath.Join(dst, filepath.FromSlash(rel))
			if err := ensurePathWithinRoot(dst, target); err != nil {
				return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, "archive target escapes destination", err)
			}
			if zf.FileInfo().IsDir() {
				if err := os.MkdirAll(target, 0o755); err != nil {
					return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to create skill directory", err)
				}
				continue
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to prepare target file directory", err)
			}
			rc, openErr := zf.Open()
			if openErr != nil {
				return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, "failed to read archive entry", openErr)
			}
			data, readErr := io.ReadAll(rc)
			_ = rc.Close()
			if readErr != nil {
				return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, "failed to extract archive entry", readErr)
			}
			if writeErr := os.WriteFile(target, data, 0o600); writeErr != nil {
				return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to write extracted skill file", writeErr)
			}
		}
		if !hit {
			return nil, "", newSkillError(ErrCodeAISkillsArchiveInvalid, http.StatusUnprocessableEntity, fmt.Sprintf("skill path not found in archive: %s", r.RepoPath), nil)
		}
		skillFile := filepath.Join(dst, "SKILL.md")
		meta, _, parseErr := parseSkillFile(skillFile, r.Scope)
		if parseErr != nil {
			return nil, "", newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("invalid SKILL.md in %s", r.RepoPath), parseErr)
		}
		if meta.Name != r.Name {
			return nil, "", newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("skill name mismatch after extraction: %s", r.RepoPath), nil)
		}
		if _, ok := resolvedByRepoPath[r.RepoPath]; !ok {
			return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "internal mapping mismatch", nil)
		}
		out[r.RepoPath] = dst
	}
	return out, commit, nil
}

func (m *skillManager) fetchGitHubSkillTreesByGitLocked(input resolvedGitHubImportInput, resolved []SkillGitHubResolvedSkill, tmpRoot string) (map[string]string, string, error) {
	repoDir := filepath.Join(tmpRoot, "git")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to prepare git temp dir", err)
	}
	repoURL := strings.TrimRight(strings.TrimSpace(m.githubRepoBaseURL), "/") + "/" + input.repo + ".git"
	if err := runGit(repoDir, input.auth.GitHubToken, "init"); err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, "git init failed", err)
	}
	if err := runGit(repoDir, "", "remote", "add", "origin", repoURL); err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, "git remote add failed", err)
	}
	if err := runGit(repoDir, "", "sparse-checkout", "init", "--cone"); err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, "git sparse-checkout init failed", err)
	}
	setArgs := []string{"sparse-checkout", "set"}
	setArgs = append(setArgs, input.repoPaths...)
	if err := runGit(repoDir, "", setArgs...); err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, "git sparse-checkout set failed", err)
	}
	fetchErr := runGit(repoDir, input.auth.GitHubToken, "fetch", "--depth", "1", "origin", input.ref)
	if fetchErr != nil {
		if input.auth.UseLocalGitCredentials {
			sshURL := "git@github.com:" + input.repo + ".git"
			_ = runGit(repoDir, "", "remote", "set-url", "origin", sshURL)
			fetchErr = runGit(repoDir, "", "fetch", "--depth", "1", "origin", input.ref)
		}
		if fetchErr != nil {
			return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, "git sparse checkout failed", fetchErr)
		}
	}
	if err := runGit(repoDir, "", "checkout", "FETCH_HEAD"); err != nil {
		return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, "git checkout failed", err)
	}
	commit := strings.TrimSpace(runGitCapture(repoDir, "", "rev-parse", "HEAD"))

	out := make(map[string]string, len(resolved))
	for i := range resolved {
		r := resolved[i]
		src := filepath.Join(repoDir, filepath.FromSlash(r.RepoPath))
		skillFile := filepath.Join(src, "SKILL.md")
		if _, err := os.Stat(skillFile); err != nil {
			return nil, "", newSkillError(ErrCodeAISkillsGitFallbackFailed, http.StatusServiceUnavailable, fmt.Sprintf("missing SKILL.md in git checkout for %s", r.RepoPath), err)
		}
		dst := filepath.Join(tmpRoot, "git-copy", r.Name)
		if err := copyDirectory(src, dst); err != nil {
			return nil, "", newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to copy git checkout skill files", err)
		}
		meta, _, parseErr := parseSkillFile(filepath.Join(dst, "SKILL.md"), r.Scope)
		if parseErr != nil {
			return nil, "", newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("invalid SKILL.md in %s", r.RepoPath), parseErr)
		}
		if meta.Name != r.Name {
			return nil, "", newSkillError(ErrCodeAISkillsFrontmatterBad, http.StatusUnprocessableEntity, fmt.Sprintf("skill name mismatch after git checkout: %s", r.RepoPath), nil)
		}
		out[r.RepoPath] = dst
	}
	return out, commit, nil
}

func runGit(dir string, token string, args ...string) error {
	cmdArgs := make([]string, 0, len(args)+2)
	if strings.TrimSpace(token) != "" {
		header := "http.extraheader=Authorization: Bearer " + strings.TrimSpace(token)
		cmdArgs = append(cmdArgs, "-c", header)
	}
	cmdArgs = append(cmdArgs, args...)
	cmd := exec.Command("git", cmdArgs...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("git command failed: %s", msg)
	}
	return nil
}

func runGitCapture(dir string, token string, args ...string) string {
	cmdArgs := make([]string, 0, len(args)+2)
	if strings.TrimSpace(token) != "" {
		header := "http.extraheader=Authorization: Bearer " + strings.TrimSpace(token)
		cmdArgs = append(cmdArgs, "-c", header)
	}
	cmdArgs = append(cmdArgs, args...)
	cmd := exec.Command("git", cmdArgs...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (m *skillManager) installOneSkillLocked(srcDir string, targetDir string, overwrite bool) error {
	srcDir = filepath.Clean(strings.TrimSpace(srcDir))
	targetDir = filepath.Clean(strings.TrimSpace(targetDir))
	if srcDir == "" || targetDir == "" {
		return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "invalid install path", nil)
	}
	skillFile := filepath.Join(srcDir, "SKILL.md")
	if _, err := os.Stat(skillFile); err != nil {
		return newSkillError(ErrCodeAISkillsSkillNotFound, http.StatusNotFound, "source skill files incomplete", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetDir), 0o755); err != nil {
		return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to prepare destination root", err)
	}
	staging := targetDir + ".incoming." + strconv.FormatInt(time.Now().UnixNano(), 10)
	if err := copyDirectory(srcDir, staging); err != nil {
		return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to stage skill files", err)
	}
	defer os.RemoveAll(staging)

	_, statErr := os.Stat(targetDir)
	targetExists := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to inspect target skill directory", statErr)
	}
	if targetExists && !overwrite {
		return newSkillError(ErrCodeAISkillsSkillExists, http.StatusConflict, fmt.Sprintf("skill already exists: %s", filepath.Base(targetDir)), nil)
	}
	if !targetExists {
		if err := os.Rename(staging, targetDir); err != nil {
			return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to install skill", err)
		}
		return nil
	}
	backup := targetDir + ".backup." + strconv.FormatInt(time.Now().UnixNano(), 10)
	if err := os.Rename(targetDir, backup); err != nil {
		return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to prepare overwrite backup", err)
	}
	if err := os.Rename(staging, targetDir); err != nil {
		_ = os.Rename(backup, targetDir)
		return newSkillError(ErrCodeAISkillsInternal, http.StatusInternalServerError, "failed to replace skill", err)
	}
	_ = os.RemoveAll(backup)
	return nil
}

func copyDirectory(src string, dst string) error {
	src = filepath.Clean(strings.TrimSpace(src))
	dst = filepath.Clean(strings.TrimSpace(dst))
	if src == "" || dst == "" {
		return fmt.Errorf("invalid copy directory arguments")
	}
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(pathAbs string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, pathAbs)
		if err != nil {
			return err
		}
		rel = filepath.Clean(rel)
		if rel == "." {
			return os.MkdirAll(dst, 0o755)
		}
		target := filepath.Join(dst, rel)
		if err := ensurePathWithinRoot(dst, target); err != nil {
			return err
		}
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		data, err := os.ReadFile(pathAbs)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o600)
	})
}

func ensurePathWithinRoot(root string, target string) error {
	root = filepath.Clean(strings.TrimSpace(root))
	target = filepath.Clean(strings.TrimSpace(target))
	if root == "" || target == "" {
		return fmt.Errorf("empty path")
	}
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return err
	}
	rel = filepath.Clean(rel)
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("path escapes root")
	}
	return nil
}

func (m *skillManager) fetchGitHubContentsLocked(repo string, ref string, repoPath string, token string) ([]githubContentsEntry, error) {
	repo = strings.TrimSpace(repo)
	ref = strings.TrimSpace(ref)
	repoPath = strings.TrimSpace(repoPath)
	if repo == "" || ref == "" || repoPath == "" {
		return nil, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github catalog request", nil)
	}
	apiBase := strings.TrimRight(strings.TrimSpace(m.githubAPIBaseURL), "/")
	endpoint := fmt.Sprintf("%s/repos/%s/contents/%s?ref=%s", apiBase, repo, escapeURLPath(repoPath), url.QueryEscape(ref))
	respBody, statusCode, err := m.doGitHubRequestLocked(endpoint, token)
	if err != nil {
		return nil, err
	}
	if statusCode != http.StatusOK {
		return nil, newSkillError(ErrCodeAISkillsGitHubFetchFailed, http.StatusServiceUnavailable, "failed to fetch github catalog", fmt.Errorf("status %d", statusCode))
	}
	var entries []githubContentsEntry
	if err := json.Unmarshal(respBody, &entries); err != nil {
		return nil, newSkillError(ErrCodeAISkillsGitHubFetchFailed, http.StatusServiceUnavailable, "failed to parse github catalog", err)
	}
	return entries, nil
}

func (m *skillManager) fetchGitHubRawFileLocked(repo string, ref string, repoPath string, token string) (string, error) {
	repo = strings.TrimSpace(repo)
	ref = strings.TrimSpace(ref)
	repoPath = strings.TrimSpace(repoPath)
	if repo == "" || ref == "" || repoPath == "" {
		return "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github raw file request", nil)
	}
	rawBase := strings.TrimRight(strings.TrimSpace(m.githubRawBaseURL), "/")
	endpoint := fmt.Sprintf("%s/%s/%s/%s", rawBase, repo, url.PathEscape(ref), escapeURLPath(repoPath))
	body, statusCode, err := m.doGitHubRequestLocked(endpoint, token)
	if err != nil {
		return "", err
	}
	if statusCode == http.StatusNotFound {
		return "", newSkillError(ErrCodeAISkillsSkillNotFound, http.StatusNotFound, "SKILL.md not found in remote path", nil)
	}
	if statusCode != http.StatusOK {
		return "", newSkillError(ErrCodeAISkillsGitHubFetchFailed, http.StatusServiceUnavailable, "failed to fetch SKILL.md from github", fmt.Errorf("status %d", statusCode))
	}
	return string(body), nil
}

func (m *skillManager) fetchGitHubZipballLocked(repo string, ref string, token string) ([]byte, string, error) {
	parts := strings.Split(repo, "/")
	if len(parts) != 2 {
		return nil, "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github repository", nil)
	}
	apiBase := strings.TrimRight(strings.TrimSpace(m.githubAPIBaseURL), "/")
	endpoint := fmt.Sprintf("%s/repos/%s/%s/zipball/%s", apiBase, url.PathEscape(parts[0]), url.PathEscape(parts[1]), url.PathEscape(ref))
	body, statusCode, err := m.doGitHubRequestLocked(endpoint, token)
	if err != nil {
		return nil, "", err
	}
	if statusCode != http.StatusOK {
		return nil, "", newSkillError(ErrCodeAISkillsGitHubFetchFailed, http.StatusServiceUnavailable, "failed to download github zip archive", fmt.Errorf("status %d", statusCode))
	}
	return body, "", nil
}

func (m *skillManager) doGitHubRequestLocked(endpoint string, token string) ([]byte, int, error) {
	client := m.httpClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
		m.httpClient = client
	}
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, 0, newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github endpoint", err)
	}
	req.Header.Set("User-Agent", "redeven-agent-skill-manager")
	req.Header.Set("Accept", "application/vnd.github+json")
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, newSkillError(ErrCodeAISkillsGitHubFetchFailed, http.StatusServiceUnavailable, "github request failed", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, newSkillError(ErrCodeAISkillsGitHubFetchFailed, http.StatusServiceUnavailable, "failed to read github response", err)
	}
	return body, resp.StatusCode, nil
}

func parseSkillFrontmatter(raw string) (skillFrontmatter, error) {
	frontmatterRaw, _, ok := splitFrontmatter(raw)
	if !ok {
		return skillFrontmatter{}, fmt.Errorf("missing frontmatter")
	}
	var fm skillFrontmatter
	if err := yamlUnmarshal([]byte(frontmatterRaw), &fm); err != nil {
		return skillFrontmatter{}, err
	}
	fm.Name = strings.TrimSpace(fm.Name)
	fm.Description = strings.TrimSpace(fm.Description)
	if fm.Name == "" || fm.Description == "" {
		return skillFrontmatter{}, fmt.Errorf("invalid frontmatter")
	}
	return fm, nil
}

func normalizeGitHubRepo(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	parts := strings.Split(v, "/")
	if len(parts) != 2 {
		return "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github repo, expected <owner>/<repo>", nil)
	}
	owner := strings.TrimSpace(parts[0])
	repo := strings.TrimSpace(parts[1])
	if owner == "" || repo == "" {
		return "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github repo, expected <owner>/<repo>", nil)
	}
	if strings.Contains(owner, " ") || strings.Contains(repo, " ") {
		return "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github repo, spaces are not allowed", nil)
	}
	return owner + "/" + repo, nil
}

func normalizeRepoPath(raw string) (string, error) {
	v := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if v == "" {
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "invalid github path", nil)
	}
	if strings.HasPrefix(v, "/") {
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "github path must be relative", nil)
	}
	cleaned := path.Clean(v)
	if cleaned == "." || cleaned == "" {
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "invalid github path", nil)
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", newSkillError(ErrCodeAISkillsPathEscape, http.StatusUnprocessableEntity, "github path escapes repository root", nil)
	}
	return cleaned, nil
}

func normalizeSkillRelativePath(raw string, allowDot bool) (string, error) {
	v := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if v == "" {
		if allowDot {
			return ".", nil
		}
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "missing relative path", nil)
	}
	if strings.HasPrefix(v, "/") {
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "path must be relative", nil)
	}
	cleaned := path.Clean(v)
	if cleaned == "." {
		if allowDot {
			return ".", nil
		}
		return "", newSkillError(ErrCodeAISkillsInvalidPath, http.StatusBadRequest, "file path is required", nil)
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", newSkillError(ErrCodeAISkillsPathEscape, http.StatusUnprocessableEntity, "path escapes skill root", nil)
	}
	return cleaned, nil
}

func parseGitHubTreeURL(raw string) (string, string, string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "", "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github url", err)
	}
	host := strings.ToLower(strings.TrimSpace(u.Host))
	if host != "github.com" && host != "www.github.com" {
		return "", "", "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "github url host must be github.com", nil)
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 5 {
		return "", "", "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github tree url", nil)
	}
	owner := strings.TrimSpace(parts[0])
	repo := strings.TrimSpace(parts[1])
	mode := strings.TrimSpace(parts[2])
	if mode != "tree" && mode != "blob" {
		return "", "", "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "unsupported github url path", nil)
	}
	ref := strings.TrimSpace(parts[3])
	repoPath := strings.Join(parts[4:], "/")
	if owner == "" || repo == "" || ref == "" || strings.TrimSpace(repoPath) == "" {
		return "", "", "", newSkillError(ErrCodeAISkillsInvalidSource, http.StatusBadRequest, "invalid github tree url", nil)
	}
	normRepo, err := normalizeGitHubRepo(owner + "/" + repo)
	if err != nil {
		return "", "", "", err
	}
	normPath, err := normalizeRepoPath(repoPath)
	if err != nil {
		return "", "", "", err
	}
	return normRepo, ref, normPath, nil
}

func escapeURLPath(v string) string {
	parts := strings.Split(strings.Trim(v, "/"), "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, url.PathEscape(part))
	}
	return strings.Join(out, "/")
}

func buildGitHubSourceID(repo string, ref string, repoPath string) string {
	return fmt.Sprintf("github:%s@%s:%s", strings.TrimSpace(repo), strings.TrimSpace(ref), strings.TrimSpace(repoPath))
}

// yamlUnmarshal is split for tests and to keep a single dependency call site in this file.
func yamlUnmarshal(raw []byte, out any) error {
	return yaml.Unmarshal(raw, out)
}
