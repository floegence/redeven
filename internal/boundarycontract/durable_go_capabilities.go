package boundarycontract

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"sort"
)

type durableCapability uint8

const (
	durableFile durableCapability = 1 << iota
	durableSQLite
)

type parsedDurableGoFile struct {
	path    string
	fileSet *token.FileSet
	file    *ast.File
	imports map[string]string
}

type durableFunction struct {
	file *parsedDurableGoFile
	decl *ast.FuncDecl
	key  string
}

type durableFunctionSummary struct {
	result     durableCapability
	resultType string
	effect     durableCapability
	tables     []string
	codecs     []string
	dtos       []string
}

type durableTypeSpec struct {
	expression ast.Expr
	imports    map[string]string
}

// inspectGoPackageCapabilities complements the local syntax checks with a
// package-wide fixed point. The scanner deliberately stays syntax based so it
// remains deterministic for partial fixtures and does not need build tags or a
// successfully type-checked workspace.
func inspectGoPackageCapabilities(sources map[string][]byte) (map[string]Finding, error) {
	paths := make([]string, 0, len(sources))
	for path := range sources {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	packages := make(map[string][]*parsedDurableGoFile)
	for _, path := range paths {
		fileSet := token.NewFileSet()
		file, err := parser.ParseFile(fileSet, path, sources[path], parser.SkipObjectResolution)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		parsed := &parsedDurableGoFile{
			path:    path,
			fileSet: fileSet,
			file:    file,
			imports: goImportAliases(file),
		}
		key := goPackageKey(path, file.Name.Name)
		packages[key] = append(packages[key], parsed)
	}

	result := make(map[string]Finding)
	for _, files := range packages {
		findings := inspectDurableGoPackage(files)
		for path, finding := range findings {
			result[path] = finding
		}
	}
	return result, nil
}

func inspectDurableGoPackage(files []*parsedDurableGoFile) map[string]Finding {
	typeSpecs := make(map[string]durableTypeSpec)
	var functions []durableFunction
	for _, file := range files {
		for _, declaration := range file.file.Decls {
			switch typed := declaration.(type) {
			case *ast.GenDecl:
				for _, spec := range typed.Specs {
					if typeSpec, ok := spec.(*ast.TypeSpec); ok {
						typeSpecs[typeSpec.Name.Name] = durableTypeSpec{expression: typeSpec.Type, imports: file.imports}
					}
				}
			case *ast.FuncDecl:
				if typed.Body != nil {
					key := typed.Name.Name
					if typed.Recv != nil {
						key = durableReceiverType(typed.Recv) + "." + key
					}
					functions = append(functions, durableFunction{file: file, decl: typed, key: key})
				}
			}
		}
	}

	typeCaps := resolveDurableTypeCapabilities(typeSpecs)
	summaries := make(map[string]durableFunctionSummary, len(functions))
	for _, function := range functions {
		summary := summaries[function.key]
		summary.result |= fieldListCapability(function.decl.Type.Results, function.file.imports, typeCaps)
		if summary.resultType == "" {
			summary.resultType = firstFieldTypeName(function.decl.Type.Results)
		}
		summaries[function.key] = summary
	}
	// Capabilities and codec inventories only grow, so this reaches a stable
	// point even when helpers are recursive.
	for iteration := 0; iteration <= len(functions); iteration++ {
		changed := false
		for _, function := range functions {
			next := summarizeDurableFunction(function, summaries, typeCaps)
			current := summaries[function.key]
			next.result |= current.result
			if next.resultType == "" {
				next.resultType = current.resultType
			}
			next.effect |= current.effect
			next.tables = uniqueSorted(append(next.tables, current.tables...))
			next.codecs = uniqueSorted(append(next.codecs, current.codecs...))
			next.dtos = uniqueSorted(append(next.dtos, current.dtos...))
			if !reflect.DeepEqual(current, next) {
				summaries[function.key] = next
				changed = true
			}
		}
		if !changed {
			break
		}
	}

	findings := make(map[string]Finding, len(files))
	for _, file := range files {
		finding := inspectDurableGoFile(file, summaries, typeCaps)
		if len(finding.SinkKinds) > 0 {
			findings[file.path] = finding
		}
	}
	return findings
}

func resolveDurableTypeCapabilities(specs map[string]durableTypeSpec) map[string]durableCapability {
	result := make(map[string]durableCapability, len(specs))
	for iteration := 0; iteration <= len(specs); iteration++ {
		changed := false
		for name, spec := range specs {
			capability := durableTypeCapability(spec.expression, spec.imports, result)
			if capability&^result[name] != 0 {
				result[name] |= capability
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	return result
}

func durableTypeCapability(expression ast.Expr, imports map[string]string, named map[string]durableCapability) durableCapability {
	switch typed := expression.(type) {
	case *ast.Ident:
		return named[typed.Name]
	case *ast.StarExpr:
		return durableTypeCapability(typed.X, imports, named)
	case *ast.ParenExpr:
		return durableTypeCapability(typed.X, imports, named)
	case *ast.SelectorExpr:
		root := selectorRootName(typed.X)
		switch imports[root] {
		case "os":
			if typed.Sel.Name == "File" {
				return durableFile
			}
		case "io":
			if contains([]string{"Writer", "WriteCloser", "ReadWriter", "ReadWriteCloser", "StringWriter"}, typed.Sel.Name) {
				return durableFile
			}
		case "bufio":
			if typed.Sel.Name == "Writer" {
				return durableFile
			}
		case "database/sql":
			if contains([]string{"DB", "Tx", "Conn", "Stmt"}, typed.Sel.Name) {
				return durableSQLite
			}
		}
	case *ast.InterfaceType:
		var capability durableCapability
		for _, field := range typed.Methods.List {
			for _, name := range field.Names {
				if contains([]string{"Write", "WriteString"}, name.Name) {
					capability |= durableFile
				}
				if isSQLMethod(name.Name) {
					capability |= durableSQLite
				}
			}
			if len(field.Names) == 0 {
				capability |= durableTypeCapability(field.Type, imports, named)
			}
		}
		return capability
	case *ast.StructType:
		// A selector rooted at a store struct is otherwise indistinguishable
		// from an unrelated receiver without type checking. Treating a struct
		// that owns a durable handle as capable is the conservative choice.
		var capability durableCapability
		for _, field := range typed.Fields.List {
			capability |= durableTypeCapability(field.Type, imports, named)
		}
		return capability
	}
	return 0
}

func fieldListCapability(fields *ast.FieldList, imports map[string]string, named map[string]durableCapability) durableCapability {
	if fields == nil {
		return 0
	}
	var result durableCapability
	for _, field := range fields.List {
		result |= durableTypeCapability(field.Type, imports, named)
	}
	return result
}

func summarizeDurableFunction(function durableFunction, summaries map[string]durableFunctionSummary, typeCaps map[string]durableCapability) durableFunctionSummary {
	environment := durableFunctionEnvironment(function, typeCaps)
	types := durableFunctionTypes(function)
	expandDurableTypes(function.decl.Body, types, summaries)
	expandDurableEnvironment(function.decl.Body, function.file.imports, environment, summaries, typeCaps)
	result := durableFunctionSummary{
		result:     fieldListCapability(function.decl.Type.Results, function.file.imports, typeCaps),
		resultType: firstFieldTypeName(function.decl.Type.Results),
	}
	direct := inspectDurableGoNode(function.file, function.decl.Body, environment, types, summaries, typeCaps)
	if contains(direct.SinkKinds, "file") {
		result.effect |= durableFile
	}
	if contains(direct.SinkKinds, "sqlite") {
		result.effect |= durableSQLite
	}
	result.tables = append(result.tables, direct.Tables...)
	ast.Inspect(function.decl.Body, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.ReturnStmt:
			for _, expression := range typed.Results {
				result.result |= durableExpressionCapability(expression, function.file.imports, environment, summaries, typeCaps)
			}
		case *ast.CallExpr:
			codecs, dtos := durableCallCodecInventory(typed, function.file, types, summaries)
			result.codecs = append(result.codecs, codecs...)
			result.dtos = append(result.dtos, dtos...)
		}
		return true
	})
	result.codecs = uniqueSorted(result.codecs)
	result.dtos = uniqueSorted(result.dtos)
	result.tables = uniqueSorted(result.tables)
	return result
}

func durableFunctionEnvironment(function durableFunction, typeCaps map[string]durableCapability) map[string]durableCapability {
	result := make(map[string]durableCapability)
	addFieldsToDurableEnvironment(result, function.decl.Recv, function.file.imports, typeCaps)
	addFieldsToDurableEnvironment(result, function.decl.Type.Params, function.file.imports, typeCaps)
	addFieldsToDurableEnvironment(result, function.decl.Type.Results, function.file.imports, typeCaps)
	return result
}

func addFieldsToDurableEnvironment(environment map[string]durableCapability, fields *ast.FieldList, imports map[string]string, typeCaps map[string]durableCapability) {
	if fields == nil {
		return
	}
	for _, field := range fields.List {
		capability := durableTypeCapability(field.Type, imports, typeCaps)
		for _, name := range field.Names {
			environment[name.Name] |= capability
		}
	}
}

func expandDurableEnvironment(node ast.Node, imports map[string]string, environment map[string]durableCapability, summaries map[string]durableFunctionSummary, typeCaps map[string]durableCapability) {
	for iteration := 0; iteration < 32; iteration++ {
		changed := false
		ast.Inspect(node, func(node ast.Node) bool {
			switch typed := node.(type) {
			case *ast.AssignStmt:
				for index, rhs := range typed.Rhs {
					if index >= len(typed.Lhs) {
						continue
					}
					ident, ok := typed.Lhs[index].(*ast.Ident)
					if !ok {
						continue
					}
					capability := durableExpressionCapability(rhs, imports, environment, summaries, typeCaps)
					if capability&^environment[ident.Name] != 0 {
						environment[ident.Name] |= capability
						changed = true
					}
				}
			case *ast.ValueSpec:
				declared := durableTypeCapability(typed.Type, imports, typeCaps)
				for index, name := range typed.Names {
					capability := declared
					if index < len(typed.Values) {
						capability |= durableExpressionCapability(typed.Values[index], imports, environment, summaries, typeCaps)
					}
					if capability&^environment[name.Name] != 0 {
						environment[name.Name] |= capability
						changed = true
					}
				}
			}
			return true
		})
		if !changed {
			return
		}
	}
}

func durableExpressionCapability(expression ast.Expr, imports map[string]string, environment map[string]durableCapability, summaries map[string]durableFunctionSummary, typeCaps map[string]durableCapability) durableCapability {
	switch typed := expression.(type) {
	case *ast.Ident:
		return environment[typed.Name]
	case *ast.ParenExpr:
		return durableExpressionCapability(typed.X, imports, environment, summaries, typeCaps)
	case *ast.UnaryExpr:
		return durableExpressionCapability(typed.X, imports, environment, summaries, typeCaps)
	case *ast.SelectorExpr:
		return durableExpressionCapability(typed.X, imports, environment, summaries, typeCaps)
	case *ast.CallExpr:
		switch function := typed.Fun.(type) {
		case *ast.Ident:
			if summary, ok := summaries[function.Name]; ok {
				return summary.result
			}
			return typeCaps[function.Name]
		case *ast.SelectorExpr:
			root := selectorRootName(function.X)
			name := function.Sel.Name
			switch imports[root] {
			case "os":
				if contains([]string{"Create", "CreateTemp", "OpenFile"}, name) {
					return durableFile
				}
			case "database/sql":
				if name == "Open" {
					return durableSQLite
				}
			case "bufio":
				if contains([]string{"NewWriter", "NewWriterSize"}, name) && len(typed.Args) > 0 && durableExpressionCapability(typed.Args[0], imports, environment, summaries, typeCaps)&durableFile != 0 {
					return durableFile
				}
			}
			receiver := durableExpressionCapability(function.X, imports, environment, summaries, typeCaps)
			if receiver&durableSQLite != 0 && contains([]string{"Begin", "BeginTx", "Conn", "Prepare", "PrepareContext"}, name) {
				return durableSQLite
			}
		}
	}
	return 0
}

func durableReceiverType(fields *ast.FieldList) string {
	if fields == nil || len(fields.List) == 0 {
		return ""
	}
	return durableTypeName(fields.List[0].Type)
}

func firstFieldTypeName(fields *ast.FieldList) string {
	if fields == nil || len(fields.List) == 0 {
		return ""
	}
	return durableTypeName(fields.List[0].Type)
}

func durableTypeName(expression ast.Expr) string {
	switch typed := expression.(type) {
	case *ast.Ident:
		return typed.Name
	case *ast.StarExpr:
		return durableTypeName(typed.X)
	case *ast.ParenExpr:
		return durableTypeName(typed.X)
	case *ast.IndexExpr:
		return durableTypeName(typed.X)
	case *ast.IndexListExpr:
		return durableTypeName(typed.X)
	case *ast.SelectorExpr:
		return selectorRootName(typed.X) + "." + typed.Sel.Name
	}
	return ""
}

func durableFunctionTypes(function durableFunction) map[string]string {
	result := make(map[string]string)
	addFieldsToDurableTypes(result, function.decl.Recv)
	addFieldsToDurableTypes(result, function.decl.Type.Params)
	addFieldsToDurableTypes(result, function.decl.Type.Results)
	return result
}

func addFieldsToDurableTypes(types map[string]string, fields *ast.FieldList) {
	if fields == nil {
		return
	}
	for _, field := range fields.List {
		name := durableTypeName(field.Type)
		for _, fieldName := range field.Names {
			types[fieldName.Name] = name
		}
	}
}

func expandDurableTypes(node ast.Node, types map[string]string, summaries map[string]durableFunctionSummary) {
	for iteration := 0; iteration < 32; iteration++ {
		changed := false
		ast.Inspect(node, func(node ast.Node) bool {
			switch typed := node.(type) {
			case *ast.ValueSpec:
				declared := durableTypeName(typed.Type)
				for index, name := range typed.Names {
					inferred := declared
					if inferred == "" && index < len(typed.Values) {
						inferred = durableExpressionType(typed.Values[index], types, summaries)
					}
					if inferred != "" && types[name.Name] == "" {
						types[name.Name] = inferred
						changed = true
					}
				}
			case *ast.AssignStmt:
				for index, rhs := range typed.Rhs {
					if index >= len(typed.Lhs) {
						continue
					}
					ident, ok := typed.Lhs[index].(*ast.Ident)
					if !ok || types[ident.Name] != "" {
						continue
					}
					inferred := durableExpressionType(rhs, types, summaries)
					if inferred != "" {
						types[ident.Name] = inferred
						changed = true
					}
				}
			}
			return true
		})
		if !changed {
			return
		}
	}
}

func durableExpressionType(expression ast.Expr, types map[string]string, summaries map[string]durableFunctionSummary) string {
	switch typed := expression.(type) {
	case *ast.Ident:
		return types[typed.Name]
	case *ast.ParenExpr:
		return durableExpressionType(typed.X, types, summaries)
	case *ast.UnaryExpr:
		return durableExpressionType(typed.X, types, summaries)
	case *ast.CallExpr:
		if ident, ok := typed.Fun.(*ast.Ident); ok {
			if summary := summaries[ident.Name]; summary.resultType != "" {
				return summary.resultType
			}
			return ident.Name
		}
	}
	return ""
}

func durableMethodCallKey(receiver ast.Expr, types map[string]string) string {
	return durableExpressionType(receiver, types, nil)
}

func inspectDurableGoFile(file *parsedDurableGoFile, summaries map[string]durableFunctionSummary, typeCaps map[string]durableCapability) Finding {
	result := Finding{}
	for _, declaration := range file.file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		environment := durableFunctionEnvironment(durableFunction{file: file, decl: function}, typeCaps)
		types := durableFunctionTypes(durableFunction{file: file, decl: function})
		expandDurableTypes(function.Body, types, summaries)
		expandDurableEnvironment(function.Body, file.imports, environment, summaries, typeCaps)
		result = mergeFindings(result, inspectDurableGoNode(file, function.Body, environment, types, summaries, typeCaps))
	}
	result.SinkKinds = uniqueSorted(result.SinkKinds)
	if contains(result.SinkKinds, "file") && len(result.Codecs) > 0 {
		result.SinkKinds = uniqueSorted(append(result.SinkKinds, "json_file"))
	}
	return result
}

func inspectDurableGoNode(file *parsedDurableGoFile, node ast.Node, environment map[string]durableCapability, types map[string]string, summaries map[string]durableFunctionSummary, typeCaps map[string]durableCapability) Finding {
	kinds := make(map[string]struct{})
	var tables, codecs, dtos []string
	ast.Inspect(node, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		callCodecs, callDTOs := durableCallCodecInventory(call, file, types, summaries)
		codecs = append(codecs, callCodecs...)
		dtos = append(dtos, callDTOs...)
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			if ident, isIdent := call.Fun.(*ast.Ident); isIdent {
				summary := summaries[ident.Name]
				if summary.effect&durableFile != 0 {
					kinds["file"] = struct{}{}
				}
				if summary.effect&durableSQLite != 0 {
					kinds["sqlite"] = struct{}{}
					tables = append(tables, summary.tables...)
				}
			}
			return true
		}
		root := selectorRootName(selector.X)
		name := selector.Sel.Name
		receiver := durableExpressionCapability(selector.X, file.imports, environment, summaries, typeCaps)
		if file.imports[root] == "" {
			summary := summaries[durableMethodCallKey(selector.X, types)+"."+name]
			if summary.effect&durableFile != 0 {
				kinds["file"] = struct{}{}
			}
			if summary.effect&durableSQLite != 0 {
				kinds["sqlite"] = struct{}{}
				tables = append(tables, summary.tables...)
			}
		}
		switch file.imports[root] {
		case "os":
			if contains([]string{"WriteFile", "Create", "CreateTemp", "OpenFile"}, name) {
				kinds["file"] = struct{}{}
			}
		case "io":
			if name == "WriteString" && len(call.Args) > 0 && durableExpressionCapability(call.Args[0], file.imports, environment, summaries, typeCaps)&durableFile != 0 {
				kinds["file"] = struct{}{}
			}
		case "database/sql":
			if name == "Open" {
				kinds["sqlite"] = struct{}{}
			}
		case "encoding/json":
			if name == "NewEncoder" && len(call.Args) > 0 && durableExpressionCapability(call.Args[0], file.imports, environment, summaries, typeCaps)&durableFile != 0 {
				kinds["file"] = struct{}{}
			}
		}
		if receiver&durableFile != 0 && contains([]string{"Write", "WriteString"}, name) {
			kinds["file"] = struct{}{}
		}
		if receiver&durableSQLite != 0 && isSQLMethod(name) {
			kinds["sqlite"] = struct{}{}
			if argument := sqlCallArgument(call, name); argument != nil {
				tables = append(tables, extractSQLArgumentTables(file.fileSet, argument)...)
			}
		}
		return true
	})
	return Finding{
		SinkKinds: mapKeys(kinds),
		Tables:    uniqueSorted(tables),
		Codecs:    uniqueSorted(codecs),
		DTOs:      uniqueSorted(dtos),
	}
}

func durableCallCodecInventory(call *ast.CallExpr, file *parsedDurableGoFile, types map[string]string, summaries map[string]durableFunctionSummary) ([]string, []string) {
	switch function := call.Fun.(type) {
	case *ast.Ident:
		summary, ok := summaries[function.Name]
		if !ok {
			return nil, nil
		}
		return summary.codecs, summary.dtos
	case *ast.SelectorExpr:
		if file.imports[selectorRootName(function.X)] == "" {
			summary := summaries[durableMethodCallKey(function.X, types)+"."+function.Sel.Name]
			return summary.codecs, summary.dtos
		}
		if file.imports[selectorRootName(function.X)] != "encoding/json" || !contains([]string{"Marshal", "MarshalIndent"}, function.Sel.Name) {
			return nil, nil
		}
		var dtos []string
		if len(call.Args) > 0 {
			dtos = append(dtos, renderExpression(file.fileSet, call.Args[0]))
		}
		return []string{"encoding/json." + function.Sel.Name}, dtos
	}
	return nil, nil
}
