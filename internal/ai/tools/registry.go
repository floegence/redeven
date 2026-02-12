package tools

import "strings"

var builtinDefinitions = map[string]Definition{
	"apply_patch": {
		Name:             "apply_patch",
		Mutating:         true,
		RequiresApproval: true,
	},
	"terminal.exec": {
		Name:             "terminal.exec",
		Mutating:         false,
		RequiresApproval: false,
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

func RequiresApprovalForInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name == "terminal.exec" {
		risk := ClassifyTerminalCommandRisk(commandFromArgs(args))
		return risk != TerminalCommandRiskReadonly
	}
	return RequiresApproval(name)
}

func IsMutatingForInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name == "terminal.exec" {
		risk := ClassifyTerminalCommandRisk(commandFromArgs(args))
		return risk != TerminalCommandRiskReadonly
	}
	return IsMutating(name)
}

func IsDangerousInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name != "terminal.exec" {
		return false
	}
	risk := ClassifyTerminalCommandRisk(commandFromArgs(args))
	return risk == TerminalCommandRiskDangerous
}

func InvocationRiskLabel(toolName string, args map[string]any) string {
	name := strings.TrimSpace(toolName)
	if name != "terminal.exec" {
		return ""
	}
	return string(ClassifyTerminalCommandRisk(commandFromArgs(args)))
}
