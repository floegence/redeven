package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

type releaseBrowseContext struct {
	Scope          string
	ServiceID      string
	TemplateID     string
	Spec           TemplateSpec
	Parameters     map[string]string
	Current        *ReleaseIdentity
	Recommended    *ReleaseIdentity
	TemplateSource string
}

func (m *Manager) browseReleaseCandidates(ctx context.Context, browse releaseBrowseContext, request ReleaseCandidateRequest) (*ReleaseCandidateResult, error) {
	action := strings.TrimSpace(request.Action)
	if action == "" {
		action = "open"
	}
	if action != "open" && action != "refresh" && action != "continue" && action != "verify" {
		return nil, serviceError("RELEASE_BROWSE_ACTION_INVALID", "The release browsing action is invalid.", 400, false, nil)
	}
	if browse.Spec.Kind == DeploymentHost && browse.Spec.Host != nil && browse.Spec.Host.NPM != nil {
		if action == "continue" || action == "verify" {
			return nil, serviceError("RELEASE_BROWSE_ACTION_INVALID", "This release source does not use progressive browsing.", 400, false, nil)
		}
		if action == "open" {
			if result, ok := m.activeReleaseBrowseView(browse.Scope); ok {
				return &result, nil
			}
			if result, ok := m.restoreReleaseView(ctx, browse); ok {
				return result, nil
			}
		} else {
			ctx = withReleaseSourceRefresh(ctx)
		}
		items, err := m.discoverNPMCandidates(ctx, browse.Spec, browse.Parameters, browse.Current, browse.TemplateSource)
		if err != nil {
			return m.releaseBrowseFailure(ctx, browse, err)
		}
		for index := range items {
			if items[index].Candidate.Selectable {
				items[index].Candidate.VerificationStatus = "verified"
			} else {
				items[index].Candidate.VerificationStatus = "unavailable"
			}
		}
		return m.replaceReleaseView(ctx, browse, items, "complete", "")
	}
	if browse.Spec.Kind != DeploymentContainer || browse.Spec.Container == nil {
		return nil, serviceError("RELEASE_DISCOVERY_UNSUPPORTED", "Release discovery supports npm Host and single-container templates.", 409, false, nil)
	}
	switch action {
	case "open":
		if result, ok := m.activeReleaseBrowseView(browse.Scope); ok {
			return &result, nil
		}
		if result, ok := m.restoreReleaseView(ctx, browse); ok {
			return result, nil
		}
		return m.listOCIReleasePage(ctx, browse, "", true)
	case "refresh":
		return m.listOCIReleasePage(withReleaseSourceRefresh(ctx), browse, "", true)
	case "continue":
		cursor, err := m.releaseCursor(browse, request.CursorID)
		if err != nil {
			return nil, err
		}
		result, err := m.listOCIReleasePage(ctx, browse, cursor, false)
		if err == nil && result.CatalogStatus != "stale" && result.CatalogStatus != "error" {
			m.discardReleaseCursor(request.CursorID)
		}
		return result, err
	default:
		return m.verifyOCIReleaseCandidates(ctx, browse, request.CandidateIDs)
	}
}

func (m *Manager) activeReleaseBrowseView(scope string) (ReleaseCandidateResult, bool) {
	now := time.Now()
	m.releaseMu.Lock()
	defer m.releaseMu.Unlock()
	result, ok := m.releaseViews[scope]
	if !ok || result.CatalogStatus == "error" {
		return ReleaseCandidateResult{}, false
	}
	for _, candidate := range result.Candidates {
		cached, exists := m.releaseItems[candidate.CandidateID]
		if !exists || cached.Scope != scope || now.After(cached.ExpiresAt) {
			return ReleaseCandidateResult{}, false
		}
	}
	if result.HasMore {
		cursor, exists := m.releaseCursors[result.CursorID]
		if !exists || cursor.Scope != scope || now.After(cursor.ExpiresAt) {
			return ReleaseCandidateResult{}, false
		}
	}
	return result, true
}

func (m *Manager) listOCIReleasePage(ctx context.Context, browse releaseBrowseContext, cursor string, replace bool) (*ReleaseCandidateResult, error) {
	page, err := m.listOCIReleaseTags(ctx, browse.Spec, cursor)
	if err != nil {
		return m.releaseBrowseFailure(ctx, browse, err)
	}
	tags := page.Tags
	if replace {
		tags = prependPinnedOCITags(browse, tags)
	}
	items := make([]cachedReleaseCandidate, 0, len(tags))
	for _, tag := range tags {
		items = append(items, pendingOCIReleaseCandidate(browse, tag))
	}
	status := "complete"
	if page.NextCursor != "" {
		status = "loading"
	}
	return m.replaceReleaseView(ctx, browse, items, status, page.NextCursor, replace)
}

