package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type taskOutcome struct {
	Passed            bool     `json:"passed"`
	LoopSafe          bool     `json:"loop_safe"`
	FallbackFinal     bool     `json:"fallback_final"`
	RecoveryCandidate bool     `json:"recovery_candidate"`
	RecoverySucceeded bool     `json:"recovery_succeeded"`
	HardFailReasons   []string `json:"hard_fail_reasons,omitempty"`
}

type variantMetrics struct {
	VariantID            string  `json:"variant_id"`
	TaskCount            int     `json:"task_count"`
	PassedTasks          int     `json:"passed_tasks"`
	LoopSafeTasks        int     `json:"loop_safe_tasks"`
	FallbackFreeTasks    int     `json:"fallback_free_tasks"`
	RecoveryCandidates   int     `json:"recovery_candidates"`
	RecoverySucceeded    int     `json:"recovery_succeeded"`
	PassRate             float64 `json:"pass_rate"`
	LoopSafetyRate       float64 `json:"loop_safety_rate"`
	FallbackFreeRate     float64 `json:"fallback_free_rate"`
	RecoverySuccessRate  float64 `json:"recovery_success_rate"`
	AverageAccuracy      float64 `json:"average_accuracy"`
	AverageNatural       float64 `json:"average_natural"`
	AverageEfficiency    float64 `json:"average_efficiency"`
	AverageOverall       float64 `json:"average_overall"`
	HardFailCount        int     `json:"hard_fail_count"`
	HasLoopExhaustedTask bool    `json:"has_loop_exhausted_task"`
}

type benchmarkMetrics struct {
	PassRate            float64 `json:"pass_rate"`
	LoopSafetyRate      float64 `json:"loop_safety_rate"`
	RecoverySuccessRate float64 `json:"recovery_success_rate"`
	FallbackFreeRate    float64 `json:"fallback_free_rate"`
	AverageAccuracy     float64 `json:"average_accuracy"`
}

type benchmarkBaselines struct {
	Sources map[string]benchmarkMetrics `json:"sources"`
}

type gateThresholds struct {
	MinPassRate         float64 `json:"min_pass_rate"`
	MinLoopSafetyRate   float64 `json:"min_loop_safety_rate"`
	MinFallbackFreeRate float64 `json:"min_fallback_free_rate"`
	MinAverageAccuracy  float64 `json:"min_average_accuracy"`
}

type gateVariantDecision struct {
	Variant evalVariant     `json:"variant"`
	Metrics variantMetrics  `json:"metrics"`
	Passed  bool            `json:"passed"`
	Reasons []string        `json:"reasons,omitempty"`
	Delta   benchmarkDeltas `json:"delta_vs_best"`
}

type benchmarkDeltas struct {
	PassRate            float64 `json:"pass_rate"`
	LoopSafetyRate      float64 `json:"loop_safety_rate"`
	RecoverySuccessRate float64 `json:"recovery_success_rate"`
	FallbackFreeRate    float64 `json:"fallback_free_rate"`
	AverageAccuracy     float64 `json:"average_accuracy"`
}

type gateReport struct {
	Enabled              bool                  `json:"enabled"`
	BaselinePath         string                `json:"baseline_path,omitempty"`
	Thresholds           gateThresholds        `json:"thresholds"`
	ReferenceBest        benchmarkMetrics      `json:"reference_best"`
	VariantDecisions     []gateVariantDecision `json:"variant_decisions"`
	PassedVariantIDs     []string              `json:"passed_variant_ids"`
	Status               string                `json:"status"`
	FailReasons          []string              `json:"fail_reasons,omitempty"`
	RecommendedVariantID string                `json:"recommended_variant_id,omitempty"`
}

var fallbackFinalPhrases = []string{
	"i have reached the current automatic loop limit",
	"reply with one concrete next step",
	"assistant finished without a visible response",
	"tool workflow failed",
	"no response",
}

