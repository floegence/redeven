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
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const ThreadstoreBoundaryManifestVersion = 1

type ThreadstoreBoundaryManifest struct {
	Version int                        `json:"version"`
	Tables  []ThreadstoreTableContract `json:"tables"`
	Queries []ThreadstoreQueryContract `json:"queries"`
}

type ThreadstoreTableContract struct {
	Table                string                  `json:"table"`
	Columns              []string                `json:"columns"`
	Indexes              []string                `json:"indexes"`
	Triggers             []string                `json:"triggers"`
	IndexUses            []ThreadstoreIndexUse   `json:"index_uses"`
	TriggerUses          []ThreadstoreTriggerUse `json:"trigger_uses"`
	Owner                string                  `json:"owner"`
	Authority            string                  `json:"authority"`
	DataClass            string                  `json:"data_class"`
	AllowedPurpose       string                  `json:"allowed_purpose"`
	AllowedLookupKeys    []string                `json:"allowed_lookup_keys"`
	Consumers            []string                `json:"consumers"`
	RetentionOrDeletion  string                  `json:"retention_or_deletion"`
	CanonicalIdentity    string                  `json:"canonical_identity"`
	APIUIVisibility      string                  `json:"api_ui_visibility"`
	LifecycleProhibition string                  `json:"lifecycle_prohibition"`
	Phase1CDecision      string                  `json:"phase_1c_decision,omitempty"`
}

type ThreadstoreIndexUse struct {
	Name            string   `json:"name"`
	Purpose         string   `json:"purpose"`
	IntegrityOnly   bool     `json:"integrity_only"`
	AllowedQueryIDs []string `json:"allowed_query_ids"`
}

type ThreadstoreTriggerUse struct {
	Name            string   `json:"name"`
	Purpose         string   `json:"purpose"`
	AllowedQueryIDs []string `json:"allowed_query_ids"`
}

type ThreadstoreQueryContract struct {
	ID              string   `json:"id"`
	Path            string   `json:"path"`
	Function        string   `json:"function"`
	Method          string   `json:"method"`
	SQLSHA256       string   `json:"sql_sha256,omitempty"`
	BuilderSHA256   string   `json:"builder_sha256,omitempty"`
	Tables          []string `json:"tables,omitempty"`
	LookupKeys      []string `json:"lookup_keys,omitempty"`
	ReadColumns     []string `json:"read_columns,omitempty"`
	WriteColumns    []string `json:"write_columns,omitempty"`
	Action          string   `json:"action"`
	Consumer        string   `json:"consumer"`
	ConsumerKind    string   `json:"consumer_kind"`
	DynamicReview   string   `json:"dynamic_review,omitempty"`
	RenderedSQLExpr string   `json:"rendered_sql_expression,omitempty"`
}

var (
	threadstoreLookupPattern        = regexp.MustCompile(`(?is)\bwhere\s+(.+?)(?:\border\s+by\b|\bgroup\s+by\b|\blimit\b|\breturning\b|\bon\s+conflict\b|$)`)
	threadstoreColumnPattern        = regexp.MustCompile(`(?i)([a-z_][a-z0-9_]*)\s*(?:=|<>|!=|<|>|<=|>=|\bin\b|\bis\b)`)
	threadstoreInsertColumnsPattern = regexp.MustCompile(`(?is)\binsert(?:\s+or\s+(?:rollback|abort|replace|fail|ignore))?\s+into\s+[\x60"\[]?[a-z_][a-z0-9_]*[\x60"\]]?\s*\(([^)]*)\)`)
	threadstoreUpdateSetPattern     = regexp.MustCompile(`(?is)\bupdate\s+[\x60"\[]?[a-z_][a-z0-9_]*[\x60"\]]?\s+set\s+(.+?)(?:\bwhere\b|$)`)
	threadstoreAssignmentPattern    = regexp.MustCompile(`(?i)([a-z_][a-z0-9_]*)\s*=`)
)

func LoadThreadstoreBoundaryManifest(path string) (ThreadstoreBoundaryManifest, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return ThreadstoreBoundaryManifest{}, err
	}
	var manifest ThreadstoreBoundaryManifest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return ThreadstoreBoundaryManifest{}, fmt.Errorf("decode threadstore boundary manifest: %w", err)
	}
	return manifest, nil
}