func prependPinnedOCITags(browse releaseBrowseContext, tags []string) []string {
	repository := releaseImageRepository(browse.Spec.Container.Image)
	seen := make(map[string]struct{}, len(tags)+2)
	result := make([]string, 0, len(tags)+2)
	appendIdentity := func(identity *ReleaseIdentity) {
		if identity == nil || identity.Kind != "oci" || identity.Source != repository || strings.TrimSpace(identity.Tag) == "" {
			return
		}
		if _, ok := seen[identity.Tag]; ok {
			return
		}
		seen[identity.Tag] = struct{}{}
		result = append(result, identity.Tag)
	}
	appendIdentity(browse.Current)
	appendIdentity(browse.Recommended)
	for _, tag := range tags {
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	return result
}

func (m *Manager) verifyOCIReleaseCandidates(ctx context.Context, browse releaseBrowseContext, candidateIDs []string) (*ReleaseCandidateResult, error) {
	if len(candidateIDs) == 0 || len(candidateIDs) > maxReleaseVerificationBatch {
		return nil, serviceError("RELEASE_CANDIDATE_SELECTION_INVALID", "Select between one and twenty release candidates to verify.", 400, false, nil)
	}
	tags := make([]string, 0, len(candidateIDs))
	selected := map[string]cachedReleaseCandidate{}
	m.releaseMu.Lock()
	for _, candidateID := range candidateIDs {
		candidateID = strings.TrimSpace(candidateID)
		candidate, ok := m.releaseItems[candidateID]
		if !ok || candidate.Scope != browse.Scope || time.Now().After(candidate.ExpiresAt) {
			m.releaseMu.Unlock()
			return nil, serviceError("RELEASE_CANDIDATE_EXPIRED", "Refresh the version list before selecting this release.", 409, true, nil)
		}
		if candidate.Candidate.SourceKind != "oci" {
			m.releaseMu.Unlock()
			return nil, serviceError("RELEASE_CANDIDATE_SELECTION_INVALID", "The selected release candidate cannot be verified by the Container Registry.", 400, false, nil)
		}
		selected[candidate.Candidate.Tag] = candidate
		tags = append(tags, candidate.Candidate.Tag)
	}
	m.releaseMu.Unlock()

	verified, verifyErr := m.verifyOCIReleaseTags(ctx, browse.Spec, tags)
	if errors.Is(verifyErr, context.Canceled) {
		return nil, verifyErr
	}
	for _, item := range verified {
		cached, ok := selected[item.Tag]
		if !ok {
			continue
		}
		if item.ReasonCode == "RELEASE_NOT_FOUND" && browse.Recommended != nil && cached.Candidate.Tag == browse.Recommended.Tag && cached.Candidate.Source == browse.Recommended.Source && cached.Candidate.Digest != "" {
			if fixed, fixedErr := m.verifyOCIReleaseDigests(ctx, browse.Spec, []string{cached.Candidate.Digest}); fixedErr == nil && len(fixed) == 1 && fixed[0].Compatible && fixed[0].PlatformDigest == cached.Candidate.Digest {
				fixed[0].Tag = item.Tag
				fixed[0].DigestVerified = true
				fixed[0].ReasonCode = "RECOMMENDED_TAG_UNAVAILABLE_DIGEST_VERIFIED"
				fixed[0].Reason = "The recommended tag is unavailable, but the exact reviewed image digest is still verifiable. Select this fixed image explicitly to deploy it."
				item = fixed[0]
			}
		}
		updated := verifiedOCIReleaseCandidate(browse, cached, item)
		m.updateReleaseCandidate(updated)
	}
	if verifyErr != nil {
		return m.releaseBrowseFailure(ctx, browse, verifyErr)
	}
	return m.commitReleaseView(ctx, browse)
}

func (m *Manager) releaseRegistryCredential(ctx context.Context, spec TemplateSpec) (containerengine.RegistryCredential, error) {
	if m.containers == nil || spec.Container == nil {
		return containerengine.RegistryCredential{}, nil
	}
	reference := releaseImageRepository(spec.Container.Image)
	return m.containers.RegistryCredential(ctx, containerengine.EngineDocker, releaseRegistryHost(reference))
}

func (m *Manager) listOCIReleaseTags(ctx context.Context, spec TemplateSpec, cursor string) (containerengine.OCIReleaseTagPage, error) {
	discovery := containerengine.OCIReleaseDiscovery{Client: m.releaseHTTPClient()}
	request := containerengine.OCIReleaseTagPageRequest{Reference: releaseImageRepository(spec.Container.Image), Cursor: cursor}
	page, err := discovery.ListTagsPage(ctx, request)
	if err == nil {
		return page, nil
	}
	if !errors.Is(err, containerengine.ErrImageAccessDenied) {
		return page, mapOCIReleaseSourceError(err, nil)
	}
	credential, credentialErr := m.releaseRegistryCredential(ctx, spec)
	if ctx.Err() != nil {
		return page, ctx.Err()
	}
	if credentialErr != nil {
		return page, mapOCIReleaseSourceError(err, credentialErr)
	}
	if credential.Username == "" && credential.Secret == "" {
		return page, mapOCIReleaseSourceError(err, nil)
	}
	request.Credential = credential
	page, err = discovery.ListTagsPage(ctx, request)
	if err != nil {
		return page, mapOCIReleaseSourceError(err, nil)
	}
	return page, nil
}

func (m *Manager) verifyOCIReleaseTags(ctx context.Context, spec TemplateSpec, tags []string) ([]containerengine.OCIRelease, error) {
	discovery := containerengine.OCIReleaseDiscovery{Client: m.releaseHTTPClient()}
	request := containerengine.OCIReleaseVerificationRequest{
		Reference: releaseImageRepository(spec.Container.Image), PlatformOS: "linux", PlatformArch: runtime.GOARCH, Tags: tags, ResolvePublishedAt: true,
	}
	items, err := discovery.VerifyTags(ctx, request)
	if err == nil {
		return items, nil
	}
	if !errors.Is(err, containerengine.ErrImageAccessDenied) {
		return items, mapOCIReleaseSourceError(err, nil)
	}
	credential, credentialErr := m.releaseRegistryCredential(ctx, spec)
	if ctx.Err() != nil {
		return items, ctx.Err()
	}
	if credentialErr != nil {
		return items, mapOCIReleaseSourceError(err, credentialErr)
	}
	if credential.Username == "" && credential.Secret == "" {
		return items, mapOCIReleaseSourceError(err, nil)
	}
	request.Credential = credential
	items, err = discovery.VerifyTags(ctx, request)
	if err != nil {
		return items, mapOCIReleaseSourceError(err, nil)
	}
	return items, nil
}

func (m *Manager) verifyOCIReleaseDigests(ctx context.Context, spec TemplateSpec, digests []string) ([]containerengine.OCIRelease, error) {
	discovery := containerengine.OCIReleaseDiscovery{Client: m.releaseHTTPClient()}
	request := containerengine.OCIReleaseDigestVerificationRequest{
		Reference: releaseImageRepository(spec.Container.Image), PlatformOS: "linux", PlatformArch: runtime.GOARCH, Digests: digests,
	}
	items, err := discovery.VerifyDigests(ctx, request)
	if err == nil {
		return items, nil
	}
	if !errors.Is(err, containerengine.ErrImageAccessDenied) {
		return items, mapOCIReleaseSourceError(err, nil)
	}
	credential, credentialErr := m.releaseRegistryCredential(ctx, spec)
	if ctx.Err() != nil {
		return items, ctx.Err()
	}
	if credentialErr != nil {
		return items, mapOCIReleaseSourceError(err, credentialErr)
	}
	if credential.Username == "" && credential.Secret == "" {
		return items, mapOCIReleaseSourceError(err, nil)
	}
	request.Credential = credential
	items, err = discovery.VerifyDigests(ctx, request)
	if err != nil {
		return items, mapOCIReleaseSourceError(err, nil)
	}
	return items, nil
}

func mapOCIReleaseSourceError(err, credentialErr error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return err
	case errors.Is(err, containerengine.ErrImageRegistryTimeout):
		return serviceError("RELEASE_SOURCE_TIMEOUT", "The Container Registry request timed out.", 504, true, err)
	case errors.Is(err, containerengine.ErrImageRegistryNetworkUnavailable):
		return serviceError("RELEASE_SOURCE_NETWORK_UNAVAILABLE", "The Container Registry network is unavailable.", 503, true, err)
	case errors.Is(err, containerengine.ErrImageRegistryResponseInvalid):
		return serviceError("RELEASE_SOURCE_RESPONSE_INVALID", "The Container Registry returned an invalid response.", 502, true, err)
	case errors.Is(err, containerengine.ErrImageAccessDenied):
		if credentialErr != nil {
			return serviceError("RELEASE_SOURCE_AUTH_UNAVAILABLE", "Container Registry credentials could not be read from the current engine store.", 503, true, credentialErr)
		}
		return serviceError("RELEASE_SOURCE_AUTH_REQUIRED", "The Container Registry rejected its current engine credentials.", 401, false, err)
	case errors.Is(err, containerengine.ErrImageNotFound):
		return serviceError("RELEASE_SOURCE_NOT_FOUND", "The configured Container Registry repository was not found.", 404, false, err)
	case errors.Is(err, containerengine.ErrImageRateLimited):
		return serviceError("RELEASE_SOURCE_RATE_LIMITED", "The Container Registry rate limit was reached.", 429, true, err)
	default:
		return serviceError("RELEASE_SOURCE_UNAVAILABLE", "The Container Registry could not provide release metadata.", 503, true, err)
	}
}