func assessTaskOutcome(task evalTask, result taskResult) taskOutcome {
	out := taskOutcome{
		Passed:            true,
		LoopSafe:          true,
		FallbackFinal:     false,
		RecoveryCandidate: false,
		RecoverySucceeded: true,
		HardFailReasons:   nil,
	}

	finalTextLower := strings.ToLower(strings.TrimSpace(result.FinalText))
	for _, phrase := range fallbackFinalPhrases {
		if strings.Contains(finalTextLower, phrase) {
			out.FallbackFinal = true
			out.Passed = false
			out.LoopSafe = false
			out.HardFailReasons = append(out.HardFailReasons, "fallback_final_message")
			break
		}
	}

	hardEventSet := make(map[string]struct{}, len(task.HardFailEvents))
	for _, evt := range task.HardFailEvents {
		key := strings.TrimSpace(strings.ToLower(evt))
		if key == "" {
			continue
		}
		hardEventSet[key] = struct{}{}
	}

	for _, turn := range result.Turns {
		if turn.ToolErrorCount > 0 || turn.RecoveryCount > 0 || turn.CompletionRetrys > 0 || turn.TaskLoopContinue > 0 {
			out.RecoveryCandidate = true
		}
		if turn.LoopExhausted || turn.PhasePingPong || turn.FinalizationReason == "task_turn_limit_reached" {
			out.LoopSafe = false
			out.Passed = false
		}
		if turn.LoopExhausted {
			out.HardFailReasons = append(out.HardFailReasons, "turn_loop_exhausted")
		}
		if turn.PhasePingPong {
			out.HardFailReasons = append(out.HardFailReasons, "phase_pingpong_detected")
		}
		if _, ok := hardEventSet["turn.completion.continue"]; ok && turn.CompletionRetrys > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "turn_completion_continue")
		}
		if _, ok := hardEventSet["task.loop.continue"]; ok && turn.TaskLoopContinue > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "task_loop_continue")
		}
		if _, ok := hardEventSet["turn.loop.exhausted"]; ok && turn.LoopExhausted {
			out.Passed = false
		}
		if strings.TrimSpace(turn.MonitorAbort) != "" {
			out.Passed = false
			out.LoopSafe = false
			out.HardFailReasons = append(out.HardFailReasons, "monitor_abort:"+strings.TrimSpace(turn.MonitorAbort))
		}
		if strings.TrimSpace(turn.RunError) != "" {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "run_error")
		}
	}

	if !containsAllRequirements(finalTextLower, task.MustContain) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "missing_must_contain")
	}
	if containsForbidden(finalTextLower, task.Forbidden) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "contains_forbidden")
	}
	if task.RequireEvidence && !containsEvidencePath(result.FinalText, result.WorkspacePath) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "missing_evidence_path")
	}

	if out.RecoveryCandidate {
		out.RecoverySucceeded = out.Passed && !out.FallbackFinal
	} else {
		out.RecoverySucceeded = true
	}

	if len(out.HardFailReasons) > 0 {
		out.HardFailReasons = uniqueStrings(out.HardFailReasons)
	}
	return out
}

func containsAllRequirements(text string, reqs []string) bool {
	for _, req := range reqs {
		if !matchesRequirement(text, req) {
			return false
		}
	}
	return true
}

func containsForbidden(text string, forbidden []string) bool {
	for _, ban := range forbidden {
		if strings.Contains(text, strings.ToLower(strings.TrimSpace(ban))) {
			return true
		}
	}
	return false
}

func uniqueStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, item := range in {
		key := strings.TrimSpace(strings.ToLower(item))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	return out
}