func ScanThreadstoreSQL(root string) ([]ThreadstoreQueryContract, error) {
	root = filepath.Clean(root)
	physicalColumns, _, _, err := LoadReviewedThreadstorePhysicalSchema(filepath.Join(root, "internal", "ai", "threadstore", "reviewed_schema_manifest.json"))
	if err != nil {
		return nil, err
	}
	knownColumns := map[string]struct{}{}
	for _, columns := range physicalColumns {
		for _, column := range columns {
			knownColumns[column] = struct{}{}
		}
	}
	for _, column := range []string{"name", "type", "sql", "tbl_name"} {
		knownColumns[column] = struct{}{}
	}
	directories := []string{
		filepath.Join(root, "internal", "ai", "threadstore"),
		filepath.Join(root, "internal", "persistence", "sqliteutil"),
	}
	type sourceFile struct {
		rel, path string
		body      []byte
	}
	var sources []sourceFile
	for _, directory := range directories {
		entries, err := os.ReadDir(directory)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			path := filepath.Join(directory, entry.Name())
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return nil, err
			}
			body, err := os.ReadFile(path)
			if err != nil {
				return nil, err
			}
			sources = append(sources, sourceFile{rel: filepath.ToSlash(rel), path: path, body: body})
		}
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].rel < sources[j].rel })
	var digestSource bytes.Buffer
	var queries []ThreadstoreQueryContract
	for _, source := range sources {
		digestSource.WriteString(source.rel)
		digestSource.WriteByte(0)
		digestSource.Write(source.body)
		digestSource.WriteByte(0)
		fileQueries, err := scanThreadstoreSQLFile(source.rel, source.path, knownColumns)
		if err != nil {
			return nil, err
		}
		queries = append(queries, fileQueries...)
	}
	builderSum := sha256.Sum256(digestSource.Bytes())
	builderDigest := hex.EncodeToString(builderSum[:])
	for index := range queries {
		if queries[index].SQLSHA256 == "" {
			queries[index].BuilderSHA256 = builderDigest
			applyReviewedDynamicInventory(&queries[index])
		}
	}
	sort.Slice(queries, func(i, j int) bool { return queries[i].ID < queries[j].ID })
	return queries, nil
}

func scanThreadstoreSQLFile(rel, path string, knownColumns map[string]struct{}) ([]ThreadstoreQueryContract, error) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, nil, parser.SkipObjectResolution)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", rel, err)
	}
	packageStrings := collectStaticStrings(file.Decls)
	var queries []ThreadstoreQueryContract
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		functionName := function.Name.Name
		if function.Recv != nil && len(function.Recv.List) > 0 {
			functionName = receiverTypeName(function.Recv.List[0].Type) + "." + functionName
		}
		locals := cloneStringMap(packageStrings)
		collectFunctionStaticStrings(function.Body, locals)
		ordinalBySemanticKey := map[string]int{}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || !isSQLMethod(selector.Sel.Name) {
				return true
			}
			argumentIndex := 0
			if strings.HasSuffix(selector.Sel.Name, "Context") {
				argumentIndex = 1
			}
			if len(call.Args) <= argumentIndex {
				return true
			}
			expression := call.Args[argumentIndex]
			sqlText, resolved := evalStaticString(expression, locals)
			rendered := renderGoExpression(fileSet, expression)
			semanticSource := normalizeContractSQL(sqlText)
			if !resolved {
				semanticSource = rendered
			}
			semanticKey := rel + "\x00" + functionName + "\x00" + selector.Sel.Name + "\x00" + semanticSource
			ordinalBySemanticKey[semanticKey]++
			idSum := sha256.Sum256([]byte(semanticKey))
			query := ThreadstoreQueryContract{
				ID:       "threadstore." + hex.EncodeToString(idSum[:8]),
				Path:     rel,
				Function: functionName,
				Method:   selector.Sel.Name,
				Action:   queryAction(sqlText, selector.Sel.Name),
				Consumer: functionName,
			}
			if functionName == "migrateThreadstoreV1ToV2" {
				query.Action = "schema"
			}
			if ordinalBySemanticKey[semanticKey] > 1 {
				query.ID += fmt.Sprintf(".%d", ordinalBySemanticKey[semanticKey])
			}
			if resolved {
				normalized := normalizeContractSQL(sqlText)
				sum := sha256.Sum256([]byte(normalized))
				query.SQLSHA256 = hex.EncodeToString(sum[:])
				query.Tables = filterContractTables(extractSQLTables([]byte(normalized)))
				query.LookupKeys = extractThreadstoreLookupKeys(normalized)
				query.ReadColumns, query.WriteColumns = extractThreadstoreColumns(normalized, query.Action, knownColumns, query.LookupKeys)
			} else {
				query.RenderedSQLExpr = rendered
				query.Tables = filterContractTables(extractSQLTables([]byte(rendered)))
				query.LookupKeys = extractThreadstoreLookupKeys(rendered)
				query.ReadColumns, query.WriteColumns = extractThreadstoreColumns(rendered, query.Action, knownColumns, query.LookupKeys)
				if len(query.Tables) == 0 {
					query.ReadColumns = nil
					query.WriteColumns = nil
				}
			}
			query.ConsumerKind = reviewedThreadstoreConsumerKind(query)
			queries = append(queries, query)
			return true
		})
	}
	return queries, nil
}

