package ai

import (
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

// flowerCanonicalReferenceTargetAuthority is derived per admission/open from
// the current product routing policy. It is never persisted as agent state.
type flowerCanonicalReferenceTargetAuthority struct {
	TargetID          string
	TargetLocality    string
	SourceEnvPublicID string
}

func resolveFlowerCanonicalReferenceTargetAuthority(endpointID string, policy ToolTargetPolicy, routing *threadstore.FlowerThreadRouting) (flowerCanonicalReferenceTargetAuthority, error) {
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return flowerCanonicalReferenceTargetAuthority{}, ErrInvalidContextAction
	}
	policy = normalizeToolTargetPolicy(policy)
	targetID := endpointID
	locality := contextActionLocalityCurrent
	if policy.requiresExplicitTarget() {
		targetID = strings.TrimSpace(policy.DefaultTargetID)
		if targetID == "" && routing != nil {
			targetID = strings.TrimSpace(routing.PrimaryTargetID)
		}
		if targetID == "" || !targetAllowedByPolicy(policy, targetID) {
			return flowerCanonicalReferenceTargetAuthority{}, ErrInvalidContextAction
		}
		locality = contextActionLocalityRemote
	}
	return flowerCanonicalReferenceTargetAuthority{
		TargetID:          targetID,
		TargetLocality:    locality,
		SourceEnvPublicID: endpointID,
	}, nil
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
		if current := strings.TrimSpace(hint.CurrentTargetID); current != "" && current != "current" && current != authority.TargetID {
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

func flowerCanonicalReferenceLocatorMatchesAuthority(locator flowerCanonicalReferenceLocator, authority flowerCanonicalReferenceTargetAuthority) bool {
	return strings.TrimSpace(locator.TargetID) == strings.TrimSpace(authority.TargetID) &&
		strings.TrimSpace(locator.TargetLocality) == strings.TrimSpace(authority.TargetLocality) &&
		strings.TrimSpace(locator.CurrentTargetID) == strings.TrimSpace(authority.TargetID) &&
		strings.TrimSpace(locator.SourceEnvPublicID) == strings.TrimSpace(authority.SourceEnvPublicID)
}