func pendingOCIReleaseCandidate(browse releaseBrowseContext, tag string) cachedReleaseCandidate {
	reference := releaseImageRepository(browse.Spec.Container.Image)
	trust := releaseCandidateTrust(browse.TemplateSource)
	candidate := ReleaseCandidate{
		SchemaVersion: releaseCandidateSchemaVersion, SourceKind: "oci", Source: reference, Tag: tag,
		Channel: releaseChannel(tag), Trust: trust, Platform: "linux/" + runtime.GOARCH,
		Selectable: false, Relation: releaseRelation(browse.Current, ReleaseIdentity{Kind: "oci", Source: reference, Tag: tag, Platform: "linux/" + runtime.GOARCH}),
		VerificationStatus: "pending",
	}
	candidate.IsCurrent = browse.Current != nil && browse.Current.Kind == "oci" && browse.Current.Source == reference && browse.Current.Tag == tag
	if browse.Recommended != nil && browse.Recommended.Kind == "oci" && browse.Recommended.Source == reference && browse.Recommended.Tag == tag {
		candidate.RecommendationStatus = "pending"
		candidate.Digest = browse.Recommended.Digest
	}
	return cachedReleaseCandidate{Scope: browse.Scope, TemplateID: browse.TemplateID, Candidate: candidate, Spec: cloneTemplateSpec(browse.Spec)}
}

