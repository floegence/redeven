package boundarycontract

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
)

const RegistryVersion = 1

type Registry struct {
	Version int             `json:"version"`
	Entries []RegistryEntry `json:"entries"`
}

type RegistryEntry struct {
	Path        string   `json:"path"`
	SHA256      string   `json:"sha256"`
	SinkKinds   []string `json:"sink_kinds"`
	Owner       string   `json:"owner"`
	Authority   string   `json:"authority"`
	DataClasses []string `json:"data_classes"`
	Tables      []string `json:"tables,omitempty"`
	Keys        []string `json:"keys,omitempty"`
	Codecs      []string `json:"codecs,omitempty"`
	DTOs        []string `json:"dtos,omitempty"`
	ReviewNote  string   `json:"review_note"`
}

type Finding struct {
	Path      string
	SHA256    string
	SinkKinds []string
	Tables    []string
	Keys      []string
	Codecs    []string
	DTOs      []string
}

var allowedAuthorities = map[string]struct{}{
	"build_or_test_artifact": {},
	"browser_ui_preference":  {},
	"diagnostics":            {},
	"product_configuration":  {},
	"product_coordination":   {},
	"product_resource":       {},
	"security_audit":         {},
	"upstream_adapter":       {},
	"user_effect":            {},
}

var (
	sqlMutationPattern  = regexp.MustCompile(`(?is)\b(?:create\s+(?:table|index|trigger)|alter\s+table|drop\s+(?:table|index|trigger)|insert\s+into|replace\s+into|update\s+[a-z_][a-z0-9_]*\s+set|delete\s+from)\b`)
	sqlTablePattern     = regexp.MustCompile(`(?is)\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|insert\s+into|replace\s+into|update|delete\s+from)\s+[\x60"\[]?([a-z_][a-z0-9_]*)`)
	sqlReadTablePattern = regexp.MustCompile(`(?is)\b(?:from|join)\s+[\x60"\[]?([a-z_][a-z0-9_]*)`)
	webStoragePattern   = regexp.MustCompile(`(?m)\b(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|removeItem|clear)\s*\(`)
	indexedDBPattern    = regexp.MustCompile(`(?m)\bindexedDB\s*\.\s*(?:open|deleteDatabase)\s*\(`)
	cacheStoragePattern = regexp.MustCompile(
		`(?m)(?:\bcaches\s*\.\s*(?:open|delete)\s*\(|\bCacheStorage\b)`,
	)
	typeScriptFilePattern = regexp.MustCompile(`(?m)\b(?:fs|promises)\s*\.\s*(?:writeFile|appendFile|open|createWriteStream|rename)\s*\(`)
	browserCallArgPattern = regexp.MustCompile(`(?m)\b(?:(?:window\s*\.\s*)?(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|removeItem)\s*\(\s*([^,\)\n]+)|indexedDB\s*\.\s*(?:open|deleteDatabase)\s*\(\s*([^,\)\n]+)|caches\s*\.\s*(?:open|delete)\s*\(\s*([^,\)\n]+))`)
)

var forbiddenAgentDataClassPatterns = []string{
	"admitted message", "agent lifecycle", "approval lifecycle", "approval state",
	"assistant message", "assistant output", "canonical message", "canonical reference mapping",
	"context snapshot", "conversation history", "provider continuation", "provider state",
	"run lifecycle", "run status", "thread projection", "todo state", "tool lifecycle",
	"tool result", "turn lifecycle", "turn status",
}

var forbiddenAgentStorageIdentifiers = []string{
	"admitted_message", "agent_lifecycle", "ai_messages", "ai_runs", "ai_thread_checkpoints",
	"ai_thread_state", "ai_thread_todos", "ai_tool_calls", "approval_lifecycle",
	"assistant_message", "assistant_output", "canonical_message", "context_snapshot",
	"conversation_history", "conversation_turns", "provider_continuation", "provider_state",
	"run_lifecycle", "run_status", "thread_projection", "todo_state", "tool_lifecycle",
	"tool_result", "transcript_messages", "turn_lifecycle", "turn_status",
}

func LoadRegistry(path string) (Registry, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return Registry{}, err
	}
	var registry Registry
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&registry); err != nil {
		return Registry{}, fmt.Errorf("decode durable sink registry: %w", err)
	}
	return registry, nil
}

func Scan(root string) ([]Finding, error) {
	root = filepath.Clean(root)
	var findings []Finding
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			if shouldSkipDirectory(rel, entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if shouldSkipFile(rel) {
			return nil
		}
		extension := strings.ToLower(filepath.Ext(rel))
		if extension != ".go" && extension != ".sql" && extension != ".ts" && extension != ".tsx" {
			return nil
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		finding, err := inspectSource(rel, source)
		if err != nil {
			return err
		}
		if len(finding.SinkKinds) == 0 {
			return nil
		}
		digest := sha256.Sum256(source)
		finding.Path = rel
		finding.SHA256 = hex.EncodeToString(digest[:])
		findings = append(findings, finding)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].Path < findings[j].Path })
	return findings, nil
}