func ValidateThreadstoreBoundaryManifest(manifest ThreadstoreBoundaryManifest, schemaColumns map[string][]string, schemaIndexes map[string]string, schemaTriggers map[string]string, scanned []ThreadstoreQueryContract) []string {
	var issues []string
	if manifest.Version != ThreadstoreBoundaryManifestVersion {
		issues = append(issues, fmt.Sprintf("threadstore boundary manifest version=%d, want %d", manifest.Version, ThreadstoreBoundaryManifestVersion))
	}
	allowedAuthorities := map[string]struct{}{
		"schema_metadata": {}, "coordination_operation": {}, "permission_authorization": {},
		"upload_physical_resource": {}, "pre_admission_queue": {}, "product_routing": {}, "product_settings": {},
		"migration_input": {}, "execution_authority": {},
	}
	tableContracts := make(map[string]ThreadstoreTableContract, len(manifest.Tables))
	for _, contract := range manifest.Tables {
		name := strings.TrimSpace(contract.Table)
		if name == "" {
			issues = append(issues, "threadstore boundary manifest contains an empty table")
			continue
		}
		if _, exists := tableContracts[name]; exists {
			issues = append(issues, fmt.Sprintf("threadstore table %s is owned more than once", name))
			continue
		}
		tableContracts[name] = contract
		if contract.Owner != "redeven" {
			issues = append(issues, fmt.Sprintf("threadstore table %s owner=%q, want redeven", name, contract.Owner))
		}
		if _, ok := allowedAuthorities[contract.Authority]; !ok {
			issues = append(issues, fmt.Sprintf("threadstore table %s has unsupported authority %q", name, contract.Authority))
		}
		if strings.TrimSpace(contract.DataClass) == "" || strings.TrimSpace(contract.AllowedPurpose) == "" || len(contract.Consumers) == 0 || strings.TrimSpace(contract.RetentionOrDeletion) == "" || strings.TrimSpace(contract.CanonicalIdentity) == "" || strings.TrimSpace(contract.APIUIVisibility) == "" || strings.TrimSpace(contract.LifecycleProhibition) == "" {
			issues = append(issues, fmt.Sprintf("threadstore table %s is missing ownership or consumer metadata", name))
		}
		for _, key := range contract.AllowedLookupKeys {
			if !contains(contract.Columns, key) {
				issues = append(issues, fmt.Sprintf("threadstore table %s allows non-column lookup key %s", name, key))
			}
		}
		prohibition := strings.ToLower(contract.LifecycleProhibition)
		if !strings.Contains(prohibition, "inventory") || !strings.Contains(prohibition, "timeline") || !strings.Contains(prohibition, "status") || !strings.Contains(prohibition, "search") {
			issues = append(issues, fmt.Sprintf("threadstore table %s does not explicitly prohibit lifecycle inventory/timeline/status/search", name))
		}
	}
	queryByID := make(map[string]ThreadstoreQueryContract, len(manifest.Queries))
	for _, query := range manifest.Queries {
		queryByID[query.ID] = query
	}
	for _, contract := range manifest.Tables {
		indexUseNames := map[string]struct{}{}
		for _, use := range contract.IndexUses {
			if strings.TrimSpace(use.Name) == "" || strings.TrimSpace(use.Purpose) == "" {
				issues = append(issues, fmt.Sprintf("threadstore table %s has index use without name or purpose", contract.Table))
				continue
			}
			if _, duplicate := indexUseNames[use.Name]; duplicate {
				issues = append(issues, fmt.Sprintf("threadstore index use %s is duplicated", use.Name))
			}
			indexUseNames[use.Name] = struct{}{}
			if use.IntegrityOnly && len(use.AllowedQueryIDs) != 0 {
				issues = append(issues, fmt.Sprintf("integrity-only index %s authorizes queries", use.Name))
			}
			if !use.IntegrityOnly && len(use.AllowedQueryIDs) == 0 {
				issues = append(issues, fmt.Sprintf("query index %s has no allowed query IDs", use.Name))
			}
			for _, id := range use.AllowedQueryIDs {
				query, ok := queryByID[id]
				if !ok || !contains(query.Tables, contract.Table) {
					issues = append(issues, fmt.Sprintf("index %s authorizes unrelated query %s", use.Name, id))
				}
			}
		}
		if !reflectStringSlice(contract.Indexes, mapStringKeys(indexUseNames)) {
			issues = append(issues, fmt.Sprintf("threadstore table %s index purposes do not cover exact indexes", contract.Table))
		}
		triggerUseNames := map[string]struct{}{}
		for _, use := range contract.TriggerUses {
			if strings.TrimSpace(use.Name) == "" || strings.TrimSpace(use.Purpose) == "" {
				issues = append(issues, fmt.Sprintf("threadstore table %s has trigger use without name or purpose", contract.Table))
				continue
			}
			triggerUseNames[use.Name] = struct{}{}
			for _, id := range use.AllowedQueryIDs {
				if _, ok := queryByID[id]; !ok {
					issues = append(issues, fmt.Sprintf("trigger %s authorizes unknown query %s", use.Name, id))
				}
			}
		}
		if !reflectStringSlice(contract.Triggers, mapStringKeys(triggerUseNames)) {
			issues = append(issues, fmt.Sprintf("threadstore table %s trigger purposes do not cover exact triggers", contract.Table))
		}
	}
	for table, columns := range schemaColumns {
		if _, ok := tableContracts[table]; !ok {
			issues = append(issues, fmt.Sprintf("schema table %s has no reviewed owner", table))
		}
		if contract, ok := tableContracts[table]; ok && !reflectStringSlice(contract.Columns, columns) {
			issues = append(issues, fmt.Sprintf("threadstore table %s columns are %v, registered %v", table, uniqueSorted(columns), uniqueSorted(contract.Columns)))
		}
	}
	for table := range tableContracts {
		if _, ok := schemaColumns[table]; !ok {
			issues = append(issues, fmt.Sprintf("threadstore boundary manifest has stale table %s", table))
		}
	}
	registeredIndexes := map[string]string{}
	registeredTriggers := map[string]string{}
	for _, contract := range manifest.Tables {
		for _, index := range contract.Indexes {
			if previous, exists := registeredIndexes[index]; exists {
				issues = append(issues, fmt.Sprintf("schema index %s is registered under both %s and %s", index, previous, contract.Table))
			}
			registeredIndexes[index] = contract.Table
		}
		for _, trigger := range contract.Triggers {
			if previous, exists := registeredTriggers[trigger]; exists {
				issues = append(issues, fmt.Sprintf("schema trigger %s is registered under both %s and %s", trigger, previous, contract.Table))
			}
			registeredTriggers[trigger] = contract.Table
		}
	}
	for index, table := range schemaIndexes {
		if _, ok := tableContracts[table]; !ok {
			issues = append(issues, fmt.Sprintf("schema index %s has no reviewed table owner (%s)", index, table))
		}
		if registeredIndexes[index] != table {
			issues = append(issues, fmt.Sprintf("schema index %s owner=%q, registered %q", index, table, registeredIndexes[index]))
		}
	}
	for index, table := range registeredIndexes {
		if schemaIndexes[index] != table {
			issues = append(issues, fmt.Sprintf("threadstore boundary manifest has stale index %s under %s", index, table))
		}
	}
	for trigger, table := range schemaTriggers {
		if _, ok := tableContracts[table]; !ok {
			issues = append(issues, fmt.Sprintf("schema trigger %s has no reviewed table owner (%s)", trigger, table))
		}
		if registeredTriggers[trigger] != table {
			issues = append(issues, fmt.Sprintf("schema trigger %s owner=%q, registered %q", trigger, table, registeredTriggers[trigger]))
		}
	}
	for trigger, table := range registeredTriggers {
		if schemaTriggers[trigger] != table {
			issues = append(issues, fmt.Sprintf("threadstore boundary manifest has stale trigger %s under %s", trigger, table))
		}
	}
	issues = append(issues, compareThreadstoreQueries(manifest.Queries, scanned, tableContracts)...)
	sort.Strings(issues)
	return issues
}