func verifiedOCIReleaseCandidate(browse releaseBrowseContext, cached cachedReleaseCandidate, item containerengine.OCIRelease) cachedReleaseCandidate {
	candidate := cached.Candidate
	candidate.IndexDigest = item.IndexDigest
	candidate.Digest = item.PlatformDigest
	candidate.PublishedAtUnixMs = item.PublishedAtUnixMs
	candidate.DigestVerified = item.DigestVerified
	if candidate.Digest == "" && browse.Recommended != nil && browse.Recommended.Kind == "oci" && browse.Recommended.Source == candidate.Source && browse.Recommended.Tag == item.Tag {
		candidate.Digest = browse.Recommended.Digest
	}
	candidate.ReasonCode = item.ReasonCode
	candidate.Reason = item.Reason
	candidate.Selectable = item.Compatible
	candidate.VerificationStatus = "verified"
	if !item.Compatible {
		candidate.VerificationStatus = "unavailable"
	}
	isRecommendation := browse.Recommended != nil && browse.Recommended.Kind == "oci" && browse.Recommended.Source == candidate.Source && browse.Recommended.Tag == item.Tag
	if isRecommendation {
		digestMatches := browse.Recommended.Digest == "" || browse.Recommended.Digest == item.PlatformDigest
		candidate.IsRecommended = candidate.Selectable && digestMatches && !item.DigestVerified
		if candidate.IsRecommended {
			candidate.RecommendationStatus = "available"
		} else {
			candidate.RecommendationStatus = "unavailable"
		}
	} else {
		candidate.IsRecommended = false
		candidate.RecommendationStatus = ""
	}
	if browse.Current != nil && browse.Current.Kind == "oci" && browse.Current.Tag == item.Tag && browse.Current.Digest != "" && browse.Current.Digest != item.PlatformDigest {
		candidate.TagMoved = true
	}
	identity := ReleaseIdentity{
		SchemaVersion: 1, Kind: "oci", Source: candidate.Source, Tag: item.Tag, Digest: item.PlatformDigest,
		Platform: candidate.Platform, ArtifactReference: candidate.Source + ":" + item.Tag + "@" + item.PlatformDigest, Trust: candidate.Trust,
	}
	spec := cloneTemplateSpec(browse.Spec)
	if item.PlatformDigest != "" {
		spec.Container.Image = identity.ArtifactReference
	}
	cached.Candidate, cached.Identity, cached.Spec = candidate, identity, spec
	return cached
}