func Validate(registry Registry, findings []Finding) []string {
	var issues []string
	if registry.Version != RegistryVersion {
		issues = append(issues, fmt.Sprintf("registry version=%d, want %d", registry.Version, RegistryVersion))
	}
	registered := make(map[string]RegistryEntry, len(registry.Entries))
	for _, entry := range registry.Entries {
		entry.Path = filepath.ToSlash(strings.TrimSpace(entry.Path))
		if entry.Path == "" {
			issues = append(issues, "registry contains an entry with an empty path")
			continue
		}
		if _, exists := registered[entry.Path]; exists {
			issues = append(issues, fmt.Sprintf("registry path %s is duplicated", entry.Path))
			continue
		}
		registered[entry.Path] = entry
		issues = append(issues, validateEntry(entry)...)
	}
	for _, finding := range findings {
		entry, ok := registered[finding.Path]
		if !ok {
			issues = append(issues, fmt.Sprintf("unregistered durable sink file %s (%s)", finding.Path, strings.Join(finding.SinkKinds, ",")))
			continue
		}
		delete(registered, finding.Path)
		if entry.SHA256 != finding.SHA256 {
			issues = append(issues, fmt.Sprintf("durable sink file %s changed after review", finding.Path))
		}
		if !reflect.DeepEqual(sortedCopy(entry.SinkKinds), finding.SinkKinds) {
			issues = append(issues, fmt.Sprintf("durable sink kinds for %s are %v, registered %v", finding.Path, finding.SinkKinds, sortedCopy(entry.SinkKinds)))
		}
		issues = append(issues, compareReviewedInventory(finding.Path, "tables", entry.Tables, finding.Tables)...)
		issues = append(issues, compareReviewedInventory(finding.Path, "keys", entry.Keys, finding.Keys)...)
		issues = append(issues, compareReviewedInventory(finding.Path, "codecs", entry.Codecs, finding.Codecs)...)
		issues = append(issues, compareReviewedInventory(finding.Path, "DTOs", entry.DTOs, finding.DTOs)...)
	}
	for path := range registered {
		issues = append(issues, fmt.Sprintf("stale durable sink registry entry %s", path))
	}
	sort.Strings(issues)
	return issues
}

func NewReviewedEntry(finding Finding) RegistryEntry {
	entry := RegistryEntry{
		Path:        finding.Path,
		SHA256:      finding.SHA256,
		SinkKinds:   append([]string(nil), finding.SinkKinds...),
		Owner:       "redeven",
		Authority:   "product_configuration",
		DataClasses: []string{"product-owned state"},
		ReviewNote:  "Reviewed durable product state; canonical Agent lifecycle data is excluded.",
		Tables:      append([]string(nil), finding.Tables...),
		Keys:        append([]string(nil), finding.Keys...),
		Codecs:      append([]string(nil), finding.Codecs...),
		DTOs:        append([]string(nil), finding.DTOs...),
	}
	path := finding.Path
	switch {
	case strings.HasPrefix(path, "internal/ai/threadstore/"):
		entry.Owner = "redeven threadstore"
		entry.Authority = "product_coordination"
		entry.DataClasses = []string{"host thread settings", "unadmitted commands", "product routing", "resource claims", "cross-store operation intent", "permission audit"}
		entry.ReviewNote = "Stores only Redeven-owned product settings, resources, audit, unadmitted commands, and coordination intent; Floret remains canonical after admission."
	case strings.HasPrefix(path, "internal/auditlog/"):
		entry.Owner = "redeven audit log"
		entry.Authority = "security_audit"
		entry.DataClasses = []string{"append-only product security audit"}
	case strings.HasPrefix(path, "internal/diagnostics/"):
		entry.Owner = "redeven diagnostics"
		entry.Authority = "diagnostics"
		entry.DataClasses = []string{"bounded product diagnostics"}
	case strings.Contains(path, "/ui_src/") || strings.HasPrefix(path, "internal/flower_ui/"):
		entry.Owner = "redeven UI"
		entry.Authority = "browser_ui_preference"
		entry.DataClasses = []string{"product UI preference or cache"}
	case strings.HasPrefix(path, "desktop/"):
		entry.Owner = "redeven Desktop"
		entry.Authority = "product_configuration"
		entry.DataClasses = []string{"Desktop preferences, runtime handoff, download, or product cache"}
	case strings.HasPrefix(path, "internal/ai/uploads.go"):
		entry.Owner = "redeven uploads"
		entry.Authority = "product_resource"
		entry.DataClasses = []string{"user-owned upload bytes"}
	case strings.HasPrefix(path, "internal/ai/structured_tools.go") || strings.HasPrefix(path, "internal/ai/unified_diff_apply.go"):
		entry.Owner = "redeven tool effect"
		entry.Authority = "user_effect"
		entry.DataClasses = []string{"explicitly authorized user filesystem effect"}
	case strings.HasPrefix(path, "internal/redevpluginintegration/"):
		entry.Owner = "redeven ReDevPlugin adapter"
		entry.Authority = "upstream_adapter"
		entry.DataClasses = []string{"product adapter audit, trust, or lifecycle records"}
	case strings.HasPrefix(path, "cmd/ai-loop-") || strings.HasPrefix(path, "cmd/okf-") || strings.HasPrefix(path, "internal/okf/") || strings.HasPrefix(path, "internal/testutil/"):
		entry.Owner = "redeven developer tooling"
		entry.Authority = "build_or_test_artifact"
		entry.DataClasses = []string{"developer-owned generated or test artifact"}
	}
	return entry
}