func LoadReviewedThreadstorePhysicalSchema(path string) (map[string][]string, map[string]string, map[string]string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, nil, err
	}
	var source struct {
		Versions []struct {
			Version int `json:"version"`
			Objects []struct {
				Type      string `json:"type"`
				Name      string `json:"name"`
				TableName string `json:"table_name"`
			} `json:"sqlite_master"`
			Tables []struct {
				Name    string `json:"name"`
				Columns []struct {
					Name string `json:"name"`
				} `json:"table_xinfo"`
			} `json:"tables"`
		} `json:"versions"`
	}
	if err := json.Unmarshal(body, &source); err != nil {
		return nil, nil, nil, fmt.Errorf("decode reviewed threadstore physical schema: %w", err)
	}
	if len(source.Versions) == 0 {
		return nil, nil, nil, errors.New("reviewed threadstore physical schema has no versions")
	}
	for index, version := range source.Versions {
		if version.Version != index+1 {
			return nil, nil, nil, fmt.Errorf("reviewed threadstore physical schema version[%d]=%d, want contiguous %d", index, version.Version, index+1)
		}
	}
	current := source.Versions[len(source.Versions)-1]
	columns := map[string][]string{}
	indexes := map[string]string{}
	triggers := map[string]string{}
	for _, table := range current.Tables {
		for _, column := range table.Columns {
			columns[table.Name] = append(columns[table.Name], column.Name)
		}
		columns[table.Name] = uniqueSorted(columns[table.Name])
	}
	for _, object := range current.Objects {
		switch object.Type {
		case "index":
			indexes[object.Name] = object.TableName
		case "trigger":
			triggers[object.Name] = object.TableName
		}
	}
	return columns, indexes, triggers, nil
}

func RefreshThreadstorePhysicalContracts(manifest ThreadstoreBoundaryManifest, columns map[string][]string, indexes, triggers map[string]string) (ThreadstoreBoundaryManifest, error) {
	contracts := make(map[string]*ThreadstoreTableContract, len(manifest.Tables))
	for index := range manifest.Tables {
		contract := &manifest.Tables[index]
		contracts[contract.Table] = contract
		contract.Columns = uniqueSorted(columns[contract.Table])
		contract.Indexes = nil
		contract.Triggers = nil
	}
	for table := range columns {
		if contracts[table] == nil {
			return manifest, fmt.Errorf("physical schema table %s has no reviewed contract", table)
		}
	}
	for name, table := range indexes {
		if contracts[table] == nil {
			return manifest, fmt.Errorf("physical schema index %s has unreviewed table %s", name, table)
		}
		contracts[table].Indexes = append(contracts[table].Indexes, name)
	}
	for name, table := range triggers {
		if contracts[table] == nil {
			return manifest, fmt.Errorf("physical schema trigger %s has unreviewed table %s", name, table)
		}
		contracts[table].Triggers = append(contracts[table].Triggers, name)
	}
	for _, contract := range contracts {
		contract.Indexes = uniqueSorted(contract.Indexes)
		contract.Triggers = uniqueSorted(contract.Triggers)
	}
	return manifest, nil
}

