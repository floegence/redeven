package main

import (
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

type taskRuntimeSpec struct {
	ExecutionMode                    string `yaml:"execution_mode"`
	MaxSteps                         int    `yaml:"max_steps"`
	MaxNoToolRounds                  int    `yaml:"max_no_tool_rounds"`
	TimeoutSeconds                   int    `yaml:"timeout_seconds"`
	ReasoningOnly                    bool   `yaml:"reasoning_only"`
	RequireUserConfirmOnTaskComplete bool   `yaml:"require_user_confirm_on_task_complete"`
	NoUserInteraction                bool   `yaml:"no_user_interaction"`
}

type taskAssertionsSpec struct {
	Output taskOutputAssertions `yaml:"output"`
	Thread taskThreadAssertions `yaml:"thread"`
	Tools  taskToolAssertions   `yaml:"tools"`
	Events taskEventAssertions  `yaml:"events"`
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
	RunStatus     string `yaml:"run_status"`
	ExecutionMode string `yaml:"execution_mode"`
	WaitingPrompt string `yaml:"waiting_prompt"`
}

type taskToolAssertions struct {
	MustCall             []string `yaml:"must_call"`
	MustNotCall          []string `yaml:"must_not_call"`
	MustSucceed          []string `yaml:"must_succeed"`
	WorkspaceScopedTools []string `yaml:"workspace_scoped_tools"`
	MaxCalls             int      `yaml:"max_calls"`
}

type taskEventAssertions struct {
	MustInclude []string `yaml:"must_include"`
	MustNotHave []string `yaml:"must_not_include"`
	HardFail    []string `yaml:"hard_fail"`
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

type evalTaskRuntime struct {
	ExecutionMode                    string        `json:"execution_mode"`
	MaxSteps                         int           `json:"max_steps"`
	MaxNoToolRounds                  int           `json:"max_no_tool_rounds,omitempty"`
	TimeoutPerTurn                   time.Duration `json:"-"`
	TimeoutSeconds                   int           `json:"timeout_seconds"`
	ReasoningOnly                    bool          `json:"reasoning_only,omitempty"`
	RequireUserConfirmOnTaskComplete bool          `json:"require_user_confirm_on_task_complete,omitempty"`
	NoUserInteraction                bool          `json:"no_user_interaction,omitempty"`
}

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
	if err := yaml.Unmarshal(data, &spec); err != nil {
		return nil, err
	}
	if len(spec.Tasks) == 0 {
		return nil, fmt.Errorf("task spec has no tasks")
	}
	out := make([]evalTask, 0, len(spec.Tasks))
	for _, item := range spec.Tasks {
		task, err := normalizeTaskSpecItem(item)
		if err != nil {
			return nil, err
		}
		out = append(out, task)
	}
	return out, nil
}

func normalizeTaskSpecItem(item taskSpecItem) (evalTask, error) {
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

	executionMode := normalizeExecutionMode(item.Runtime.ExecutionMode)
	if executionMode == "" {
		executionMode = "act"
	}

	timeoutSeconds := item.Runtime.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 45
	}

	maxSteps := item.Runtime.MaxSteps
	if maxSteps <= 0 {
		maxSteps = 4
	}

	if item.Runtime.MaxNoToolRounds < 0 {
		return evalTask{}, fmt.Errorf("task %s has invalid max_no_tool_rounds", id)
	}

	assertions := item.Assertions
	assertions.Output.MustContain = normalizeStringSlice(assertions.Output.MustContain)
	assertions.Output.Forbidden = normalizeStringSlice(assertions.Output.Forbidden)
	assertions.Tools.MustCall = normalizeStringSlice(assertions.Tools.MustCall)
	assertions.Tools.MustNotCall = normalizeStringSlice(assertions.Tools.MustNotCall)
	assertions.Tools.MustSucceed = normalizeStringSlice(assertions.Tools.MustSucceed)
	assertions.Tools.WorkspaceScopedTools = normalizeStringSlice(assertions.Tools.WorkspaceScopedTools)
	assertions.Events.MustInclude = normalizeStringSlice(assertions.Events.MustInclude)
	assertions.Events.MustNotHave = normalizeStringSlice(assertions.Events.MustNotHave)
	assertions.Events.HardFail = normalizeStringSlice(assertions.Events.HardFail)

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

	if mode := normalizeExecutionMode(assertions.Thread.ExecutionMode); mode == "" && strings.TrimSpace(assertions.Thread.ExecutionMode) != "" {
		return evalTask{}, fmt.Errorf("task %s has invalid thread execution_mode: %s", id, assertions.Thread.ExecutionMode)
	} else {
		assertions.Thread.ExecutionMode = mode
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
			ExecutionMode:                    executionMode,
			MaxSteps:                         maxSteps,
			MaxNoToolRounds:                  item.Runtime.MaxNoToolRounds,
			TimeoutPerTurn:                   time.Duration(timeoutSeconds) * time.Second,
			TimeoutSeconds:                   timeoutSeconds,
			ReasoningOnly:                    item.Runtime.ReasoningOnly,
			RequireUserConfirmOnTaskComplete: item.Runtime.RequireUserConfirmOnTaskComplete,
			NoUserInteraction:                item.Runtime.NoUserInteraction,
		},
		Assertions: assertions,
	}, nil
}

func normalizeExecutionMode(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "":
		return ""
	case "act":
		return "act"
	case "plan":
		return "plan"
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
