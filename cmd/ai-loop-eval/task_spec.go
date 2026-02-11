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
	ID                     string   `yaml:"id"`
	Title                  string   `yaml:"title"`
	Stage                  string   `yaml:"stage"`
	Category               string   `yaml:"category"`
	Turns                  []string `yaml:"turns"`
	MaxSteps               int      `yaml:"max_steps"`
	TimeoutSeconds         int      `yaml:"timeout_seconds"`
	RequireEvidence        bool     `yaml:"require_evidence"`
	MustContain            []string `yaml:"must_contain"`
	Forbidden              []string `yaml:"forbidden"`
	HardFailEvents         []string `yaml:"hard_fail_events"`
	MustNotEndWithFallback bool     `yaml:"must_not_end_with_fallback"`
}

func loadTaskSpecs(specPath string, workspacePath string) ([]evalTask, error) {
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
		id := strings.TrimSpace(item.ID)
		if id == "" {
			return nil, fmt.Errorf("task id is empty")
		}
		stage := strings.TrimSpace(strings.ToLower(item.Stage))
		if stage != "screen" && stage != "deep" {
			return nil, fmt.Errorf("task %s has invalid stage: %s", id, item.Stage)
		}
		turns := make([]string, 0, len(item.Turns))
		for _, turn := range item.Turns {
			turn = strings.TrimSpace(turn)
			if turn == "" {
				continue
			}
			turn = strings.ReplaceAll(turn, "${workspace}", workspacePath)
			turns = append(turns, turn)
		}
		if len(turns) == 0 {
			return nil, fmt.Errorf("task %s has no turns", id)
		}
		timeoutSeconds := item.TimeoutSeconds
		if timeoutSeconds <= 0 {
			timeoutSeconds = 30
		}
		maxSteps := item.MaxSteps
		if maxSteps <= 0 {
			maxSteps = 4
		}
		out = append(out, evalTask{
			ID:                     id,
			Title:                  strings.TrimSpace(item.Title),
			Stage:                  stage,
			Category:               strings.TrimSpace(strings.ToLower(item.Category)),
			Turns:                  turns,
			MaxSteps:               maxSteps,
			TimeoutPerTurn:         time.Duration(timeoutSeconds) * time.Second,
			RequireEvidence:        item.RequireEvidence,
			MustContain:            normalizeStringSlice(item.MustContain),
			Forbidden:              normalizeStringSlice(item.Forbidden),
			HardFailEvents:         normalizeStringSlice(item.HardFailEvents),
			MustNotEndWithFallback: item.MustNotEndWithFallback,
		})
	}
	return out, nil
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
