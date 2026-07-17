package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type taskSpecFile struct {
	Version string         `yaml:"version"`
	Tasks   []taskSpecItem `yaml:"tasks"`
}

type taskSpecItem struct {
	ID         string             `yaml:"id"`
	Title      string             `yaml:"title"`
	Stage      string             `yaml:"stage"`
	Category   string             `yaml:"category"`
	Turns      []string           `yaml:"turns"`
	Runtime    taskRuntimeSpec    `yaml:"runtime"`
	Assertions taskAssertionsSpec `yaml:"assertions"`
}

type taskWorkspaceSpec struct {
	Mode    string `yaml:"mode"`
	Fixture string `yaml:"fixture"`
}

type taskRuntimeSpec struct {
	PermissionType                   string            `yaml:"permission_type"`
	TimeoutSeconds                   int               `yaml:"timeout_seconds"`
	ReasoningOnly                    bool              `yaml:"reasoning_only"`
	RequireUserConfirmOnTaskComplete bool              `yaml:"require_user_confirm_on_task_complete"`
	NoUserInteraction                bool              `yaml:"no_user_interaction"`
	Workspace                        taskWorkspaceSpec `yaml:"workspace"`
}

type taskAssertionsSpec struct {
	Output taskOutputAssertions `yaml:"output"`
	Thread taskThreadAssertions `yaml:"thread"`
	Tools  taskToolAssertions   `yaml:"tools"`
	Todos  taskTodoAssertions   `yaml:"todos"`
}

type taskOutputAssertions struct {
	RequireEvidence        bool     `yaml:"require_evidence"`
	MinEvidencePaths       int      `yaml:"min_evidence_paths"`
	MinLength              int      `yaml:"min_length"`
	MustContain            []string `yaml:"must_contain"`
	Forbidden              []string `yaml:"forbidden"`
	MustNotEndWithFallback bool     `yaml:"must_not_end_with_fallback"`
}

type taskThreadAssertions struct {
	RunStatus      string `yaml:"run_status"`
	PermissionType string `yaml:"permission_type"`
	WaitingPrompt  string `yaml:"waiting_prompt"`
}

type taskToolAssertions struct {
	MustCall             []string `yaml:"must_call"`
	MustNotCall          []string `yaml:"must_not_call"`
	MustSucceed          []string `yaml:"must_succeed"`
	WorkspaceScopedTools []string `yaml:"workspace_scoped_tools"`
	MaxCalls             int      `yaml:"max_calls"`
}

type taskTodoAssertions struct {
	RequireSnapshot             bool `yaml:"require_snapshot"`
	RequireNonEmpty             bool `yaml:"require_non_empty"`
	RequireClosed               bool `yaml:"require_closed"`
	RequireInProgressDiscipline bool `yaml:"require_in_progress_discipline"`
}

type evalTask struct {
	ID         string             `json:"id"`
	Title      string             `json:"title"`
	Stage      string             `json:"stage"`
	Category   string             `json:"category,omitempty"`
	Turns      []string           `json:"turns"`
	Runtime    evalTaskRuntime    `json:"runtime"`
	Assertions taskAssertionsSpec `json:"assertions"`
}

type evalTaskWorkspace struct {
	Mode        string `json:"mode"`
	FixturePath string `json:"fixture_path,omitempty"`
}

type evalTaskRuntime struct {
	PermissionType                   string            `json:"permission_type"`
	TimeoutPerTurn                   time.Duration     `json:"-"`
	TimeoutSeconds                   int               `json:"timeout_seconds"`
	ReasoningOnly                    bool              `json:"reasoning_only,omitempty"`
	RequireUserConfirmOnTaskComplete bool              `json:"require_user_confirm_on_task_complete,omitempty"`
	NoUserInteraction                bool              `json:"no_user_interaction,omitempty"`
	Workspace                        evalTaskWorkspace `json:"workspace"`
}

const (
	taskWorkspaceModeNone           = "none"
	taskWorkspaceModeSourceReadonly = "source_readonly"
	taskWorkspaceModeFixtureCopy    = "fixture_copy"
)