func compareThreadstoreQueries(reviewed, scanned []ThreadstoreQueryContract, tables map[string]ThreadstoreTableContract) []string {
	var issues []string
	registered := make(map[string]ThreadstoreQueryContract, len(reviewed))
	for _, query := range reviewed {
		if _, exists := registered[query.ID]; exists {
			issues = append(issues, fmt.Sprintf("threadstore query ID %s is duplicated", query.ID))
			continue
		}
		registered[query.ID] = query
		if strings.TrimSpace(query.Action) == "" || strings.TrimSpace(query.Consumer) == "" || strings.TrimSpace(query.ConsumerKind) == "" {
			issues = append(issues, fmt.Sprintf("threadstore query %s is missing action, consumer, or consumer kind", query.ID))
		}
		if !isReviewedThreadstoreConsumerKind(query.ConsumerKind) {
			issues = append(issues, fmt.Sprintf("threadstore query %s has unsupported consumer kind %q", query.ID, query.ConsumerKind))
		}
		if (query.Action == "insert" || query.Action == "update" || query.Action == "delete") && len(query.Tables) == 0 {
			issues = append(issues, fmt.Sprintf("threadstore DML query %s has no owned table", query.ID))
		}
		if (query.Action == "insert" || query.Action == "update") && len(query.WriteColumns) == 0 {
			issues = append(issues, fmt.Sprintf("threadstore DML query %s has no reviewed write columns", query.ID))
		}
		if query.SQLSHA256 == "" && strings.TrimSpace(query.DynamicReview) == "" {
			issues = append(issues, fmt.Sprintf("dynamic threadstore query %s requires an explicit review exception", query.ID))
		}
		if query.SQLSHA256 == "" && len(query.BuilderSHA256) != 64 {
			issues = append(issues, fmt.Sprintf("dynamic threadstore query %s is not bound to the reviewed builder closure", query.ID))
		}
		for _, table := range query.Tables {
			if _, ok := tables[table]; !ok && table != "sqlite_master" && !strings.HasPrefix(table, "pragma_") && !isReviewedV1MigrationTable(query, table) {
				issues = append(issues, fmt.Sprintf("threadstore query %s references unowned table %s", query.ID, table))
			}
		}
		availableColumns := map[string]struct{}{}
		for _, table := range query.Tables {
			if table == "sqlite_master" {
				for _, column := range []string{"name", "type", "sql", "tbl_name"} {
					availableColumns[column] = struct{}{}
				}
				continue
			}
			for _, column := range tables[table].Columns {
				availableColumns[column] = struct{}{}
			}
		}
		for _, column := range append(append([]string(nil), query.ReadColumns...), query.WriteColumns...) {
			if _, ok := availableColumns[column]; !ok {
				issues = append(issues, fmt.Sprintf("threadstore query %s references unreviewed column %s", query.ID, column))
			}
		}
		if query.Action == "read" {
			allowed := map[string]struct{}{}
			for _, table := range query.Tables {
				if table == "sqlite_master" {
					allowed["name"] = struct{}{}
					allowed["type"] = struct{}{}
					allowed["tbl_name"] = struct{}{}
					continue
				}
				for _, key := range tables[table].AllowedLookupKeys {
					allowed[key] = struct{}{}
				}
			}
			for _, key := range query.LookupKeys {
				if _, ok := allowed[key]; !ok {
					issues = append(issues, fmt.Sprintf("threadstore read query %s uses unapproved lookup key %s", query.ID, key))
				}
			}
		}
	}
	for _, actual := range scanned {
		expected, ok := registered[actual.ID]
		if !ok {
			issues = append(issues, fmt.Sprintf("unreviewed threadstore SQL call %s (%s %s)", actual.ID, actual.Path, actual.Function))
			continue
		}
		delete(registered, actual.ID)
		if expected.Path != actual.Path || expected.Function != actual.Function || expected.Method != actual.Method || expected.SQLSHA256 != actual.SQLSHA256 || expected.BuilderSHA256 != actual.BuilderSHA256 || expected.Action != actual.Action || expected.Consumer != actual.Consumer || expected.ConsumerKind != actual.ConsumerKind || !reflectStringSlice(expected.Tables, actual.Tables) || !reflectStringSlice(expected.LookupKeys, actual.LookupKeys) || !reflectStringSlice(expected.ReadColumns, actual.ReadColumns) || !reflectStringSlice(expected.WriteColumns, actual.WriteColumns) || expected.RenderedSQLExpr != actual.RenderedSQLExpr {
			issues = append(issues, fmt.Sprintf("threadstore SQL call %s changed after review", actual.ID))
		}
	}
	for id := range registered {
		issues = append(issues, fmt.Sprintf("stale threadstore SQL query contract %s", id))
	}
	return issues
}

func isReviewedV1MigrationTable(query ThreadstoreQueryContract, table string) bool {
	if query.Function != "migrateThreadstoreV1ToV2" || query.Action != "schema" || query.ConsumerKind != "schema_maintenance" {
		return false
	}
	switch table {
	case "ai_child_permission_snapshots",
		"ai_permission_snapshots",
		"ai_queued_turns",
		"ai_subagent_publication_operations",
		"ai_thread_create_operations",
		"ai_thread_delete_operations",
		"ai_thread_fork_operations",
		"ai_turn_admission_receipts",
		"ai_thread_settings_v2":
		return true
	default:
		return false
	}
}