func inspectSource(path string, source []byte) (Finding, error) {
	kinds := map[string]struct{}{}
	var tables, keys, codecs, dtos []string
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		fileSet := token.NewFileSet()
		file, err := parser.ParseFile(fileSet, path, source, parser.SkipObjectResolution)
		if err != nil {
			return Finding{}, fmt.Errorf("parse %s: %w", path, err)
		}
		hasFileSink := false
		hasJSONCodec := false
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			packageName := selectorRootName(selector.X)
			switch {
			case packageName == "os" && contains([]string{"WriteFile", "Create", "CreateTemp", "OpenFile"}, selector.Sel.Name):
				hasFileSink = true
			case packageName == "sql" && selector.Sel.Name == "Open":
				kinds["sqlite"] = struct{}{}
			case packageName == "json" && contains([]string{"Marshal", "MarshalIndent", "NewEncoder"}, selector.Sel.Name):
				hasJSONCodec = true
				codecs = append(codecs, "encoding/json."+selector.Sel.Name)
				if len(call.Args) > 0 && selector.Sel.Name != "NewEncoder" {
					dtos = append(dtos, renderExpression(fileSet, call.Args[0]))
				}
			case selector.Sel.Name == "Encode" && len(call.Args) > 0:
				dtos = append(dtos, renderExpression(fileSet, call.Args[0]))
			}
			return true
		})
		if hasFileSink {
			kinds["file"] = struct{}{}
			if hasJSONCodec {
				kinds["json_file"] = struct{}{}
			}
		}
		if sqlMutationPattern.Match(source) {
			kinds["sqlite"] = struct{}{}
		}
		tables = extractSQLTables(source)
	case ".sql":
		if sqlMutationPattern.Match(source) {
			kinds["sql_file"] = struct{}{}
		}
		tables = extractSQLTables(source)
	case ".ts", ".tsx":
		if webStoragePattern.Match(source) {
			kinds["web_storage"] = struct{}{}
		}
		if indexedDBPattern.Match(source) {
			kinds["indexed_db"] = struct{}{}
		}
		if cacheStoragePattern.Match(source) {
			kinds["cache_storage"] = struct{}{}
		}
		if typeScriptFilePattern.Match(source) {
			kinds["file"] = struct{}{}
		}
		keys = extractBrowserKeys(source)
	}
	result := make([]string, 0, len(kinds))
	for kind := range kinds {
		result = append(result, kind)
	}
	sort.Strings(result)
	return Finding{
		SinkKinds: result,
		Tables:    uniqueSorted(tables),
		Keys:      uniqueSorted(keys),
		Codecs:    uniqueSorted(codecs),
		DTOs:      uniqueSorted(dtos),
	}, nil
}

