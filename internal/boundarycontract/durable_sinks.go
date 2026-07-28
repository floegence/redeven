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
	"strconv"
	"strings"
)

const RegistryVersion = 1

type Registry struct {
	Version int             `json:"version"`
	Entries []RegistryEntry `json:"entries"`
}

type RegistryEntry struct {
	Path         string   `json:"path"`
	SHA256       string   `json:"sha256"`
	SinkKinds    []string `json:"sink_kinds"`
	ReviewStatus string   `json:"review_status"`
	Owner        string   `json:"owner"`
	Authority    string   `json:"authority"`
	DataClasses  []string `json:"data_classes"`
	Tables       []string `json:"tables,omitempty"`
	Keys         []string `json:"keys,omitempty"`
	Codecs       []string `json:"codecs,omitempty"`
	DTOs         []string `json:"dtos,omitempty"`
	ReviewNote   string   `json:"review_note"`
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

const (
	ReviewStatusReviewed      = "reviewed"
	ReviewStatusPendingReview = "pending_review"
)

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
	sqlMutationPattern                     = regexp.MustCompile(`(?is)\b(?:create\s+(?:table|index|trigger)|alter\s+table|drop\s+(?:table|index|trigger)|insert\s+into|replace\s+into|update\s+[a-z_][a-z0-9_]*\s+set|delete\s+from)\b`)
	sqlTablePattern                        = regexp.MustCompile(`(?is)\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table|drop\s+table(?:\s+if\s+exists)?|insert\s+into|replace\s+into|update|delete\s+from)\s+[\x60"\[]?([a-z_][a-z0-9_]*)`)
	sqlReadTablePattern                    = regexp.MustCompile(`(?is)\b(?:from|join)\s+[\x60"\[]?([a-z_][a-z0-9_]*)`)
	typeScriptFSNamespaceImportPattern     = regexp.MustCompile(`(?m)\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'](?:node:)?fs(?:/promises)?["']`)
	typeScriptFSDefaultImportPattern       = regexp.MustCompile(`(?m)\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["'](?:node:)?fs(?:/promises)?["']`)
	typeScriptFSNamedImportPattern         = regexp.MustCompile(`(?m)\bimport\s*\{([^}]*)\}\s*from\s*["'](?:node:)?fs(?:/promises)?["']`)
	typeScriptFSRequirePattern             = regexp.MustCompile(`(?m)\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*["'](?:node:)?fs(?:/promises)?["']\s*\)`)
	typeScriptFSDestructuredRequirePattern = regexp.MustCompile(`(?m)\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*["'](?:node:)?fs(?:/promises)?["']\s*\)`)
	typeScriptStorageAliasPattern          = regexp.MustCompile(`(?m)\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:window|globalThis|self)\s*\.\s*)?(localStorage|sessionStorage|indexedDB|caches)\b`)
	typeScriptIdentifierAliasPattern       = regexp.MustCompile(`(?m)\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?`)
	typeScriptIdentifierAssignmentPattern  = regexp.MustCompile(`(?m)^\s*([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$`)
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
	type sourceFile struct {
		path   string
		source []byte
	}
	var sources []sourceFile
	goSources := make(map[string][]byte)
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
		sources = append(sources, sourceFile{path: rel, source: source})
		if extension == ".go" {
			goSources[rel] = source
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	packageFindings, err := inspectGoPackageCapabilities(goSources)
	if err != nil {
		return nil, err
	}

	packageCodecs := make(map[string]map[string]goCodecInventory)
	for _, source := range sources {
		if strings.EqualFold(filepath.Ext(source.path), ".go") {
			inventory, err := inspectGoCodecInventory(source.path, source.source)
			if err != nil {
				return nil, err
			}
			key := goPackageKey(source.path, inventory.packageName)
			if packageCodecs[key] == nil {
				packageCodecs[key] = make(map[string]goCodecInventory)
			}
			for name, functionInventory := range inventory.functions {
				packageCodecs[key][name] = functionInventory
			}
		}
	}

	var findings []Finding
	for _, source := range sources {
		finding, packageName, err := inspectSource(source.path, source.source)
		if err != nil {
			return nil, err
		}
		if contains(finding.SinkKinds, "file") && strings.EqualFold(filepath.Ext(source.path), ".go") {
			inventory, err := referencedCodecInventory(source.path, source.source, packageCodecs[goPackageKey(source.path, packageName)])
			if err != nil {
				return nil, err
			}
			if len(inventory.codecs) > 0 {
				finding.SinkKinds = append(finding.SinkKinds, "json_file")
				finding.SinkKinds = uniqueSorted(finding.SinkKinds)
				finding.Codecs = uniqueSorted(append(finding.Codecs, inventory.codecs...))
				finding.DTOs = uniqueSorted(append(finding.DTOs, inventory.dtos...))
			}
		}
		finding = mergeFindings(finding, packageFindings[source.path])
		if len(finding.SinkKinds) == 0 {
			continue
		}
		digest := sha256.Sum256(source.source)
		finding.Path = source.path
		finding.SHA256 = hex.EncodeToString(digest[:])
		findings = append(findings, finding)
	}
	sort.Slice(findings, func(i, j int) bool { return findings[i].Path < findings[j].Path })
	return findings, nil
}

func mergeFindings(left, right Finding) Finding {
	left.SinkKinds = uniqueSorted(append(left.SinkKinds, right.SinkKinds...))
	left.Tables = uniqueSorted(append(left.Tables, right.Tables...))
	left.Keys = uniqueSorted(append(left.Keys, right.Keys...))
	left.Codecs = uniqueSorted(append(left.Codecs, right.Codecs...))
	left.DTOs = uniqueSorted(append(left.DTOs, right.DTOs...))
	return left
}

type goCodecInventory struct {
	packageName string
	codecs      []string
	dtos        []string
	functions   map[string]goCodecInventory
}

func goPackageKey(path, packageName string) string {
	return filepath.ToSlash(filepath.Dir(path)) + "\x00" + packageName
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
		Path:         finding.Path,
		SHA256:       finding.SHA256,
		SinkKinds:    append([]string(nil), finding.SinkKinds...),
		ReviewStatus: ReviewStatusReviewed,
		Owner:        "redeven",
		Authority:    "product_configuration",
		DataClasses:  []string{"product-owned state"},
		ReviewNote:   "Reviewed durable product state; canonical Agent lifecycle data is excluded.",
		Tables:       append([]string(nil), finding.Tables...),
		Keys:         append([]string(nil), finding.Keys...),
		Codecs:       append([]string(nil), finding.Codecs...),
		DTOs:         append([]string(nil), finding.DTOs...),
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

// RefreshRegistry preserves review metadata only when the previously reviewed
// source fingerprint and scanner inventory still match exactly. Every other
// finding requires an explicit human or agent review before validation passes.
func RefreshRegistry(existing Registry, findings []Finding) Registry {
	previous := make(map[string]RegistryEntry, len(existing.Entries))
	for _, entry := range existing.Entries {
		previous[filepath.ToSlash(strings.TrimSpace(entry.Path))] = entry
	}
	refreshed := Registry{Version: RegistryVersion}
	for _, finding := range findings {
		if entry, ok := previous[finding.Path]; ok && reviewedFindingMatches(entry, finding) {
			entry.ReviewStatus = ReviewStatusReviewed
			refreshed.Entries = append(refreshed.Entries, entry)
			continue
		}
		refreshed.Entries = append(refreshed.Entries, RegistryEntry{
			Path:         finding.Path,
			SHA256:       finding.SHA256,
			SinkKinds:    append([]string(nil), finding.SinkKinds...),
			ReviewStatus: ReviewStatusPendingReview,
			Tables:       append([]string(nil), finding.Tables...),
			Keys:         append([]string(nil), finding.Keys...),
			Codecs:       append([]string(nil), finding.Codecs...),
			DTOs:         append([]string(nil), finding.DTOs...),
		})
	}
	return refreshed
}

func reviewedFindingMatches(entry RegistryEntry, finding Finding) bool {
	if entry.ReviewStatus != "" && entry.ReviewStatus != ReviewStatusReviewed {
		return false
	}
	return entry.SHA256 == finding.SHA256 &&
		reflect.DeepEqual(uniqueSorted(entry.SinkKinds), uniqueSorted(finding.SinkKinds)) &&
		reflect.DeepEqual(uniqueSorted(entry.Tables), uniqueSorted(finding.Tables)) &&
		reflect.DeepEqual(uniqueSorted(entry.Keys), uniqueSorted(finding.Keys)) &&
		reflect.DeepEqual(uniqueSorted(entry.Codecs), uniqueSorted(finding.Codecs)) &&
		reflect.DeepEqual(uniqueSorted(entry.DTOs), uniqueSorted(finding.DTOs))
}

func inspectSource(path string, source []byte) (Finding, string, error) {
	kinds := map[string]struct{}{}
	var tables, keys, codecs, dtos []string
	var packageName string
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		goFinding, name, err := inspectGoSource(path, source)
		if err != nil {
			return Finding{}, "", err
		}
		return goFinding, name, nil
	case ".sql":
		if sqlMutationPattern.Match(source) {
			kinds["sql_file"] = struct{}{}
		}
		tables = extractSQLTables(source)
	case ".ts", ".tsx":
		return inspectTypeScriptSource(source), "", nil
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
	}, packageName, nil
}

func inspectGoCodecInventory(path string, source []byte) (goCodecInventory, error) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, source, parser.SkipObjectResolution)
	if err != nil {
		return goCodecInventory{}, fmt.Errorf("parse %s: %w", path, err)
	}
	imports := goImportAliases(file)
	jsonAliases := aliasesForImport(imports, "encoding/json")
	encoders := assignedCallResults(file, jsonAliases, []string{"NewEncoder"})
	inspect := func(node ast.Node) goCodecInventory {
		var codecs, dtos []string
		ast.Inspect(node, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			root := selectorRootName(selector.X)
			if contains(jsonAliases, root) && contains([]string{"Marshal", "MarshalIndent"}, selector.Sel.Name) {
				codecs = append(codecs, "encoding/json."+selector.Sel.Name)
				if len(call.Args) > 0 {
					dtos = append(dtos, renderExpression(fileSet, call.Args[0]))
				}
			}
			if selector.Sel.Name == "Encode" && len(call.Args) > 0 && (contains(encoders, root) || isPackageCall(selector.X, jsonAliases, "NewEncoder")) {
				codecs = append(codecs, "encoding/json.NewEncoder")
				dtos = append(dtos, renderExpression(fileSet, call.Args[0]))
			}
			return true
		})
		return goCodecInventory{codecs: uniqueSorted(codecs), dtos: uniqueSorted(dtos)}
	}
	all := inspect(file)
	all.packageName = file.Name.Name
	all.functions = make(map[string]goCodecInventory)
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		inventory := inspect(function.Body)
		if len(inventory.codecs) > 0 {
			all.functions[function.Name.Name] = inventory
		}
	}
	return all, nil
}