func RefreshThreadstoreQueries(existing ThreadstoreBoundaryManifest, scanned []ThreadstoreQueryContract) ThreadstoreBoundaryManifest {
	previous := make(map[string]ThreadstoreQueryContract, len(existing.Queries))
	for _, query := range existing.Queries {
		previous[query.ID] = query
	}
	existing.Version = ThreadstoreBoundaryManifestVersion
	existing.Queries = make([]ThreadstoreQueryContract, 0, len(scanned))
	for _, query := range scanned {
		query.DynamicReview = reviewedDynamicThreadstoreQuery(query)
		if old, ok := previous[query.ID]; ok {
			if old.DynamicReview != "" {
				query.DynamicReview = old.DynamicReview
			}
		}
		existing.Queries = append(existing.Queries, query)
	}
	return existing
}

func RefreshThreadstoreUsageContracts(manifest ThreadstoreBoundaryManifest) ThreadstoreBoundaryManifest {
	queriesByTable := map[string][]string{}
	writesByTable := map[string][]string{}
	for _, query := range manifest.Queries {
		for _, table := range query.Tables {
			queriesByTable[table] = append(queriesByTable[table], query.ID)
			if query.Action == "insert" || query.Action == "update" || query.Action == "delete" {
				writesByTable[table] = append(writesByTable[table], query.ID)
			}
		}
	}
	for index := range manifest.Tables {
		table := &manifest.Tables[index]
		table.IndexUses = nil
		for _, name := range table.Indexes {
			integrityOnly := strings.HasPrefix(name, "sqlite_autoindex_")
			use := ThreadstoreIndexUse{Name: name, IntegrityOnly: integrityOnly}
			if integrityOnly {
				use.Purpose = "enforce reviewed uniqueness or canonical identity integrity; not a query authorization surface"
			} else {
				use.Purpose = "accelerate reviewed product coordination, resource, routing, or settings queries"
				use.AllowedQueryIDs = uniqueSorted(queriesByTable[table.Table])
			}
			table.IndexUses = append(table.IndexUses, use)
		}
		table.TriggerUses = nil
		for _, name := range table.Triggers {
			use := ThreadstoreTriggerUse{Name: name, AllowedQueryIDs: uniqueSorted(writesByTable[table.Table])}
			switch name {
			case "trg_ai_thread_settings_reject_retired_id":
				use.Purpose = "reject reuse of a product ThreadID that has a durable cleanup operation"
			default:
				use.Purpose = "enforce reviewed product database integrity"
			}
			table.TriggerUses = append(table.TriggerUses, use)
		}
	}
	return manifest
}

func reviewedDynamicThreadstoreQuery(query ThreadstoreQueryContract) string {
	if query.SQLSHA256 != "" {
		return ""
	}
	// This is an explicit closed set. A new or semantically changed expression
	// receives a different ID and remains unreviewed until added here.
	reviews := map[string]string{
		"threadstore.056535db2815e7bf": "reviewed shared sqliteutil pragma execution; threadstore supplies only the three package-constant PRAGMA statements in threadstoreSchemaSpec",
		"threadstore.06a04faca957c1fb": "reviewed fixed-table ai_uploads UPDATE; dynamic fragment is a validated placeholder list only",
		"threadstore.06b73535a1ce4063": "reviewed ai_thread_settings keyset page; optional predicate is assembled from a validated opaque cursor",
		"threadstore.18f0a98e6b38e014": "reviewed ai_thread_settings exact read; format argument is the package-constant reviewed column projection",
		"threadstore.392dee5f83c0ae32": "reviewed shared schema introspection; identifier is strictly quoted and supplied by the sqliteutil schema verifier",
		"threadstore.1b83da901a7b729b": "reviewed fixed-table ai_uploads UPDATE; dynamic fragment is a validated placeholder list only",
		"threadstore.3f5feb51f37b0152": "reviewed ai_thread_settings exact read; format argument is the package-constant reviewed column projection",
		"threadstore.42889e0d7dbdc25f": "reviewed ai_thread_settings exact read; format argument is the package-constant reviewed column projection",
		"threadstore.45a9d0bdcc330c5e": "reviewed schema introspection; identifier is quoted and originates from the exact sqlite_master snapshot",
		"threadstore.52da3b758570149e": "reviewed fixed-table ai_uploads DELETE; dynamic fragment is a validated placeholder list only",
		"threadstore.57423acdd6f3d3f2": "reviewed SQLite maintenance PRAGMA; formatted value is a bounded integer page count",
		"threadstore.877e975b3157627c": "reviewed fixed-table ai_upload_refs DELETE; dynamic fragment is a validated placeholder list only",
		"threadstore.96cb5db51dc05223": "reviewed ai_thread_settings exact read; format argument is the package-constant reviewed column projection",
		"threadstore.99f119b8babb76ed": "reviewed ai_thread_settings exact read; format argument is the package-constant reviewed column projection",
		"threadstore.a42231375ad5054c": "reviewed shared SQLite user_version write; formatted value is the validated contiguous schema version",
		"threadstore.b031cb59feb33348": "reviewed schema introspection; identifier is quoted and originates from the exact sqlite_master snapshot",
		"threadstore.b29d6564f354d819": "reviewed schema introspection; identifier is quoted and originates from the exact sqlite_master snapshot",
		"threadstore.d0f67f8765bb2a81": "reviewed ai_uploads cleanup transition; UPDATE text is selected from a closed product-state branch",
		"threadstore.d8b5ab2c0ba41c63": "reviewed ai_uploads/ai_upload_refs cleanup query; optional clauses only narrow product resource eligibility",
		"threadstore.df3ccbde3304ed95": "reviewed ai_thread_settings exact read; format argument is the package-constant reviewed column projection",
		"threadstore.fa59a5e9f6bba496": "reviewed product cleanup transaction; SQL is selected from a closed package-local table deletion list",
		"threadstore.2c98775a07b4d6a1": "reviewed ai_thread_settings recovery page; optional predicate uses exact endpoint/thread keyset fields",
	}
	return reviews[query.ID]
}