func loadTaskSpecs(specPath string) ([]evalTask, error) {
	cleanPath := strings.TrimSpace(specPath)
	if cleanPath == "" {
		return nil, fmt.Errorf("missing task spec path")
	}
	cleanPath = filepath.Clean(cleanPath)
	data, err := os.ReadFile(cleanPath)
	if err != nil {
		return nil, err
	}
	var spec taskSpecFile
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&spec); err != nil {
		return nil, err
	}
	if len(spec.Tasks) == 0 {
		return nil, fmt.Errorf("task spec has no tasks")
	}
	specDir := filepath.Dir(cleanPath)
	out := make([]evalTask, 0, len(spec.Tasks))
	for _, item := range spec.Tasks {
		task, err := normalizeTaskSpecItem(item, specDir)
		if err != nil {
			return nil, err
		}
		out = append(out, task)
	}
	return out, nil
}

func normalizeTaskSpecItem(item taskSpecItem, specDir string) (evalTask, error) {
	id := strings.TrimSpace(item.ID)
	if id == "" {
		return evalTask{}, fmt.Errorf("task id is empty")
	}
	stage := strings.TrimSpace(strings.ToLower(item.Stage))
	if stage != "screen" && stage != "deep" {
		return evalTask{}, fmt.Errorf("task %s has invalid stage: %s", id, item.Stage)
	}

	turns := make([]string, 0, len(item.Turns))
	for _, turn := range item.Turns {
		turn = strings.TrimSpace(turn)
		if turn == "" {
			continue
		}
		turns = append(turns, turn)
	}
	if len(turns) == 0 {
		return evalTask{}, fmt.Errorf("task %s has no turns", id)
	}

	timeoutSeconds := item.Runtime.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 45
	}

	workspace, err := normalizeTaskWorkspaceSpec(item.Runtime.Workspace, specDir)
	if err != nil {
		return evalTask{}, fmt.Errorf("task %s has invalid workspace config: %w", id, err)
	}

	permissionType := normalizeEvalPermissionType(item.Runtime.PermissionType)
	if permissionType == "" && strings.TrimSpace(item.Runtime.PermissionType) != "" {
		return evalTask{}, fmt.Errorf("task %s has invalid permission_type: %s", id, item.Runtime.PermissionType)
	}
	if permissionType == "" {
		permissionType = "approval_required"
	}
	if workspace.Mode == taskWorkspaceModeSourceReadonly {
		if permissionType != "readonly" && strings.TrimSpace(item.Runtime.PermissionType) != "" {
			return evalTask{}, fmt.Errorf("task %s uses %s workspace but permission_type is %s", id, taskWorkspaceModeSourceReadonly, item.Runtime.PermissionType)
		}
		permissionType = "readonly"
	}

	assertions := item.Assertions
	assertions.Output.MustContain = normalizeStringSlice(assertions.Output.MustContain)
	assertions.Output.Forbidden = normalizeStringSlice(assertions.Output.Forbidden)
	assertions.Tools.MustCall = normalizeStringSlice(assertions.Tools.MustCall)
	assertions.Tools.MustNotCall = normalizeStringSlice(assertions.Tools.MustNotCall)
	assertions.Tools.MustSucceed = normalizeStringSlice(assertions.Tools.MustSucceed)
	assertions.Tools.WorkspaceScopedTools = normalizeStringSlice(assertions.Tools.WorkspaceScopedTools)

	waitingPrompt := strings.TrimSpace(strings.ToLower(assertions.Thread.WaitingPrompt))
	switch waitingPrompt {
	case "", "ignore", "required", "forbidden":
	default:
		return evalTask{}, fmt.Errorf("task %s has invalid waiting_prompt: %s", id, assertions.Thread.WaitingPrompt)
	}
	assertions.Thread.WaitingPrompt = waitingPrompt

	if status := normalizeRunStateName(assertions.Thread.RunStatus); status == "" && strings.TrimSpace(assertions.Thread.RunStatus) != "" {
		return evalTask{}, fmt.Errorf("task %s has invalid run_status: %s", id, assertions.Thread.RunStatus)
	} else {
		assertions.Thread.RunStatus = status
	}

	if permission := normalizeEvalPermissionType(assertions.Thread.PermissionType); permission == "" && strings.TrimSpace(assertions.Thread.PermissionType) != "" {
		return evalTask{}, fmt.Errorf("task %s has invalid thread permission_type: %s", id, assertions.Thread.PermissionType)
	} else {
		assertions.Thread.PermissionType = permission
	}

	if assertions.Output.MinEvidencePaths < 0 || assertions.Output.MinLength < 0 {
		return evalTask{}, fmt.Errorf("task %s has invalid output thresholds", id)
	}
	if assertions.Tools.MaxCalls < 0 {
		return evalTask{}, fmt.Errorf("task %s has invalid max_calls", id)
	}

	return evalTask{
		ID:       id,
		Title:    strings.TrimSpace(item.Title),
		Stage:    stage,
		Category: strings.TrimSpace(strings.ToLower(item.Category)),
		Turns:    turns,
		Runtime: evalTaskRuntime{
			PermissionType:                   permissionType,
			TimeoutPerTurn:                   time.Duration(timeoutSeconds) * time.Second,
			TimeoutSeconds:                   timeoutSeconds,
			ReasoningOnly:                    item.Runtime.ReasoningOnly,
			RequireUserConfirmOnTaskComplete: item.Runtime.RequireUserConfirmOnTaskComplete,
			NoUserInteraction:                item.Runtime.NoUserInteraction,
			Workspace:                        workspace,
		},
		Assertions: assertions,
	}, nil
}