func referencedCodecInventory(path string, source []byte, functions map[string]goCodecInventory) (goCodecInventory, error) {
	if len(functions) == 0 {
		return goCodecInventory{}, nil
	}
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, source, parser.SkipObjectResolution)
	if err != nil {
		return goCodecInventory{}, fmt.Errorf("parse %s: %w", path, err)
	}
	var result goCodecInventory
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		ident, ok := call.Fun.(*ast.Ident)
		if !ok {
			return true
		}
		if inventory, ok := functions[ident.Name]; ok {
			result.codecs = append(result.codecs, inventory.codecs...)
			result.dtos = append(result.dtos, inventory.dtos...)
		}
		return true
	})
	result.codecs = uniqueSorted(result.codecs)
	result.dtos = uniqueSorted(result.dtos)
	return result, nil
}

func inspectGoSource(path string, source []byte) (Finding, string, error) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, source, parser.SkipObjectResolution)
	if err != nil {
		return Finding{}, "", fmt.Errorf("parse %s: %w", path, err)
	}
	imports := goImportAliases(file)
	osAliases := aliasesForImport(imports, "os")
	ioAliases := aliasesForImport(imports, "io")
	sqlAliases := aliasesForImport(imports, "database/sql")
	jsonAliases := aliasesForImport(imports, "encoding/json")
	fileVars := assignedCallResults(file, osAliases, []string{"Create", "CreateTemp", "OpenFile"})
	fileVars = append(fileVars, typedVariables(file, osAliases, "File")...)
	sqlVars := typedVariables(file, sqlAliases, "DB", "Tx", "Conn", "Stmt")
	sqlVars = append(sqlVars, assignedCallResults(file, sqlAliases, []string{"Open"})...)
	sqlVars = expandAssignedReceiverResults(file, uniqueSorted(sqlVars), []string{"Begin", "BeginTx", "Conn", "Prepare", "PrepareContext"})
	fileVars = expandAssignedAliases(file, uniqueSorted(fileVars))
	codecInventory, err := inspectGoCodecInventory(path, source)
	if err != nil {
		return Finding{}, "", err
	}

	kinds := map[string]struct{}{}
	tables := extractSQLTables(source)
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		root := selectorRootName(selector.X)
		name := selector.Sel.Name
		switch {
		case contains(osAliases, root) && contains([]string{"WriteFile", "Create", "CreateTemp", "OpenFile"}, name):
			kinds["file"] = struct{}{}
		case (contains(fileVars, root) || contains(fileVars, selectorLeafName(selector.X))) && contains([]string{"Write", "WriteString"}, name):
			kinds["file"] = struct{}{}
		case contains(ioAliases, root) && name == "WriteString" && len(call.Args) > 0 && isFileExpression(call.Args[0], fileVars, osAliases):
			kinds["file"] = struct{}{}
		case contains(sqlAliases, root) && name == "Open":
			kinds["sqlite"] = struct{}{}
		case contains(jsonAliases, root) && name == "NewEncoder" && len(call.Args) > 0 && isFileExpression(call.Args[0], fileVars, osAliases):
			kinds["file"] = struct{}{}
		}
		if isSQLMethod(name) && (contains(sqlVars, root) || contains(sqlVars, selectorLeafName(selector.X))) {
			kinds["sqlite"] = struct{}{}
			if arg := sqlCallArgument(call, name); arg != nil {
				tables = append(tables, extractSQLArgumentTables(fileSet, arg)...)
			}
		}
		return true
	})
	if sqlMutationPattern.Match(source) {
		kinds["sqlite"] = struct{}{}
	}
	resultKinds := mapKeys(kinds)
	codecs, dtos := codecInventory.codecs, codecInventory.dtos
	if contains(resultKinds, "file") && len(codecInventory.codecs) > 0 {
		resultKinds = uniqueSorted(append(resultKinds, "json_file"))
	}
	return Finding{SinkKinds: resultKinds, Tables: uniqueSorted(tables), Codecs: codecs, DTOs: dtos}, file.Name.Name, nil
}