func releaseCandidateTrust(templateSource string) string {
	if templateSource == "builtin" {
		return "catalog_reviewed_source"
	}
	return "user_configured_registry"
}

func releaseChannel(value string) string {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if _, ok := parseSemanticVersion(value); ok && exactSemverPattern.MatchString(value) {
		if strings.Contains(value, "-") {
			return "preview"
		}
		return "stable"
	}
	return "special"
}

func releaseSourceFingerprint(spec TemplateSpec) string {
	parts := []string{string(spec.Kind), currentPlatformKey()}
	if spec.Kind == DeploymentHost && spec.Host != nil && spec.Host.NPM != nil {
		parts = append(parts, spec.Host.NPM.PackageName, normalizedRegistryURL(spec.Host.NPM.RegistryURL))
	} else if spec.Kind == DeploymentContainer && spec.Container != nil {
		parts = append(parts, releaseImageRepository(spec.Container.Image))
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

func (m *Manager) replaceReleaseView(ctx context.Context, browse releaseBrowseContext, items []cachedReleaseCandidate, catalogStatus, next string, replace ...bool) (*ReleaseCandidateResult, error) {
	now := time.Now()
	m.releaseMu.Lock()
	if m.releaseItems == nil {
		m.releaseItems = map[string]cachedReleaseCandidate{}
	}
	if m.releaseViews == nil {
		m.releaseViews = map[string]ReleaseCandidateResult{}
	}
	if m.releaseCursors == nil {
		m.releaseCursors = map[string]cachedReleaseCursor{}
	}
	shouldReplace := len(replace) == 0 || replace[0]
	if shouldReplace {
		m.removeReleaseScopeLocked(browse.Scope)
	}
	result, ok := m.releaseViews[browse.Scope]
	if !ok || shouldReplace {
		result = ReleaseCandidateResult{
			SchemaVersion: releaseCandidateSchemaVersion, CurrentRelease: browse.Current, RecommendedRelease: browse.Recommended,
			Candidates: []ReleaseCandidate{}, CheckStatus: "fresh", CheckedAtUnixMs: now.UnixMilli(), NextCheckAtUnixMs: now.Add(releaseCheckInterval).UnixMilli(),
		}
	}
	existingTags := map[string]struct{}{}
	for _, candidate := range result.Candidates {
		existingTags[candidate.SourceKind+"\x00"+candidate.Version+"\x00"+candidate.Tag] = struct{}{}
	}
	for _, item := range items {
		key := item.Candidate.SourceKind + "\x00" + item.Candidate.Version + "\x00" + item.Candidate.Tag
		if _, exists := existingTags[key]; exists {
			continue
		}
		id, err := randomID("rel")
		if err != nil {
			m.releaseMu.Unlock()
			return nil, err
		}
		item.Candidate.CandidateID = id
		item.Candidate.SchemaVersion = releaseCandidateSchemaVersion
		if item.Identity.Kind != "" {
			item.Candidate.IsCurrent = browse.Current != nil && sameReleaseSelection(*browse.Current, item.Identity)
			if browse.Recommended != nil && sameReleaseSelection(*browse.Recommended, item.Identity) {
				if item.Candidate.Selectable && item.Candidate.VerificationStatus != "unavailable" && !item.Candidate.DigestVerified {
					item.Candidate.IsRecommended = true
					item.Candidate.RecommendationStatus = "available"
				} else {
					item.Candidate.IsRecommended = false
					item.Candidate.RecommendationStatus = "unavailable"
				}
			}
			item.Candidate.Relation = releaseRelation(browse.Current, item.Identity)
		}
		item.Scope, item.TemplateID, item.ExpiresAt = browse.Scope, browse.TemplateID, now.Add(releaseCandidateTTL)
		m.releaseItems[id] = item
		result.Candidates = append(result.Candidates, item.Candidate)
		existingTags[key] = struct{}{}
		if len(result.Candidates) >= maxReleaseCatalogCandidates {
			catalogStatus, next = "complete", ""
			break
		}
	}
	result.CatalogStatus = catalogStatus
	result.CheckStatus = "fresh"
	result.LastErrorCode, result.LastErrorMessage = "", ""
	result.CursorID, result.HasMore = "", false
	if next != "" {
		cursorID, err := randomID("rlc")
		if err != nil {
			m.releaseMu.Unlock()
			return nil, err
		}
		m.releaseCursors[cursorID] = cachedReleaseCursor{Scope: browse.Scope, SourceFingerprint: releaseSourceFingerprint(browse.Spec), Next: next, ExpiresAt: now.Add(releaseCandidateTTL)}
		result.CursorID, result.HasMore = cursorID, true
	}
	m.recomputeReleaseViewLocked(&result)
	m.releaseViews[browse.Scope] = result
	m.releaseMu.Unlock()
	if err := m.persistReleaseView(ctx, browse, result); err != nil {
		m.log.Warn("persist managed Web Service release catalog", "service_id", browse.ServiceID, "cause", safeManagedFailureCause(err))
	}
	copy := result
	return &copy, nil
}

func (m *Manager) updateReleaseCandidate(updated cachedReleaseCandidate) {
	m.releaseMu.Lock()
	defer m.releaseMu.Unlock()
	updated.ExpiresAt = time.Now().Add(releaseCandidateTTL)
	m.releaseItems[updated.Candidate.CandidateID] = updated
	view, ok := m.releaseViews[updated.Scope]
	if !ok {
		return
	}
	for index := range view.Candidates {
		if view.Candidates[index].CandidateID == updated.Candidate.CandidateID {
			view.Candidates[index] = updated.Candidate
			break
		}
	}
	m.recomputeReleaseViewLocked(&view)
	m.releaseViews[updated.Scope] = view
}

func (m *Manager) commitReleaseView(ctx context.Context, browse releaseBrowseContext) (*ReleaseCandidateResult, error) {
	m.releaseMu.Lock()
	result, ok := m.releaseViews[browse.Scope]
	m.releaseMu.Unlock()
	if !ok {
		return nil, serviceError("RELEASE_CANDIDATE_EXPIRED", "Refresh the version list before selecting this release.", 409, true, nil)
	}
	if err := m.persistReleaseView(ctx, browse, result); err != nil {
		m.log.Warn("persist managed Web Service release catalog", "service_id", browse.ServiceID, "cause", safeManagedFailureCause(err))
	}
	return &result, nil
}

func (m *Manager) recomputeReleaseViewLocked(result *ReleaseCandidateResult) {
	sort.SliceStable(result.Candidates, func(i, j int) bool {
		return releaseCandidateDisplayLess(result.Candidates[i], result.Candidates[j])
	})
	result.LatestStableRelease, result.LatestPreviewRelease = nil, nil
	for index := range result.Candidates {
		result.Candidates[index].IsLatestStable = false
		result.Candidates[index].IsLatestPreview = false
	}
	if result.CatalogStatus == "complete" {
		if index := latestReleaseCandidateIndex(result.Candidates, "stable"); index >= 0 {
			result.Candidates[index].IsLatestStable = true
			value := result.Candidates[index]
			result.LatestStableRelease = &value
		}
		if index := latestReleaseCandidateIndex(result.Candidates, "preview"); index >= 0 {
			result.Candidates[index].IsLatestPreview = true
			value := result.Candidates[index]
			result.LatestPreviewRelease = &value
		}
	}
	result.LoadedCount = len(result.Candidates)
}

func latestReleaseCandidateIndex(candidates []ReleaseCandidate, channel string) int {
	latest := -1
	for index := range candidates {
		candidate := candidates[index]
		if candidate.Channel != channel || candidate.VerificationStatus != "verified" || !candidate.Selectable {
			continue
		}
		value := candidate.Version
		if value == "" {
			value = candidate.Tag
		}
		semantic := strings.TrimPrefix(value, "v")
		if _, ok := parseSemanticVersion(semantic); !ok || !exactSemverPattern.MatchString(semantic) {
			continue
		}
		if latest < 0 || releaseCandidateNewer(candidate, candidates[latest]) {
			latest = index
		}
	}
	return latest
}

func releaseCandidatePublishedAt(candidate ReleaseCandidate) int64 {
	if candidate.PublishedAtUnixMs > 0 {
		return candidate.PublishedAtUnixMs
	}
	value := candidate.Version
	if value == "" {
		value = candidate.Tag
	}
	if len(value) < len("2006.01.02") || value[4] != '.' || value[7] != '.' {
		return 0
	}
	if len(value) > len("2006.01.02") && value[10] != '-' && value[10] != '_' {
		return 0
	}
	parsed, err := time.Parse("2006.01.02", value[:10])
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

func releaseCandidateMatchesRecommendation(candidate ReleaseCandidate, recommended *ReleaseIdentity) bool {
	if recommended == nil || candidate.SourceKind != recommended.Kind || candidate.Source != recommended.Source {
		return false
	}
	switch candidate.SourceKind {
	case "oci":
		return candidate.Tag != "" && candidate.Tag == recommended.Tag
	case "npm":
		return candidate.Version != "" && candidate.Version == recommended.Version
	default:
		return false
	}
}

// Display order depends only on the immutable version or tag. Verification can
// enrich a row without moving it while the user is browsing the catalog.
func releaseCandidateDisplayLess(left, right ReleaseCandidate) bool {
	leftValue := left.Version
	if leftValue == "" {
		leftValue = left.Tag
	}
	rightValue := right.Version
	if rightValue == "" {
		rightValue = right.Tag
	}
	leftSemantic := strings.TrimPrefix(leftValue, "v")
	rightSemantic := strings.TrimPrefix(rightValue, "v")
	_, leftOK := parseSemanticVersion(leftSemantic)
	_, rightOK := parseSemanticVersion(rightSemantic)
	leftOK = leftOK && exactSemverPattern.MatchString(leftSemantic)
	rightOK = rightOK && exactSemverPattern.MatchString(rightSemantic)
	if leftOK != rightOK {
		return leftOK
	}
	if leftOK && leftSemantic != rightSemantic {
		return compareReleaseVersions(leftSemantic, rightSemantic) > 0
	}
	if leftValue != rightValue {
		return leftValue > rightValue
	}
	return false
}

func releaseCandidateNewer(candidate, current ReleaseCandidate) bool {
	candidatePublishedAt, currentPublishedAt := releaseCandidatePublishedAt(candidate), releaseCandidatePublishedAt(current)
	if candidatePublishedAt != currentPublishedAt {
		return candidatePublishedAt > currentPublishedAt
	}
	return releaseCandidateDisplayLess(candidate, current)
}

func (m *Manager) removeReleaseScopeLocked(scope string) {
	for id, item := range m.releaseItems {
		if item.Scope == scope || time.Now().After(item.ExpiresAt) {
			delete(m.releaseItems, id)
		}
	}
	for id, cursor := range m.releaseCursors {
		if cursor.Scope == scope || time.Now().After(cursor.ExpiresAt) {
			delete(m.releaseCursors, id)
		}
	}
	delete(m.releaseViews, scope)
}

func (m *Manager) releaseCursor(browse releaseBrowseContext, cursorID string) (string, error) {
	m.releaseMu.Lock()
	defer m.releaseMu.Unlock()
	cursorID = strings.TrimSpace(cursorID)
	cursor, ok := m.releaseCursors[cursorID]
	if !ok || cursor.Scope != browse.Scope || cursor.SourceFingerprint != releaseSourceFingerprint(browse.Spec) || time.Now().After(cursor.ExpiresAt) {
		return "", serviceError("RELEASE_CURSOR_EXPIRED", "Refresh the version list before loading more releases.", 409, true, nil)
	}
	return cursor.Next, nil
}

func (m *Manager) discardReleaseCursor(cursorID string) {
	m.releaseMu.Lock()
	delete(m.releaseCursors, strings.TrimSpace(cursorID))
	m.releaseMu.Unlock()
}

func (m *Manager) releaseBrowseFailure(ctx context.Context, browse releaseBrowseContext, err error) (*ReleaseCandidateResult, error) {
	if errors.Is(err, context.Canceled) {
		return nil, err
	}
	code, message, _, _ := ErrorDetails(err)
	now := time.Now()
	m.releaseMu.Lock()
	if m.releaseViews == nil {
		m.releaseViews = map[string]ReleaseCandidateResult{}
	}
	result, hasPrevious := m.releaseViews[browse.Scope]
	hasSuccessfulPrevious := hasPrevious && result.CatalogStatus != "error"
	if hasSuccessfulPrevious {
		result.CheckStatus, result.CatalogStatus = "stale", "stale"
		result.LastErrorCode, result.LastErrorMessage = code, message
		result.NextCheckAtUnixMs = now.Add(releaseCheckInterval).UnixMilli()
		m.releaseViews[browse.Scope] = result
	} else {
		result = ReleaseCandidateResult{
			SchemaVersion: releaseCandidateSchemaVersion, CurrentRelease: browse.Current, RecommendedRelease: browse.Recommended,
			Candidates: []ReleaseCandidate{}, CheckStatus: "error", CatalogStatus: "error", LastErrorCode: code,
			CheckedAtUnixMs: now.UnixMilli(), NextCheckAtUnixMs: now.Add(releaseCheckInterval).UnixMilli(),
		}
		m.releaseViews[browse.Scope] = result
	}
	m.releaseMu.Unlock()
	if browse.ServiceID != "" {
		if hasSuccessfulPrevious {
			_ = m.persistReleaseView(ctx, browse, result)
		} else {
			_ = m.registry.MarkManagedReleaseCheckStale(ctx, browse.ServiceID, code, result.NextCheckAtUnixMs)
		}
	}
	if hasSuccessfulPrevious {
		return &result, nil
	}
	return &result, err
}

func (m *Manager) persistReleaseView(ctx context.Context, browse releaseBrowseContext, result ReleaseCandidateResult) error {
	if browse.ServiceID == "" {
		return nil
	}
	return m.persistReleaseCheck(ctx, browse.ServiceID, releaseSourceFingerprint(browse.Spec), result)
}

func (m *Manager) restoreReleaseView(ctx context.Context, browse releaseBrowseContext) (*ReleaseCandidateResult, bool) {
	if browse.ServiceID == "" {
		return nil, false
	}
	record, err := m.registry.GetManagedReleaseCheck(ctx, browse.ServiceID)
	if err != nil || record == nil {
		return nil, false
	}
	summary, err := decodeReleaseCheckSummary(record)
	if err != nil || summary.SourceFingerprint != releaseSourceFingerprint(browse.Spec) || len(summary.Candidates) == 0 {
		return nil, false
	}
	items := make([]cachedReleaseCandidate, 0, len(summary.Candidates))
	for _, snapshot := range summary.Candidates {
		snapshot.CandidateID = ""
		if releaseCandidateMatchesRecommendation(snapshot, browse.Recommended) {
			snapshot.IsRecommended = false
			if snapshot.VerificationStatus == "unavailable" || !snapshot.Selectable {
				snapshot.RecommendationStatus = "unavailable"
			} else {
				snapshot.RecommendationStatus = "pending"
			}
		}
		cached := cachedReleaseCandidate{Scope: browse.Scope, TemplateID: browse.TemplateID, Candidate: snapshot, Spec: cloneTemplateSpec(browse.Spec)}
		if snapshot.VerificationStatus == "verified" && snapshot.Selectable {
			cached.Identity = releaseIdentityFromCandidate(snapshot)
			if snapshot.SourceKind == "oci" && snapshot.Digest != "" {
				cached.Identity.ArtifactReference = snapshot.Source + ":" + snapshot.Tag + "@" + snapshot.Digest
				cached.Spec.Container.Image = cached.Identity.ArtifactReference
			} else if snapshot.SourceKind == "npm" && cached.Spec.Host != nil && cached.Spec.Host.NPM != nil {
				cached.Spec.Host.NPM.Version = snapshot.Version
			}
		}
		items = append(items, cached)
	}
	restoreBrowse := browse
	restoreBrowse.ServiceID = ""
	restoreBrowse.Recommended = nil
	result, err := m.replaceReleaseView(ctx, restoreBrowse, items, "stale", "", true)
	if err != nil {
		return nil, false
	}
	result.CheckStatus = "stale"
	result.RecommendedRelease = browse.Recommended
	result.CheckedAtUnixMs = record.CheckedAtUnixMs
	result.NextCheckAtUnixMs = record.NextCheckAtUnixMs
	result.LastErrorCode = record.LastErrorCode
	m.releaseMu.Lock()
	m.releaseViews[browse.Scope] = *result
	m.releaseMu.Unlock()
	return result, true
}