func aggregateVariantMetrics(results []taskResult) map[string]variantMetrics {
	byVariant := make(map[string][]taskResult)
	for _, result := range results {
		byVariant[result.Variant.ID] = append(byVariant[result.Variant.ID], result)
	}
	out := make(map[string]variantMetrics, len(byVariant))
	for variantID, items := range byVariant {
		metrics := variantMetrics{VariantID: variantID, TaskCount: len(items)}
		for _, item := range items {
			outcome := item.Outcome
			if outcome.Passed {
				metrics.PassedTasks++
			}
			if outcome.LoopSafe {
				metrics.LoopSafeTasks++
			}
			if !outcome.FallbackFinal {
				metrics.FallbackFreeTasks++
			}
			if outcome.RecoveryCandidate {
				metrics.RecoveryCandidates++
				if outcome.RecoverySucceeded {
					metrics.RecoverySucceeded++
				}
			}
			if !outcome.LoopSafe {
				metrics.HasLoopExhaustedTask = true
			}
			if len(outcome.HardFailReasons) > 0 {
				metrics.HardFailCount += len(outcome.HardFailReasons)
			}
			metrics.AverageAccuracy += item.Score.Accuracy
			metrics.AverageNatural += item.Score.Natural
			metrics.AverageEfficiency += item.Score.Efficiency
			metrics.AverageOverall += item.Score.Overall
		}
		if metrics.TaskCount > 0 {
			den := float64(metrics.TaskCount)
			metrics.PassRate = float64(metrics.PassedTasks) / den
			metrics.LoopSafetyRate = float64(metrics.LoopSafeTasks) / den
			metrics.FallbackFreeRate = float64(metrics.FallbackFreeTasks) / den
			metrics.AverageAccuracy = metrics.AverageAccuracy / den
			metrics.AverageNatural = metrics.AverageNatural / den
			metrics.AverageEfficiency = metrics.AverageEfficiency / den
			metrics.AverageOverall = metrics.AverageOverall / den
		}
		if metrics.RecoveryCandidates > 0 {
			metrics.RecoverySuccessRate = float64(metrics.RecoverySucceeded) / float64(metrics.RecoveryCandidates)
		} else {
			metrics.RecoverySuccessRate = 1.0
		}
		out[variantID] = metrics
	}
	return out
}

func loadBenchmarkBaselines(path string) (benchmarkBaselines, error) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return benchmarkBaselines{}, fmt.Errorf("missing baseline path")
	}
	cleanPath = filepath.Clean(cleanPath)
	b, err := os.ReadFile(cleanPath)
	if err != nil {
		return benchmarkBaselines{}, err
	}
	var out benchmarkBaselines
	if err := json.Unmarshal(b, &out); err != nil {
		return benchmarkBaselines{}, err
	}
	if len(out.Sources) == 0 {
		return benchmarkBaselines{}, fmt.Errorf("baseline sources is empty")
	}
	return out, nil
}

func referenceBestMetrics(baselines benchmarkBaselines) benchmarkMetrics {
	best := benchmarkMetrics{}
	first := true
	for _, metrics := range baselines.Sources {
		if first {
			best = metrics
			first = false
			continue
		}
		if metrics.PassRate > best.PassRate {
			best.PassRate = metrics.PassRate
		}
		if metrics.LoopSafetyRate > best.LoopSafetyRate {
			best.LoopSafetyRate = metrics.LoopSafetyRate
		}
		if metrics.RecoverySuccessRate > best.RecoverySuccessRate {
			best.RecoverySuccessRate = metrics.RecoverySuccessRate
		}
		if metrics.FallbackFreeRate > best.FallbackFreeRate {
			best.FallbackFreeRate = metrics.FallbackFreeRate
		}
		if metrics.AverageAccuracy > best.AverageAccuracy {
			best.AverageAccuracy = metrics.AverageAccuracy
		}
	}
	return best
}