func isFileExpression(expression ast.Expr, fileVars, osAliases []string) bool {
	if ident, ok := expression.(*ast.Ident); ok {
		return contains(fileVars, ident.Name)
	}
	return isAnyPackageCall(expression, osAliases, []string{"Create", "CreateTemp", "OpenFile"})
}

func goImportAliases(file *ast.File) map[string]string {
	result := make(map[string]string)
	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil || spec.Name != nil && (spec.Name.Name == "_" || spec.Name.Name == ".") {
			continue
		}
		name := filepath.Base(path)
		if spec.Name != nil {
			name = spec.Name.Name
		}
		result[name] = path
	}
	return result
}

func aliasesForImport(imports map[string]string, importPath string) []string {
	var aliases []string
	for alias, path := range imports {
		if path == importPath {
			aliases = append(aliases, alias)
		}
	}
	return uniqueSorted(aliases)
}

func assignedCallResults(file *ast.File, packageAliases, functionNames []string) []string {
	var variables []string
	ast.Inspect(file, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.AssignStmt:
			for i, rhs := range typed.Rhs {
				if i < len(typed.Lhs) && isAnyPackageCall(rhs, packageAliases, functionNames) {
					if ident, ok := typed.Lhs[i].(*ast.Ident); ok {
						variables = append(variables, ident.Name)
					}
				}
			}
		case *ast.ValueSpec:
			for i, rhs := range typed.Values {
				if i < len(typed.Names) && isAnyPackageCall(rhs, packageAliases, functionNames) {
					variables = append(variables, typed.Names[i].Name)
				}
			}
		}
		return true
	})
	return uniqueSorted(variables)
}

