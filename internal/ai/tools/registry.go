package tools

import "strings"

var builtinDefinitions = map[string]Definition{
	"fs.list_dir": {
		Name:             "fs.list_dir",
		Mutating:         false,
		RequiresApproval: false,
	},
	"fs.stat": {
		Name:             "fs.stat",
		Mutating:         false,
		RequiresApproval: false,
	},
	"fs.read_file": {
		Name:             "fs.read_file",
		Mutating:         false,
		RequiresApproval: false,
	},
	"fs.write_file": {
		Name:             "fs.write_file",
		Mutating:         true,
		RequiresApproval: true,
	},
	"terminal.exec": {
		Name:             "terminal.exec",
		Mutating:         true,
		RequiresApproval: true,
	},
}

func LookupDefinition(toolName string) (Definition, bool) {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return Definition{}, false
	}
	def, ok := builtinDefinitions[name]
	if !ok {
		return Definition{}, false
	}
	return def, true
}

func RequiresApproval(toolName string) bool {
	def, ok := LookupDefinition(toolName)
	return ok && def.RequiresApproval
}

func IsMutating(toolName string) bool {
	def, ok := LookupDefinition(toolName)
	return ok && def.Mutating
}
