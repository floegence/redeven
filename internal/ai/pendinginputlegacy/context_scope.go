package pendinginputlegacy

import (
	"strings"
)

// flowerCanonicalReferenceTargetAuthority is reconstructed from the historical
// record scope and persisted primary target. It does not grant current access.
type flowerCanonicalReferenceTargetAuthority struct {
	TargetID          string
	TargetLocality    string
	SourceEnvPublicID string
}

func flowerContextActionRequiresCanonicalReferenceAuthority(action *ContextActionEnvelope) bool {
	if action == nil {
		return false
	}
	for _, item := range action.Context {
		if strings.TrimSpace(item.Kind) == contextActionKindFilePath {
			return true
		}
	}
	return false
}

func authorizeFlowerContextActionTarget(action *ContextActionEnvelope, authority flowerCanonicalReferenceTargetAuthority) error {
	if action == nil {
		return nil
	}
	if strings.TrimSpace(authority.TargetID) == "" || strings.TrimSpace(authority.TargetLocality) == "" || strings.TrimSpace(authority.SourceEnvPublicID) == "" {
		return ErrInvalidContextAction
	}
	targetID := strings.TrimSpace(action.Target.TargetID)
	if targetID == "" || (targetID != "current" && targetID != "local:local" && targetID != authority.TargetID) {
		return ErrInvalidContextAction
	}
	locality := strings.TrimSpace(action.Target.Locality)
	if locality != "" && locality != contextActionLocalityAuto && locality != authority.TargetLocality {
		return ErrInvalidContextAction
	}
	if hint := action.ExecutionContext; hint != nil {
		if source := strings.TrimSpace(hint.SourceEnvPublicID); source != "" && source != authority.SourceEnvPublicID {
			return ErrInvalidContextAction
		}
		if current := strings.TrimSpace(hint.CurrentTargetID); current != "" && current != "current" && current != "local:local" && current != authority.TargetID {
			return ErrInvalidContextAction
		}
	}
	return nil
}

func canonicalizeFlowerContextActionTarget(action *ContextActionEnvelope, authority flowerCanonicalReferenceTargetAuthority) *ContextActionEnvelope {
	if action == nil {
		return nil
	}
	out := *action
	out.Target = ContextActionTarget{TargetID: authority.TargetID, Locality: authority.TargetLocality}
	if action.ExecutionContext != nil {
		hint := *action.ExecutionContext
		hint.CurrentTargetID = authority.TargetID
		hint.SourceEnvPublicID = authority.SourceEnvPublicID
		out.ExecutionContext = &hint
	} else {
		out.ExecutionContext = &ContextActionExecutionHint{
			CurrentTargetID:   authority.TargetID,
			SourceEnvPublicID: authority.SourceEnvPublicID,
		}
	}
	return &out
}

type flowerCanonicalReferenceLocator struct {
	Version           int    `json:"version"`
	TargetID          string `json:"target_id"`
	TargetLocality    string `json:"target_locality"`
	CurrentTargetID   string `json:"current_target_id"`
	SourceEnvPublicID string `json:"source_env_public_id,omitempty"`
	Path              string `json:"path"`
	Directory         bool   `json:"directory"`
}

func flowerCanonicalReferenceLocatorBelongsToEndpoint(locator flowerCanonicalReferenceLocator, endpointID string) bool {
	endpointID = strings.TrimSpace(endpointID)
	locator.TargetID = strings.TrimSpace(locator.TargetID)
	locator.TargetLocality = strings.TrimSpace(locator.TargetLocality)
	locator.CurrentTargetID = strings.TrimSpace(locator.CurrentTargetID)
	locator.SourceEnvPublicID = strings.TrimSpace(locator.SourceEnvPublicID)
	if endpointID == "" || locator.SourceEnvPublicID != endpointID {
		return false
	}
	switch locator.TargetLocality {
	case contextActionLocalityAuto, contextActionLocalityCurrent, contextActionLocalityRemote:
	default:
		return false
	}
	return locator.TargetID != ""
}
