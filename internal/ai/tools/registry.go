package tools

import "strings"

var builtinDefinitions = map[string]Definition{
	"file.read": {
		Name:             "file.read",
		Mutating:         false,
		RequiresApproval: false,
	},
	"file.edit": {
		Name:             "file.edit",
		Mutating:         true,
		RequiresApproval: true,
	},
	"file.write": {
		Name:             "file.write",
		Mutating:         true,
		RequiresApproval: true,
	},
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
	"web.search": {
		Name:             "web.search",
		Mutating:         false,
		RequiresApproval: false,
	},
	"knowledge.search": {
		Name:             "knowledge.search",
		Mutating:         false,
		RequiresApproval: false,
	},
	"write_todos": {
		Name:             "write_todos",
		Mutating:         false,
		RequiresApproval: false,
	},
	"exit_plan_mode": {
		Name:             "exit_plan_mode",
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
		profile := InvocationCommandProfile(name, args)
		return profile.Risk != TerminalCommandRiskReadonly
	}
	return RequiresApproval(name)
}

func IsMutatingForInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name == "terminal.exec" {
		profile := InvocationCommandProfile(name, args)
		return profile.Risk != TerminalCommandRiskReadonly
	}
	return IsMutating(name)
}

func IsDangerousInvocation(toolName string, args map[string]any) bool {
	name := strings.TrimSpace(toolName)
	if name != "terminal.exec" {
		return false
	}
	profile := InvocationCommandProfile(name, args)
	return profile.Risk == TerminalCommandRiskDangerous
}

func InvocationRiskLabel(toolName string, args map[string]any) string {
	risk, _ := InvocationRiskInfo(toolName, args)
	return risk
}

func InvocationCommandProfile(toolName string, args map[string]any) TerminalCommandProfile {
	name := strings.TrimSpace(toolName)
	if name != "terminal.exec" {
		return TerminalCommandProfile{}
	}
	command := commandFromArgs(args)
	return ProfileTerminalCommand(command)
}

func InvocationRiskInfo(toolName string, args map[string]any) (string, string) {
	profile := InvocationCommandProfile(toolName, args)
	if profile.Risk == "" {
		return "", ""
	}
	return string(profile.Risk), profile.NormalizedCommand
}