func reviewedThreadstoreConsumerKind(query ThreadstoreQueryContract) string {
	if query.Action == "schema" || strings.Contains(query.Path, "/sqliteutil/") {
		return "schema_maintenance"
	}
	return "product_operation"
}

func isReviewedThreadstoreConsumerKind(kind string) bool {
	switch kind {
	case "product_operation", "schema_maintenance", "startup_recovery":
		return true
	default:
		return false
	}
}

func applyReviewedDynamicInventory(query *ThreadstoreQueryContract) {
	if query == nil || query.SQLSHA256 != "" {
		return
	}
	type inventory struct {
		tables []string
		keys   []string
		read   []string
		write  []string
	}
	inventories := map[string]inventory{
		"threadstore.06b73535a1ce4063": {[]string{"ai_thread_settings"}, []string{"pinned_at_unix_ms", "settings_created_at_unix_ms", "thread_id"}, []string{"created_by_user_email", "created_by_user_public_id", "endpoint_id", "model_id", "namespace_public_id", "parent_thread_id", "permission_type", "pinned_at_unix_ms", "reasoning_selection_json", "settings_created_at_unix_ms", "settings_updated_at_unix_ms", "thread_id", "updated_by_user_email", "updated_by_user_public_id", "working_dir"}, nil},
		"threadstore.2c98775a07b4d6a1": {[]string{"ai_thread_settings"}, []string{"endpoint_id", "thread_id"}, []string{"created_by_user_email", "created_by_user_public_id", "endpoint_id", "model_id", "namespace_public_id", "parent_thread_id", "permission_type", "pinned_at_unix_ms", "reasoning_selection_json", "settings_created_at_unix_ms", "settings_updated_at_unix_ms", "thread_id", "updated_by_user_email", "updated_by_user_public_id", "working_dir"}, nil},
		"threadstore.d0f67f8765bb2a81": {[]string{"ai_uploads"}, []string{"endpoint_id", "upload_id"}, []string{"endpoint_id", "upload_id"}, []string{"delete_after_unix_ms", "state"}},
		"threadstore.d8b5ab2c0ba41c63": {[]string{"ai_upload_refs", "ai_uploads"}, []string{"endpoint_id", "upload_id"}, []string{"endpoint_id", "upload_id"}, nil},
		"threadstore.fa59a5e9f6bba496": {
			[]string{"ai_flower_thread_routing", "ai_pending_input_imports", "ai_upload_staging_scopes"},
			[]string{"endpoint_id", "target_id", "thread_id"},
			[]string{"endpoint_id", "target_id", "thread_id"},
			nil,
		},
	}
	if reviewed, ok := inventories[query.ID]; ok {
		query.Tables = uniqueSorted(append(query.Tables, reviewed.tables...))
		query.LookupKeys = uniqueSorted(append(query.LookupKeys, reviewed.keys...))
		query.ReadColumns = uniqueSorted(append(query.ReadColumns, reviewed.read...))
		query.WriteColumns = uniqueSorted(append(query.WriteColumns, reviewed.write...))
	}
}

func extractThreadstoreColumns(sqlText, action string, knownColumns map[string]struct{}, lookupKeys []string) ([]string, []string) {
	referenced := map[string]struct{}{}
	lower := strings.ToLower(sqlText)
	for column := range knownColumns {
		matched, _ := regexp.MatchString(`\b`+regexp.QuoteMeta(column)+`\b`, lower)
		if matched {
			referenced[column] = struct{}{}
		}
	}
	var reads, writes []string
	switch action {
	case "read":
		for column := range referenced {
			reads = append(reads, column)
		}
	case "insert":
		if match := threadstoreInsertColumnsPattern.FindStringSubmatch(sqlText); len(match) > 1 {
			for _, column := range strings.Split(match[1], ",") {
				column = strings.Trim(strings.ToLower(strings.TrimSpace(column)), "`\"[]")
				if _, ok := knownColumns[column]; ok {
					writes = append(writes, column)
				}
			}
		}
		reads = append(reads, lookupKeys...)
	case "update":
		if match := threadstoreUpdateSetPattern.FindStringSubmatch(sqlText); len(match) > 1 {
			for _, assignment := range threadstoreAssignmentPattern.FindAllStringSubmatch(match[1], -1) {
				if len(assignment) > 1 {
					writes = append(writes, strings.ToLower(assignment[1]))
				}
			}
		}
		reads = append(reads, lookupKeys...)
	case "delete":
		reads = append(reads, lookupKeys...)
	}
	return uniqueSorted(reads), uniqueSorted(writes)
}

func filterContractTables(values []string) []string {
	var filtered []string
	for _, value := range values {
		if value != "set" {
			filtered = append(filtered, value)
		}
	}
	return uniqueSorted(filtered)
}

