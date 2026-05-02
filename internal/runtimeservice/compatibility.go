package runtimeservice

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

//go:embed compatibility_contract.json
var compatibilityContractBytes []byte

type CompatibilityReview struct {
	ReleaseVersion      string   `json:"release_version"`
	PreviousRelease     string   `json:"previous_release"`
	ReviewedAt          string   `json:"reviewed_at"`
	ReviewID            string   `json:"review_id"`
	Summary             string   `json:"summary"`
	SameWindowRationale string   `json:"same_window_rationale,omitempty"`
	CheckedSurfaces     []string `json:"checked_surfaces"`
}

type CompatibilityContract struct {
	SchemaVersion          int                 `json:"schema_version"`
	ReleaseReview          CompatibilityReview `json:"release_review"`
	RuntimeProtocolVersion string              `json:"runtime_protocol_version"`
	CompatibilityEpoch     int                 `json:"compatibility_epoch"`
	MinimumDesktopVersion  string              `json:"minimum_desktop_version"`
	MinimumRuntimeVersion  string              `json:"minimum_runtime_version"`
}

var (
	compatibilityContractOnce sync.Once
	compatibilityContract     CompatibilityContract
	compatibilityContractErr  error
)

func CurrentCompatibilityContract() CompatibilityContract {
	contract, err := loadCompatibilityContract()
	if err != nil {
		return CompatibilityContract{
			SchemaVersion:          1,
			RuntimeProtocolVersion: ProtocolVersion,
			CompatibilityEpoch:     0,
			ReleaseReview: CompatibilityReview{
				ReleaseVersion: "unknown",
				ReviewID:       "unknown",
			},
		}
	}
	return contract
}

func loadCompatibilityContract() (CompatibilityContract, error) {
	compatibilityContractOnce.Do(func() {
		var contract CompatibilityContract
		if err := json.Unmarshal(compatibilityContractBytes, &contract); err != nil {
			compatibilityContractErr = fmt.Errorf("parse runtime compatibility contract: %w", err)
			return
		}
		compatibilityContract = normalizeCompatibilityContract(contract)
		if err := compatibilityContract.Validate(); err != nil {
			compatibilityContractErr = err
		}
	})
	return compatibilityContract, compatibilityContractErr
}

func normalizeCompatibilityContract(contract CompatibilityContract) CompatibilityContract {
	contract.ReleaseReview.ReleaseVersion = strings.TrimSpace(contract.ReleaseReview.ReleaseVersion)
	contract.ReleaseReview.PreviousRelease = strings.TrimSpace(contract.ReleaseReview.PreviousRelease)
	contract.ReleaseReview.ReviewedAt = strings.TrimSpace(contract.ReleaseReview.ReviewedAt)
	contract.ReleaseReview.ReviewID = strings.TrimSpace(contract.ReleaseReview.ReviewID)
	contract.ReleaseReview.Summary = strings.TrimSpace(contract.ReleaseReview.Summary)
	contract.ReleaseReview.SameWindowRationale = strings.TrimSpace(contract.ReleaseReview.SameWindowRationale)
	contract.ReleaseReview.CheckedSurfaces = compactContractStrings(contract.ReleaseReview.CheckedSurfaces)
	contract.RuntimeProtocolVersion = strings.TrimSpace(contract.RuntimeProtocolVersion)
	if contract.RuntimeProtocolVersion == "" {
		contract.RuntimeProtocolVersion = ProtocolVersion
	}
	contract.MinimumDesktopVersion = strings.TrimSpace(contract.MinimumDesktopVersion)
	contract.MinimumRuntimeVersion = strings.TrimSpace(contract.MinimumRuntimeVersion)
	return contract
}

func compactContractStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (c CompatibilityContract) Validate() error {
	c = normalizeCompatibilityContract(c)
	if c.SchemaVersion != 1 {
		return fmt.Errorf("runtime compatibility contract schema_version=%d, want 1", c.SchemaVersion)
	}
	if c.RuntimeProtocolVersion != ProtocolVersion {
		return fmt.Errorf("runtime compatibility contract protocol=%q, want %q", c.RuntimeProtocolVersion, ProtocolVersion)
	}
	if c.CompatibilityEpoch <= 0 {
		return fmt.Errorf("runtime compatibility contract compatibility_epoch must be positive")
	}
	if c.ReleaseReview.ReleaseVersion == "" {
		return fmt.Errorf("runtime compatibility contract release_review.release_version is required")
	}
	if c.ReleaseReview.ReviewID == "" {
		return fmt.Errorf("runtime compatibility contract release_review.review_id is required")
	}
	if c.ReleaseReview.ReviewedAt == "" {
		return fmt.Errorf("runtime compatibility contract release_review.reviewed_at is required")
	}
	if c.ReleaseReview.Summary == "" {
		return fmt.Errorf("runtime compatibility contract release_review.summary is required")
	}
	if len(c.ReleaseReview.CheckedSurfaces) < 3 {
		return fmt.Errorf("runtime compatibility contract release_review.checked_surfaces must name at least three surfaces")
	}
	if c.MinimumDesktopVersion == "" {
		return fmt.Errorf("runtime compatibility contract minimum_desktop_version is required")
	}
	if c.MinimumRuntimeVersion == "" {
		return fmt.Errorf("runtime compatibility contract minimum_runtime_version is required")
	}
	return nil
}

func ApplyCompatibilityContract(snapshot Snapshot) Snapshot {
	contract := CurrentCompatibilityContract()
	snapshot.ProtocolVersion = contract.RuntimeProtocolVersion
	snapshot.CompatibilityEpoch = contract.CompatibilityEpoch
	snapshot.MinimumDesktopVersion = contract.MinimumDesktopVersion
	snapshot.MinimumRuntimeVersion = contract.MinimumRuntimeVersion
	snapshot.CompatibilityReviewID = contract.ReleaseReview.ReviewID
	if snapshot.Compatibility == "" || snapshot.Compatibility == CompatibilityUnknown {
		snapshot.Compatibility = RuntimeCompatibilityForVersion(snapshot.RuntimeVersion)
	}
	return NormalizeSnapshot(snapshot)
}

func RuntimeCompatibilityForVersion(runtimeVersion string) Compatibility {
	runtimeVersion = strings.TrimSpace(runtimeVersion)
	if runtimeVersion == "" {
		return CompatibilityUnknown
	}
	contract := CurrentCompatibilityContract()
	releaseVersion := strings.TrimSpace(contract.ReleaseReview.ReleaseVersion)
	if releaseVersion != "" && releaseVersion != "unreleased" && isReleaseLike(runtimeVersion) && runtimeVersion != releaseVersion {
		return CompatibilityUnknown
	}
	return CompatibilityCompatible
}

func isReleaseLike(version string) bool {
	version = strings.TrimSpace(version)
	return strings.HasPrefix(version, "v") && len(version) > 1
}
