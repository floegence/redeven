package redevpluginintegration

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redevplugin/v2/pkg/ownerscope"
)

type OwnerScopeRecoveryPlan struct {
	PlanSHA256               string `json:"plan_sha256"`
	RootIdentitySHA256       string `json:"root_identity_sha256"`
	SourceSnapshotSHA256     string `json:"source_snapshot_sha256"`
	SourceEntryCount         int    `json:"source_entry_count"`
	SourceBytes              int64  `json:"source_bytes"`
	HasRetainedQuarantine    bool   `json:"has_retained_quarantine"`
	HasSourceRecoveryJournal bool   `json:"has_source_recovery_journal"`
}

func (p OwnerScopeRecoveryPlan) Validate() error {
	for name, value := range map[string]string{
		"plan_sha256":            p.PlanSHA256,
		"root_identity_sha256":   p.RootIdentitySHA256,
		"source_snapshot_sha256": p.SourceSnapshotSHA256,
	} {
		if !validLowerSHA256(value) {
			return fmt.Errorf("invalid %s", name)
		}
	}
	if p.SourceEntryCount < 1 {
		return errors.New("source_entry_count must be positive")
	}
	if p.SourceBytes < 0 {
		return errors.New("source_bytes must not be negative")
	}
	return nil
}

type OwnerScopeRecoveryRequiredError struct {
	Plan  OwnerScopeRecoveryPlan
	cause error
}

func (e *OwnerScopeRecoveryRequiredError) Error() string {
	return "plugin state recovery requires explicit confirmation"
}

func (e *OwnerScopeRecoveryRequiredError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

type OwnerScopeRecoveryResult struct {
	Plan              OwnerScopeRecoveryPlan
	RecoveryID        string
	ArchivePath       string
	GenerationPath    string
	FreshGenerationID string
}

func PrepareOwnerScopeGeneration(ctx context.Context, stateDir string) (ownerscope.OwnerScopeGeneration, error) {
	root, err := ownerScopeRoot(stateDir)
	if err != nil {
		return ownerscope.OwnerScopeGeneration{}, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return ownerscope.OwnerScopeGeneration{}, err
	}
	generation, err := ownerscope.PrepareOwnerScopeGeneration(ctx, root)
	if err == nil {
		return generation, nil
	}
	plan, inspectErr := InspectOwnerScopeRecovery(stateDir)
	if inspectErr != nil {
		return ownerscope.OwnerScopeGeneration{}, err
	}
	return ownerscope.OwnerScopeGeneration{}, &OwnerScopeRecoveryRequiredError{Plan: plan, cause: err}
}

func InspectOwnerScopeRecovery(stateDir string) (OwnerScopeRecoveryPlan, error) {
	root, err := ownerScopeRoot(stateDir)
	if err != nil {
		return OwnerScopeRecoveryPlan{}, err
	}
	plan, err := ownerscope.InspectOwnerScopeRootRecovery(root)
	if err != nil {
		return OwnerScopeRecoveryPlan{}, err
	}
	projected := projectOwnerScopeRecoveryPlan(plan)
	if err := projected.Validate(); err != nil {
		return OwnerScopeRecoveryPlan{}, fmt.Errorf("invalid owner scope recovery plan: %w", err)
	}
	return projected, nil
}

func RecoverOwnerScope(ctx context.Context, stateDir, expectedPlanSHA256 string) (OwnerScopeRecoveryResult, error) {
	root, err := ownerScopeRoot(stateDir)
	if err != nil {
		return OwnerScopeRecoveryResult{}, err
	}
	expectedPlanSHA256 = strings.TrimSpace(expectedPlanSHA256)
	if !validLowerSHA256(expectedPlanSHA256) {
		return OwnerScopeRecoveryResult{}, errors.New("expected plan sha256 is invalid")
	}
	result, err := ownerscope.RecoverOwnerScopeRoot(ctx, root, expectedPlanSHA256)
	if err != nil {
		return OwnerScopeRecoveryResult{}, err
	}
	plan := projectOwnerScopeRecoveryPlan(result.Plan)
	if err := plan.Validate(); err != nil {
		return OwnerScopeRecoveryResult{}, fmt.Errorf("invalid committed owner scope recovery plan: %w", err)
	}
	if plan.PlanSHA256 != expectedPlanSHA256 {
		return OwnerScopeRecoveryResult{}, errors.New("committed owner scope recovery plan does not match confirmation")
	}
	if result.State != ownerscope.RootRecoveryStateFreshCommitted || strings.TrimSpace(result.ArchivePath) == "" || strings.TrimSpace(result.Generation.Path) == "" || strings.TrimSpace(result.Generation.Status.FreshGenerationID) == "" {
		return OwnerScopeRecoveryResult{}, errors.New("owner scope recovery did not commit a retained archive and fresh generation")
	}
	return OwnerScopeRecoveryResult{
		Plan:              plan,
		RecoveryID:        strings.TrimSpace(result.RecoveryID),
		ArchivePath:       result.ArchivePath,
		GenerationPath:    result.Generation.Path,
		FreshGenerationID: result.Generation.Status.FreshGenerationID,
	}, nil
}

func ownerScopeRoot(stateDir string) (string, error) {
	stateDir = strings.TrimSpace(stateDir)
	if stateDir == "" {
		return "", errors.New("missing state directory")
	}
	absolute, err := filepath.Abs(stateDir)
	if err != nil {
		return "", err
	}
	return filepath.Join(absolute, "apps", "redevplugin"), nil
}

func projectOwnerScopeRecoveryPlan(plan ownerscope.OwnerScopeRootRecoveryPlan) OwnerScopeRecoveryPlan {
	return OwnerScopeRecoveryPlan{
		PlanSHA256:               strings.TrimSpace(plan.PlanSHA256),
		RootIdentitySHA256:       strings.TrimSpace(plan.RootIdentitySHA256),
		SourceSnapshotSHA256:     strings.TrimSpace(plan.SourceSnapshotSHA256),
		SourceEntryCount:         plan.SourceEntryCount,
		SourceBytes:              plan.SourceBytes,
		HasRetainedQuarantine:    plan.HasRetainedQuarantine,
		HasSourceRecoveryJournal: plan.HasSourceRecoveryJournal,
	}
}

func validLowerSHA256(value string) bool {
	if len(value) != 64 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}