func expandAssignedAliases(file *ast.File, variables []string) []string {
	changed := true
	for changed {
		changed = false
		ast.Inspect(file, func(node ast.Node) bool {
			assignment, ok := node.(*ast.AssignStmt)
			if !ok {
				return true
			}
			for i, rhs := range assignment.Rhs {
				if i >= len(assignment.Lhs) || (!contains(variables, selectorRootName(rhs)) && !contains(variables, selectorLeafName(rhs))) {
					continue
				}
				if ident, ok := assignment.Lhs[i].(*ast.Ident); ok && !contains(variables, ident.Name) {
					variables = append(variables, ident.Name)
					changed = true
				}
			}
			return true
		})
	}
	return uniqueSorted(variables)
}

func expandAssignedReceiverResults(file *ast.File, variables, methods []string) []string {
	changed := true
	for changed {
		changed = false
		ast.Inspect(file, func(node ast.Node) bool {
			assignment, ok := node.(*ast.AssignStmt)
			if !ok {
				return true
			}
			for i, rhs := range assignment.Rhs {
				if i >= len(assignment.Lhs) {
					continue
				}
				call, ok := rhs.(*ast.CallExpr)
				if !ok {
					continue
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || !contains(methods, selector.Sel.Name) || (!contains(variables, selectorRootName(selector.X)) && !contains(variables, selectorLeafName(selector.X))) {
					continue
				}
				if ident, ok := assignment.Lhs[i].(*ast.Ident); ok && !contains(variables, ident.Name) {
					variables = append(variables, ident.Name)
					changed = true
				}
			}
			return true
		})
	}
	return uniqueSorted(variables)
}

func typedVariables(file *ast.File, packageAliases []string, typeNames ...string) []string {
	var variables []string
	ast.Inspect(file, func(node ast.Node) bool {
		field, ok := node.(*ast.Field)
		if !ok {
			return true
		}
		typeExpr := field.Type
		if star, ok := typeExpr.(*ast.StarExpr); ok {
			typeExpr = star.X
		}
		selector, ok := typeExpr.(*ast.SelectorExpr)
		if !ok || !contains(packageAliases, selectorRootName(selector.X)) || !contains(typeNames, selector.Sel.Name) {
			return true
		}
		for _, name := range field.Names {
			variables = append(variables, name.Name)
		}
		return true
	})
	return uniqueSorted(variables)
}

func isAnyPackageCall(expression ast.Expr, aliases, names []string) bool {
	for _, name := range names {
		if isPackageCall(expression, aliases, name) {
			return true
		}
	}
	return false
}

func isPackageCall(expression ast.Expr, aliases []string, name string) bool {
	call, ok := expression.(*ast.CallExpr)
	if !ok {
		return false
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	return ok && selector.Sel.Name == name && contains(aliases, selectorRootName(selector.X))
}

func isSQLMethod(name string) bool {
	return contains([]string{"Exec", "ExecContext", "Query", "QueryContext", "QueryRow", "QueryRowContext", "Prepare", "PrepareContext"}, name)
}

func sqlCallArgument(call *ast.CallExpr, method string) ast.Expr {
	index := 0
	if strings.HasSuffix(method, "Context") {
		index = 1
	}
	if index >= len(call.Args) {
		return nil
	}
	return call.Args[index]
}

func extractSQLArgumentTables(fileSet *token.FileSet, expression ast.Expr) []string {
	if literal, ok := expression.(*ast.BasicLit); ok && literal.Kind == token.STRING {
		value, err := strconv.Unquote(literal.Value)
		if err == nil {
			return extractSQLTables([]byte(value))
		}
	}
	return []string{"expression:" + renderExpression(fileSet, expression)}
}

func inspectTypeScriptSource(source []byte) Finding {
	text := string(source)
	kinds := map[string]struct{}{}
	storageAliases := map[string]string{
		"localStorage": "web_storage", "sessionStorage": "web_storage",
		"indexedDB": "indexed_db", "caches": "cache_storage",
	}
	for _, match := range typeScriptStorageAliasPattern.FindAllStringSubmatch(text, -1) {
		storageAliases[match[1]] = storageAliases[match[2]]
	}
	for changed := true; changed; {
		changed = false
		matches := typeScriptIdentifierAliasPattern.FindAllStringSubmatch(text, -1)
		matches = append(matches, typeScriptIdentifierAssignmentPattern.FindAllStringSubmatch(text, -1)...)
		for _, match := range matches {
			kind, ok := storageAliases[match[2]]
			if !ok || storageAliases[match[1]] == kind {
				continue
			}
			storageAliases[match[1]] = kind
			changed = true
		}
	}
	var keys []string
	for alias, kind := range storageAliases {
		methods := "setItem|removeItem|clear"
		if kind == "indexed_db" {
			methods = "open|deleteDatabase"
		} else if kind == "cache_storage" {
			methods = "open|delete"
		}
		pattern := regexp.MustCompile(`(?m)\b(?:(?:window|globalThis|self)\s*\.\s*)?` + regexp.QuoteMeta(alias) + `\s*\.\s*(?:` + methods + `)\s*\(\s*([^,\)\n]*)`)
		for _, match := range pattern.FindAllStringSubmatch(text, -1) {
			kinds[kind] = struct{}{}
			if len(match) > 1 && strings.TrimSpace(match[1]) != "" {
				keys = append(keys, normalizeCallArgument(match[1]))
			}
		}
	}
	fsNamespaces := []string{"fs", "promises"}
	for _, match := range typeScriptFSNamespaceImportPattern.FindAllStringSubmatch(text, -1) {
		fsNamespaces = append(fsNamespaces, match[1])
	}
	for _, match := range typeScriptFSDefaultImportPattern.FindAllStringSubmatch(text, -1) {
		fsNamespaces = append(fsNamespaces, match[1])
	}
	for _, match := range typeScriptFSRequirePattern.FindAllStringSubmatch(text, -1) {
		fsNamespaces = append(fsNamespaces, match[1])
	}
	var fsFunctions []string
	for _, match := range typeScriptFSNamedImportPattern.FindAllStringSubmatch(text, -1) {
		for _, part := range strings.Split(match[1], ",") {
			fields := strings.Fields(strings.TrimSpace(part))
			if len(fields) == 1 && isTypeScriptWriteFunction(fields[0]) {
				fsFunctions = append(fsFunctions, fields[0])
			} else if len(fields) == 3 && fields[1] == "as" {
				if fields[0] == "promises" {
					fsNamespaces = append(fsNamespaces, fields[2])
				} else if isTypeScriptWriteFunction(fields[0]) {
					fsFunctions = append(fsFunctions, fields[2])
				}
			}
		}
	}
	for _, match := range typeScriptFSDestructuredRequirePattern.FindAllStringSubmatch(text, -1) {
		for _, part := range strings.Split(match[1], ",") {
			fields := strings.FieldsFunc(strings.TrimSpace(part), func(r rune) bool { return r == ':' || r == ' ' || r == '\t' })
			if len(fields) == 1 && isTypeScriptWriteFunction(fields[0]) {
				fsFunctions = append(fsFunctions, fields[0])
			} else if len(fields) >= 2 && isTypeScriptWriteFunction(fields[0]) {
				fsFunctions = append(fsFunctions, fields[len(fields)-1])
			}
		}
	}
	for _, namespace := range uniqueSorted(fsNamespaces) {
		pattern := regexp.MustCompile(`(?m)\b` + regexp.QuoteMeta(namespace) + `\s*\.\s*(?:writeFile|writeFileSync|appendFile|appendFileSync|open|openSync|createWriteStream|rename|renameSync)\s*\(`)
		if pattern.MatchString(text) {
			kinds["file"] = struct{}{}
		}
	}
	for _, function := range uniqueSorted(fsFunctions) {
		if regexp.MustCompile(`(?m)\b` + regexp.QuoteMeta(function) + `\s*\(`).MatchString(text) {
			kinds["file"] = struct{}{}
		}
	}
	return Finding{SinkKinds: mapKeys(kinds), Keys: uniqueSorted(keys)}
}

func isTypeScriptWriteFunction(name string) bool {
	return contains([]string{"writeFile", "writeFileSync", "appendFile", "appendFileSync", "open", "openSync", "createWriteStream", "rename", "renameSync"}, name)
}

func normalizeCallArgument(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && strings.ContainsRune("'\"`", rune(value[0])) && value[len(value)-1] == value[0] {
		return value[1 : len(value)-1]
	}
	return "expression:" + value
}

func mapKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return uniqueSorted(result)
}

func validateEntry(entry RegistryEntry) []string {
	var issues []string
	if entry.ReviewStatus != ReviewStatusReviewed {
		issues = append(issues, fmt.Sprintf("registry entry %s requires explicit review (status=%q)", entry.Path, entry.ReviewStatus))
	}
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

func selectorLeafName(expression ast.Expr) string {
	switch typed := expression.(type) {
	case *ast.Ident:
		return typed.Name
	case *ast.SelectorExpr:
		return typed.Sel.Name
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