func WriteThreadstoreBoundaryManifest(path string, manifest ThreadstoreBoundaryManifest) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("missing threadstore boundary manifest path")
	}
	sort.Slice(manifest.Tables, func(i, j int) bool { return manifest.Tables[i].Table < manifest.Tables[j].Table })
	sort.Slice(manifest.Queries, func(i, j int) bool { return manifest.Queries[i].ID < manifest.Queries[j].ID })
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

func collectStaticStrings(declarations []ast.Decl) map[string]string {
	values := map[string]string{}
	for _, declaration := range declarations {
		general, ok := declaration.(*ast.GenDecl)
		if !ok || general.Tok != token.CONST {
			continue
		}
		for _, spec := range general.Specs {
			valueSpec, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for index, name := range valueSpec.Names {
				if index >= len(valueSpec.Values) {
					continue
				}
				if value, ok := evalStaticString(valueSpec.Values[index], values); ok {
					values[name.Name] = value
				}
			}
		}
	}
	return values
}

func collectFunctionStaticStrings(body *ast.BlockStmt, values map[string]string) {
	assigned := map[string]bool{}
	blocked := map[string]bool{}
	ast.Inspect(body, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.AssignStmt:
			for index, lhs := range typed.Lhs {
				name, ok := lhs.(*ast.Ident)
				if !ok || index >= len(typed.Rhs) {
					continue
				}
				if typed.Tok != token.ASSIGN && typed.Tok != token.DEFINE || assigned[name.Name] || blocked[name.Name] {
					delete(values, name.Name)
					blocked[name.Name] = true
					continue
				}
				assigned[name.Name] = true
				if value, ok := evalStaticString(typed.Rhs[index], values); ok {
					values[name.Name] = value
				} else {
					delete(values, name.Name)
					blocked[name.Name] = true
				}
			}
		case *ast.DeclStmt:
			general, ok := typed.Decl.(*ast.GenDecl)
			if !ok {
				return true
			}
			for _, spec := range general.Specs {
				valueSpec, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for index, name := range valueSpec.Names {
					if index < len(valueSpec.Values) && !assigned[name.Name] && !blocked[name.Name] {
						assigned[name.Name] = true
						if value, ok := evalStaticString(valueSpec.Values[index], values); ok {
							values[name.Name] = value
						} else {
							delete(values, name.Name)
							blocked[name.Name] = true
						}
					}
				}
			}
		}
		return true
	})
}

func evalStaticString(expression ast.Expr, values map[string]string) (string, bool) {
	switch typed := expression.(type) {
	case *ast.BasicLit:
		if typed.Kind != token.STRING {
			return "", false
		}
		value, err := strconv.Unquote(typed.Value)
		return value, err == nil
	case *ast.Ident:
		value, ok := values[typed.Name]
		return value, ok
	case *ast.BinaryExpr:
		if typed.Op != token.ADD {
			return "", false
		}
		left, leftOK := evalStaticString(typed.X, values)
		right, rightOK := evalStaticString(typed.Y, values)
		return left + right, leftOK && rightOK
	case *ast.ParenExpr:
		return evalStaticString(typed.X, values)
	}
	return "", false
}

func receiverTypeName(expression ast.Expr) string {
	switch typed := expression.(type) {
	case *ast.Ident:
		return typed.Name
	case *ast.StarExpr:
		return receiverTypeName(typed.X)
	case *ast.IndexExpr:
		return receiverTypeName(typed.X)
	case *ast.SelectorExpr:
		return typed.Sel.Name
	default:
		return "receiver"
	}
}

func renderGoExpression(fileSet *token.FileSet, expression ast.Expr) string {
	var output bytes.Buffer
	if err := printer.Fprint(&output, fileSet, expression); err != nil {
		return "<unprintable>"
	}
	return output.String()
}

func normalizeContractSQL(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func extractThreadstoreLookupKeys(sqlText string) []string {
	var keys []string
	for _, clause := range threadstoreLookupPattern.FindAllStringSubmatch(sqlText, -1) {
		if len(clause) < 2 {
			continue
		}
		for _, match := range threadstoreColumnPattern.FindAllStringSubmatch(clause[1], -1) {
			if len(match) > 1 {
				key := strings.ToLower(match[1])
				if key != "not" && key != "and" && key != "or" {
					keys = append(keys, key)
				}
			}
		}
	}
	return uniqueSorted(keys)
}

func queryAction(sqlText, method string) string {
	upper := strings.ToUpper(strings.TrimSpace(sqlText))
	switch {
	case strings.HasPrefix(upper, "SELECT"), strings.HasPrefix(upper, "PRAGMA"), strings.HasPrefix(method, "Query"):
		return "read"
	case strings.HasPrefix(upper, "CREATE"), strings.HasPrefix(upper, "ALTER"), strings.HasPrefix(upper, "DROP"):
		return "schema"
	case strings.HasPrefix(upper, "INSERT"):
		return "insert"
	case strings.HasPrefix(upper, "UPDATE"):
		return "update"
	case strings.HasPrefix(upper, "DELETE"):
		return "delete"
	default:
		return "execute"
	}
}

func cloneStringMap(values map[string]string) map[string]string {
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func reflectStringSlice(left, right []string) bool {
	left = uniqueSorted(left)
	right = uniqueSorted(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func mapStringKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return uniqueSorted(result)
}