func evaluateGate(
	variants []evalVariant,
	variantMetricsMap map[string]variantMetrics,
	baselines benchmarkBaselines,
	thresholds gateThresholds,
	recommended evalVariant,
) gateReport {
	reference := referenceBestMetrics(baselines)
	decisions := make([]gateVariantDecision, 0, len(variants))
	passedIDs := make([]string, 0, len(variants))

	for _, variant := range variants {
		metrics, ok := variantMetricsMap[variant.ID]
		if !ok {
			decisions = append(decisions, gateVariantDecision{
				Variant: variant,
				Passed:  false,
				Reasons: []string{"missing_variant_metrics"},
			})
			continue
		}
		delta := benchmarkDeltas{
			PassRate:            metrics.PassRate - reference.PassRate,
			LoopSafetyRate:      metrics.LoopSafetyRate - reference.LoopSafetyRate,
			RecoverySuccessRate: metrics.RecoverySuccessRate - reference.RecoverySuccessRate,
			FallbackFreeRate:    metrics.FallbackFreeRate - reference.FallbackFreeRate,
			AverageAccuracy:     metrics.AverageAccuracy - reference.AverageAccuracy,
		}
		reasons := make([]string, 0, 8)
		if metrics.PassRate < thresholds.MinPassRate {
			reasons = append(reasons, fmt.Sprintf("pass_rate %.3f < threshold %.3f", metrics.PassRate, thresholds.MinPassRate))
		}
		if metrics.LoopSafetyRate < thresholds.MinLoopSafetyRate {
			reasons = append(reasons, fmt.Sprintf("loop_safety_rate %.3f < threshold %.3f", metrics.LoopSafetyRate, thresholds.MinLoopSafetyRate))
		}
		if metrics.FallbackFreeRate < thresholds.MinFallbackFreeRate {
			reasons = append(reasons, fmt.Sprintf("fallback_free_rate %.3f < threshold %.3f", metrics.FallbackFreeRate, thresholds.MinFallbackFreeRate))
		}
		if metrics.AverageAccuracy < thresholds.MinAverageAccuracy {
			reasons = append(reasons, fmt.Sprintf("average_accuracy %.2f < threshold %.2f", metrics.AverageAccuracy, thresholds.MinAverageAccuracy))
		}
		if metrics.PassRate < reference.PassRate {
			reasons = append(reasons, fmt.Sprintf("pass_rate %.3f < best_ref %.3f", metrics.PassRate, reference.PassRate))
		}
		if metrics.LoopSafetyRate < reference.LoopSafetyRate {
			reasons = append(reasons, fmt.Sprintf("loop_safety_rate %.3f < best_ref %.3f", metrics.LoopSafetyRate, reference.LoopSafetyRate))
		}
		if metrics.RecoverySuccessRate < reference.RecoverySuccessRate {
			reasons = append(reasons, fmt.Sprintf("recovery_success_rate %.3f < best_ref %.3f", metrics.RecoverySuccessRate, reference.RecoverySuccessRate))
		}
		if metrics.FallbackFreeRate < reference.FallbackFreeRate {
			reasons = append(reasons, fmt.Sprintf("fallback_free_rate %.3f < best_ref %.3f", metrics.FallbackFreeRate, reference.FallbackFreeRate))
		}
		if metrics.AverageAccuracy < reference.AverageAccuracy {
			reasons = append(reasons, fmt.Sprintf("average_accuracy %.2f < best_ref %.2f", metrics.AverageAccuracy, reference.AverageAccuracy))
		}
		passed := len(reasons) == 0
		if passed {
			passedIDs = append(passedIDs, variant.ID)
		}
		decisions = append(decisions, gateVariantDecision{
			Variant: variant,
			Metrics: metrics,
			Passed:  passed,
			Reasons: reasons,
			Delta:   delta,
		})
	}

	sort.Slice(decisions, func(i, j int) bool {
		if decisions[i].Metrics.AverageOverall == decisions[j].Metrics.AverageOverall {
			return decisions[i].Variant.ID < decisions[j].Variant.ID
		}
		return decisions[i].Metrics.AverageOverall > decisions[j].Metrics.AverageOverall
	})

	report := gateReport{
		Enabled:              true,
		Thresholds:           thresholds,
		ReferenceBest:        reference,
		VariantDecisions:     decisions,
		PassedVariantIDs:     passedIDs,
		Status:               "pass",
		RecommendedVariantID: recommended.ID,
	}

	if len(passedIDs) == 0 {
		report.Status = "reject"
		report.FailReasons = []string{"no_variant_passed_hard_gate"}
		return report
	}

	recommendedPassed := false
	for _, id := range passedIDs {
		if id == recommended.ID {
			recommendedPassed = true
			break
		}
	}
	if !recommendedPassed {
		report.Status = "reject"
		report.FailReasons = []string{fmt.Sprintf("recommended_variant_%s_failed_gate", recommended.ID)}
	}

	return report
}