func validateEntry(entry RegistryEntry) []string {
	var issues []string
	if len(entry.SHA256) != 64 {
		issues = append(issues, fmt.Sprintf("registry entry %s has invalid SHA-256", entry.Path))
	}
	if len(entry.SinkKinds) == 0 || strings.TrimSpace(entry.Owner) == "" || len(entry.DataClasses) == 0 || strings.TrimSpace(entry.ReviewNote) == "" {
		issues = append(issues, fmt.Sprintf("registry entry %s is missing review metadata", entry.Path))
	}
	if _, ok := allowedAuthorities[entry.Authority]; !ok {
		issues = append(issues, fmt.Sprintf("registry entry %s has unsupported authority %q", entry.Path, entry.Authority))
	}
	declaredData := strings.ToLower(strings.Join(entry.DataClasses, " "))
	for _, forbidden := range forbiddenAgentDataClassPatterns {
		if strings.Contains(declaredData, forbidden) {
			issues = append(issues, fmt.Sprintf("registry entry %s declares forbidden Floret-owned data class %q", entry.Path, forbidden))
		}
	}
	storageInventory := append(append(append([]string(nil), entry.Tables...), entry.Keys...), entry.DTOs...)
	for _, identifier := range storageInventory {
		normalized := normalizeStorageIdentifier(identifier)
		for _, forbidden := range forbiddenAgentStorageIdentifiers {
			if strings.Contains(normalized, normalizeStorageIdentifier(forbidden)) {
				issues = append(issues, fmt.Sprintf("registry entry %s declares forbidden Agent shadow storage identifier %q", entry.Path, forbidden))
			}
		}
	}
	if (contains(entry.SinkKinds, "sqlite") || contains(entry.SinkKinds, "sql_file")) && len(entry.Tables) == 0 {
		issues = append(issues, fmt.Sprintf("registry entry %s does not declare reviewed tables", entry.Path))
	}
	if contains(entry.SinkKinds, "json_file") && (len(entry.Codecs) == 0 || len(entry.DTOs) == 0) {
		issues = append(issues, fmt.Sprintf("registry entry %s does not declare its JSON codec and DTO", entry.Path))
	}
	if (contains(entry.SinkKinds, "web_storage") || contains(entry.SinkKinds, "indexed_db") || contains(entry.SinkKinds, "cache_storage")) && len(entry.Keys) == 0 {
		issues = append(issues, fmt.Sprintf("registry entry %s does not declare browser persistence keys", entry.Path))
	}
	return issues
}

func compareReviewedInventory(path, kind string, registered, discovered []string) []string {
	registered = uniqueSorted(registered)
	discovered = uniqueSorted(discovered)
	if reflect.DeepEqual(registered, discovered) {
		return nil
	}
	return []string{fmt.Sprintf("durable sink %s for %s are %v, registered %v", kind, path, discovered, registered)}
}

func normalizeStorageIdentifier(value string) string {
	var normalized strings.Builder
	for _, r := range strings.ToLower(value) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			normalized.WriteRune(r)
		}
	}
	return normalized.String()
}

func shouldSkipDirectory(rel, name string) bool {
	if rel == "." {
		return false
	}
	return contains([]string{".git", "node_modules", "vendor", "dist", "build", "coverage", "testdata"}, name)
}

func shouldSkipFile(rel string) bool {
	base := filepath.Base(rel)
	return strings.HasSuffix(base, "_test.go") || strings.Contains(base, ".test.") || strings.Contains(base, ".spec.") ||
		strings.HasSuffix(base, ".gen.go") || strings.HasPrefix(rel, "internal/boundarycontract/") ||
		strings.HasPrefix(rel, "internal/cmd/durable-sink-contract/") || strings.HasPrefix(rel, "internal/testutil/")
}

func selectorRootName(expression ast.Expr) string {
	switch typed := expression.(type) {
	case *ast.Ident:
		return typed.Name
	case *ast.SelectorExpr:
		return selectorRootName(typed.X)
	default:
		return ""
	}
}

func extractSQLTables(source []byte) []string {
	var tables []string
	for _, match := range sqlTablePattern.FindAllSubmatch(source, -1) {
		if len(match) > 1 {
			tables = append(tables, strings.ToLower(string(match[1])))
		}
	}
	for _, match := range sqlReadTablePattern.FindAllSubmatch(source, -1) {
		if len(match) > 1 {
			tables = append(tables, strings.ToLower(string(match[1])))
		}
	}
	return uniqueSorted(tables)
}

func extractBrowserKeys(source []byte) []string {
	var keys []string
	for _, match := range browserCallArgPattern.FindAllSubmatch(source, -1) {
		for _, candidate := range match[1:] {
			if len(candidate) > 0 {
				value := strings.TrimSpace(string(candidate))
				if len(value) >= 2 && strings.ContainsRune("'\"`", rune(value[0])) && value[len(value)-1] == value[0] {
					value = value[1 : len(value)-1]
				} else {
					value = "expression:" + value
				}
				keys = append(keys, value)
			}
		}
	}
	return uniqueSorted(keys)
}

func renderExpression(fileSet *token.FileSet, expression ast.Expr) string {
	var output bytes.Buffer
	if err := printer.Fprint(&output, fileSet, expression); err != nil {
		return "<unprintable expression>"
	}
	return output.String()
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			seen[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(seen))
	for value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func sortedCopy(values []string) []string {
	copyOfValues := append([]string(nil), values...)
	sort.Strings(copyOfValues)
	return copyOfValues
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func WriteRegistry(path string, registry Registry) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("missing registry path")
	}
	sort.Slice(registry.Entries, func(i, j int) bool { return registry.Entries[i].Path < registry.Entries[j].Path })
	body, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	return os.WriteFile(path, body, 0o644)
}
