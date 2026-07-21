package ai

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

const flowerCanonicalReferenceResourcePrefix = "redeven-context:v1:"

var (
	ErrFlowerCanonicalReferenceInvalid     = errors.New("flower reference request is invalid")
	ErrFlowerCanonicalReferenceNotFound    = errors.New("flower reference was not found")
	ErrFlowerCanonicalReferenceDenied      = errors.New("flower reference access denied")
	ErrFlowerCanonicalReferenceType        = errors.New("flower reference type does not match the resource")
	ErrFlowerCanonicalReferenceUnavailable = errors.New("flower reference is unavailable")
)

const (
	FlowerCanonicalReferenceInvalidErrorCode     = "FLOWER_REFERENCE_INVALID"
	FlowerCanonicalReferenceNotFoundErrorCode    = "FLOWER_REFERENCE_NOT_FOUND"
	FlowerCanonicalReferenceDeniedErrorCode      = "FLOWER_REFERENCE_DENIED"
	FlowerCanonicalReferenceTypeErrorCode        = "FLOWER_REFERENCE_TYPE_MISMATCH"
	FlowerCanonicalReferenceUnavailableErrorCode = "FLOWER_REFERENCE_UNAVAILABLE"
)

type FlowerCanonicalReferenceOpenRequest struct {
	ThreadID    string `json:"-"`
	TurnID      string `json:"turn_id"`
	ReferenceID string `json:"reference_id"`
}

// FlowerCanonicalReferenceOpenTarget is host-only. Path must never be
// serialized as part of a timeline or reference DTO.
type FlowerCanonicalReferenceOpenTarget struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Path  string `json:"-"`
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

func (s *Service) ResolveFlowerCanonicalReferenceOpenTarget(ctx context.Context, meta *session.Meta, req FlowerCanonicalReferenceOpenRequest) (FlowerCanonicalReferenceOpenTarget, error) {
	if s == nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	if meta == nil || !meta.CanRead {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceDenied
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	turnID := strings.TrimSpace(req.TurnID)
	referenceID := strings.TrimSpace(req.ReferenceID)
	if endpointID == "" || threadID == "" || turnID == "" || referenceID == "" {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceInvalid
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil || s.scope == nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	settings, err := db.GetThreadSettings(ctxOrBackground(ctx), endpointID, threadID)
	if errors.Is(err, sql.ErrNoRows) || settings == nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceNotFound
	}
	if err != nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	if namespaceID := strings.TrimSpace(meta.NamespacePublicID); namespaceID != "" && strings.TrimSpace(settings.NamespacePublicID) != "" && namespaceID != strings.TrimSpace(settings.NamespacePublicID) {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceNotFound
	}

	host, err := s.openFloretThreadReadHost(ctxOrBackground(ctx), threadID)
	if err != nil {
		if errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted) {
			return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceNotFound
		}
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	turns, err := listAllFloretThreadTurns(ctxOrBackground(ctx), host, threadID)
	if err != nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	reference, ok := exactFlowerCanonicalReference(turns, turnID, referenceID)
	if !ok {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceNotFound
	}
	if reference.Kind != flruntime.MessageReferenceFile && reference.Kind != flruntime.MessageReferenceDirectory {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceType
	}
	locator, err := decodeFlowerCanonicalReferenceLocator(reference.ResourceRef)
	if err != nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	wantDirectory := reference.Kind == flruntime.MessageReferenceDirectory
	if locator.Directory != wantDirectory {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceType
	}
	if !flowerCanonicalReferenceLocatorBelongsToEndpoint(locator, endpointID) {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceDenied
	}
	routing, err := s.GetFlowerThreadRouting(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	s.mu.Lock()
	policy := s.toolTargetPolicy
	policyForRun := s.toolTargetPolicyForRun
	s.mu.Unlock()
	if policyForRun != nil {
		policy = normalizeToolTargetPolicy(policyForRun(meta, *settings, routing))
	}
	authority, err := resolveFlowerCanonicalReferenceTargetAuthority(endpointID, policy, routing)
	if err != nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceDenied
	}
	if !flowerCanonicalReferenceLocatorMatchesAuthority(locator, authority) {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceDenied
	}

	resolved, err := s.scope.Resolve(locator.Path, filesystemscope.ResolveOptions{
		RequireExisting: true,
		RequireDir:      wantDirectory,
	})
	if err != nil {
		switch {
		case os.IsNotExist(err):
			return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceNotFound
		case errors.Is(err, filesystemscope.ErrPathOutsideScope), errors.Is(err, filesystemscope.ErrReadDenied):
			return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceDenied
		case errors.Is(err, filesystemscope.ErrPathNotDirectory):
			return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceType
		default:
			return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
		}
	}
	info, err := os.Stat(resolved.RealAbs)
	if os.IsNotExist(err) {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceNotFound
	}
	if err != nil {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceUnavailable
	}
	if info.IsDir() != wantDirectory || (!wantDirectory && !info.Mode().IsRegular()) {
		return FlowerCanonicalReferenceOpenTarget{}, ErrFlowerCanonicalReferenceType
	}
	return FlowerCanonicalReferenceOpenTarget{
		Kind:  string(reference.Kind),
		Label: strings.TrimSpace(reference.Label),
		Path:  resolved.RealAbs,
	}, nil
}

func exactFlowerCanonicalReference(turns []flruntime.ThreadTurnSnapshot, turnID string, referenceID string) (flruntime.MessageReference, bool) {
	for _, turn := range turns {
		if strings.TrimSpace(string(turn.TurnID)) != turnID {
			continue
		}
		for _, reference := range turn.UserReferences {
			if strings.TrimSpace(reference.ReferenceID) == referenceID {
				return reference, true
			}
		}
		return flruntime.MessageReference{}, false
	}
	return flruntime.MessageReference{}, false
}

func decodeFlowerCanonicalReferenceLocator(raw string) (flowerCanonicalReferenceLocator, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, flowerCanonicalReferenceResourcePrefix) {
		return flowerCanonicalReferenceLocator{}, ErrFlowerCanonicalReferenceUnavailable
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(raw, flowerCanonicalReferenceResourcePrefix))
	if err != nil {
		return flowerCanonicalReferenceLocator{}, ErrFlowerCanonicalReferenceUnavailable
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.DisallowUnknownFields()
	var locator flowerCanonicalReferenceLocator
	if err := dec.Decode(&locator); err != nil {
		return flowerCanonicalReferenceLocator{}, ErrFlowerCanonicalReferenceUnavailable
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return flowerCanonicalReferenceLocator{}, ErrFlowerCanonicalReferenceUnavailable
	}
	locator.TargetID = strings.TrimSpace(locator.TargetID)
	locator.TargetLocality = strings.TrimSpace(locator.TargetLocality)
	locator.CurrentTargetID = strings.TrimSpace(locator.CurrentTargetID)
	locator.SourceEnvPublicID = strings.TrimSpace(locator.SourceEnvPublicID)
	locator.Path = strings.TrimSpace(locator.Path)
	if locator.Version != 1 || locator.TargetID == "" || locator.TargetLocality == "" || locator.Path == "" || !filepath.IsAbs(locator.Path) {
		return flowerCanonicalReferenceLocator{}, ErrFlowerCanonicalReferenceUnavailable
	}
	return locator, nil
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