func normalizeTaskWorkspaceSpec(raw taskWorkspaceSpec, specDir string) (evalTaskWorkspace, error) {
	mode := strings.TrimSpace(strings.ToLower(raw.Mode))
	if mode == "" {
		mode = taskWorkspaceModeSourceReadonly
	}
	fixture := strings.TrimSpace(raw.Fixture)
	switch mode {
	case taskWorkspaceModeNone:
		if fixture != "" {
			return evalTaskWorkspace{}, fmt.Errorf("fixture is only supported for %s mode", taskWorkspaceModeFixtureCopy)
		}
		return evalTaskWorkspace{Mode: mode}, nil
	case taskWorkspaceModeSourceReadonly:
		if fixture != "" {
			return evalTaskWorkspace{}, fmt.Errorf("fixture is only supported for %s mode", taskWorkspaceModeFixtureCopy)
		}
		return evalTaskWorkspace{Mode: mode}, nil
	case taskWorkspaceModeFixtureCopy:
		if fixture == "" {
			return evalTaskWorkspace{}, fmt.Errorf("fixture is required for %s mode", taskWorkspaceModeFixtureCopy)
		}
		fixturePath := fixture
		if !filepath.IsAbs(fixturePath) {
			fixturePath = filepath.Join(specDir, fixturePath)
		}
		fixturePath, err := filepath.Abs(fixturePath)
		if err != nil {
			return evalTaskWorkspace{}, err
		}
		fixturePath = filepath.Clean(fixturePath)
		info, err := os.Stat(fixturePath)
		if err != nil {
			return evalTaskWorkspace{}, err
		}
		if !info.IsDir() {
			return evalTaskWorkspace{}, fmt.Errorf("fixture must be a directory")
		}
		return evalTaskWorkspace{
			Mode:        mode,
			FixturePath: fixturePath,
		}, nil
	default:
		return evalTaskWorkspace{}, fmt.Errorf("unsupported mode %q", raw.Mode)
	}
}

func normalizeEvalPermissionType(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "":
		return ""
	case "readonly", "approval_required", "full_access":
		return strings.TrimSpace(strings.ToLower(raw))
	default:
		return ""
	}
}

func normalizeRunStateName(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "":
		return ""
	case "idle", "accepted", "running", "waiting_approval", "recovering", "finalizing", "waiting_user", "success", "failed", "canceled", "timed_out":
		return strings.TrimSpace(strings.ToLower(raw))
	default:
		return ""
	}
}

func normalizeStringSlice(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	for _, item := range in {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
