package tools

import (
	"fmt"
	"strings"
)

func presentation(kind ToolPresentationKind, risk string, renderer string, groupKey string, detailKinds ...string) ToolPresentationSpec {
	return ToolPresentationSpec{
		Kind:     kind,
		Risk:     strings.TrimSpace(risk),
		Renderer: strings.TrimSpace(renderer),
		Grouping: ToolGroupingPolicy{
			Enabled:        strings.TrimSpace(groupKey) != "",
			GroupKey:       strings.TrimSpace(groupKey),
			MergeWindowMS:  2500,
			MaxInlineItems: 4,
		},
		DetailKinds:    append([]string(nil), detailKinds...),
		SummaryVersion: 1,
	}
}

var builtinDefinitions = map[string]Definition{
	"file.read": {
		Name:             "file.read",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationContext, "readonly", "file", "context", "args", "result"),
	},
	"file.edit": {
		Name:             "file.edit",
		Mutating:         true,
		RequiresApproval: true,
		Presentation:     presentation(ToolPresentationMutation, "approval", "file", "mutation", "args", "result", "error"),
	},
	"file.write": {
		Name:             "file.write",
		Mutating:         true,
		RequiresApproval: true,
		Presentation:     presentation(ToolPresentationMutation, "approval", "file", "mutation", "args", "result", "error"),
	},
	"apply_patch": {
		Name:             "apply_patch",
		Mutating:         true,
		RequiresApproval: true,
		Presentation:     presentation(ToolPresentationMutation, "approval", "patch", "mutation", "args", "result", "error"),
	},
	"terminal.exec": {
		Name:             "terminal.exec",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationCommand, "readonly", "terminal", "terminal", "terminal", "error"),
	},
	"web.search": {
		Name:             "web.search",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationResearch, "readonly", "web_search", "research", "web_search", "args"),
	},
	"sources": {
		Name:             "sources",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationResearch, "readonly", "web_search", "research", "web_search"),
	},
	"knowledge.search": {
		Name:             "knowledge.search",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationResearch, "readonly", "structured", "research", "result", "args"),
	},
	"write_todos": {
		Name:             "write_todos",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationTodo, "readonly", "todos", "todo", "result"),
	},
	"exit_plan_mode": {
		Name:             "exit_plan_mode",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationSignal, "blocking", "question", "interaction", "args", "result"),
	},
	"task_complete": {
		Name:             "task_complete",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationSignal, "blocking", "completion", "interaction", "args", "result"),
	},
	"ask_user": {
		Name:             "ask_user",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationInteraction, "blocking", "question", "interaction", "args", "result"),
	},
	"use_skill": {
		Name:             "use_skill",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationContext, "readonly", "structured", "context", "args", "result"),
	},
	"subagents": {
		Name:             "subagents",
		Mutating:         false,
		RequiresApproval: false,
		Presentation:     presentation(ToolPresentationDelegation, "readonly", "structured", "delegation", "args", "result", "error"),
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

func PresentationSpec(toolName string) (ToolPresentationSpec, bool) {
	def, ok := LookupDefinition(toolName)
	if !ok || ValidatePresentationSpec(toolName, def.Presentation) != nil {
		return ToolPresentationSpec{}, false
	}
	return def.Presentation, true
}

func MustPresentationSpec(toolName string) ToolPresentationSpec {
	spec, ok := PresentationSpec(toolName)
	if !ok {
		panic(fmt.Sprintf("missing presentation spec for tool %q", strings.TrimSpace(toolName)))
	}
	return spec
}

func ValidatePresentationSpec(toolName string, spec ToolPresentationSpec) error {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return fmt.Errorf("tool name is required")
	}
	if spec.Kind == "" {
		return fmt.Errorf("tool %s missing presentation kind", name)
	}
	if strings.TrimSpace(spec.Renderer) == "" {
		return fmt.Errorf("tool %s missing presentation renderer", name)
	}
	if strings.TrimSpace(spec.Grouping.GroupKey) == "" {
		return fmt.Errorf("tool %s missing presentation group key", name)
	}
	if spec.SummaryVersion <= 0 {
		return fmt.Errorf("tool %s missing presentation summary version", name)
	}
	return nil
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
