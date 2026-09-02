package managedwebservice

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	releaseCandidateSchemaVersion = 1
	releaseCandidateTTL           = 15 * time.Minute
	releaseCheckInterval          = 6 * time.Hour
)

const (
	releaseRiskPreview    = "preview_release"
	releaseRiskNPMScripts = "npm_lifecycle_scripts"
	releaseRiskDowngrade  = "downgrade"
)

type cachedReleaseCandidate struct {
	Scope            string
	TemplateID       string
	TemplateRevision int64
	Notices          []TemplateNotice
	Candidate        ReleaseCandidate
	Identity         ReleaseIdentity
	Spec             TemplateSpec
	ExpiresAt        time.Time
}

type releaseCheckSummary struct {
	SchemaVersion        int              `json:"schema_version"`
	LatestStableRelease  *ReleaseIdentity `json:"latest_stable_release,omitempty"`
	LatestPreviewRelease *ReleaseIdentity `json:"latest_preview_release,omitempty"`
}

func (m *Manager) TemplateReleaseCandidates(ctx context.Context, templateID string, request ReleaseCandidateRequest) (*ReleaseCandidateResult, error) {
	if request.Refresh {
		ctx = withReleaseSourceRefresh(ctx)
	}
	template, err := m.Template(ctx, strings.TrimSpace(templateID))
	if err != nil {
		return nil, err
	}
	if template.Spec == nil {
		return nil, serviceError("RELEASE_DISCOVERY_UNSUPPORTED", "This template has no discoverable release source.", 409, false, nil)
	}
	secrets := map[string]string{}
	for name, value := range request.Parameters {
		for _, parameter := range template.Spec.Parameters {
			if parameter.Name == name && parameter.Type == "secret" {
				secrets[name] = value
				break
			}
		}
	}
	return m.discoverAndCache(ctx, "template:"+template.TemplateID, template.TemplateID, *template.Spec, secrets, nil, template.Source)
}

func (m *Manager) ServiceReleaseCandidates(ctx context.Context, serviceID string, request ReleaseCandidateRequest) (*ReleaseCandidateResult, error) {
	if request.Refresh {
		ctx = withReleaseSourceRefresh(ctx)
	}
	service, err := m.registry.GetManagedService(ctx, strings.TrimSpace(serviceID))
	if err != nil {
		return nil, err
	}
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service was not found.", 404, false, nil)
	}
	spec, err := templateSpecFromService(service)
	if err != nil {
		return nil, err
	}
	parameters, err := m.serviceParameters(service)
	if err != nil {
		return nil, err
	}
	current, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil {
		return nil, serviceError("RELEASE_IDENTITY_INVALID", "The managed Web Service release identity is invalid.", 409, false, err)
	}
	return m.discoverAndCache(ctx, "service:"+service.ServiceID, service.TemplateID, spec, parameters, current, service.TemplateSource)
}

func (m *Manager) discoverAndCache(ctx context.Context, scope, templateID string, spec TemplateSpec, parameters map[string]string, current *ReleaseIdentity, templateSource string) (*ReleaseCandidateResult, error) {
	candidates, err := m.discoverCandidates(ctx, spec, parameters, current, templateSource)
	now := time.Now()
	var recommended *ReleaseIdentity
	if template, templateErr := m.Template(ctx, templateID); templateErr == nil {
		recommended = template.RecommendedRelease
	}
	result := ReleaseCandidateResult{SchemaVersion: releaseCandidateSchemaVersion, CurrentRelease: current, RecommendedRelease: recommended, Candidates: []ReleaseCandidate{}, CheckStatus: "fresh", CheckedAtUnixMs: now.UnixMilli(), NextCheckAtUnixMs: now.Add(releaseCheckInterval).UnixMilli()}
	if err != nil {
		code, message, _, _ := ErrorDetails(err)
		result.LastErrorCode, result.LastErrorMessage = code, message
		hasPrevious := false
		m.releaseMu.Lock()
		if previous, ok := m.releaseViews[scope]; ok && len(previous.Candidates) > 0 {
			hasPrevious = true
			previous.LastErrorCode, previous.LastErrorMessage = code, message
			previous.CheckStatus = "stale"
			previous.NextCheckAtUnixMs = result.NextCheckAtUnixMs
			m.releaseViews[scope] = previous
			result = previous
		} else {
			result.CheckStatus = "error"
			m.releaseViews[scope] = result
		}
		m.releaseMu.Unlock()
		if strings.HasPrefix(scope, "service:") {
			_ = m.registry.MarkManagedReleaseCheckStale(ctx, strings.TrimPrefix(scope, "service:"), code, result.NextCheckAtUnixMs)
		}
		if hasPrevious {
			return &result, nil
		}
		return &result, err
	}
	m.releaseMu.Lock()
	defer m.releaseMu.Unlock()
	for id, item := range m.releaseItems {
		if item.Scope == scope || now.After(item.ExpiresAt) {
			delete(m.releaseItems, id)
		}
	}
	for index := range candidates {
		id, idErr := randomID("rel")
		if idErr != nil {
			return nil, idErr
		}
		candidates[index].Candidate.CandidateID = id
		candidates[index].Candidate.SchemaVersion = releaseCandidateSchemaVersion
		candidates[index].Scope = scope
		candidates[index].TemplateID = templateID
		candidates[index].ExpiresAt = now.Add(releaseCandidateTTL)
		m.releaseItems[id] = candidates[index]
		candidate := &candidates[index].Candidate
		candidate.IsCurrent = current != nil && sameReleaseSelection(*current, candidates[index].Identity)
		candidate.IsRecommended = recommended != nil && sameReleaseSelection(*recommended, candidates[index].Identity)
		candidate.Relation = releaseRelation(current, candidates[index].Identity)
		if result.LatestStableRelease == nil && candidate.Channel == "stable" {
			candidate.IsLatestStable = true
			value := *candidate
			result.LatestStableRelease = &value
		}
		if result.LatestPreviewRelease == nil && candidate.Channel == "preview" {
			candidate.IsLatestPreview = true
			value := *candidate
			result.LatestPreviewRelease = &value
		}
		result.Candidates = append(result.Candidates, *candidate)
	}
	m.releaseViews[scope] = result
	if strings.HasPrefix(scope, "service:") {
		if err := m.persistReleaseCheck(ctx, strings.TrimPrefix(scope, "service:"), result); err != nil {
			m.log.Warn("persist managed Web Service release check", "service_id", strings.TrimPrefix(scope, "service:"), "cause", safeManagedFailureCause(err))
		}
	}
	return &result, nil
}

func (m *Manager) persistReleaseCheck(ctx context.Context, serviceID string, result ReleaseCandidateResult) error {
	summary := releaseCheckSummary{SchemaVersion: 1}
	if result.LatestStableRelease != nil {
		value := releaseIdentityFromCandidate(*result.LatestStableRelease)
		summary.LatestStableRelease = &value
	}
	if result.LatestPreviewRelease != nil {
		value := releaseIdentityFromCandidate(*result.LatestPreviewRelease)
		summary.LatestPreviewRelease = &value
	}
	raw, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(raw)
	return m.registry.UpsertManagedReleaseCheck(ctx, pfregistry.ManagedReleaseCheck{
		ServiceID: serviceID, SummaryJSON: string(raw), SummarySHA256: hex.EncodeToString(sum[:]), CheckedAtUnixMs: result.CheckedAtUnixMs,
		NextCheckAtUnixMs: result.NextCheckAtUnixMs, Stale: result.CheckStatus == "stale", LastErrorCode: result.LastErrorCode,
	})
}

func decodeReleaseCheckSummary(record *pfregistry.ManagedReleaseCheck) (releaseCheckSummary, error) {
	if record == nil {
		return releaseCheckSummary{}, nil
	}
	var summary releaseCheckSummary
	if err := decodeStrictJSON([]byte(record.SummaryJSON), &summary); err != nil {
		return releaseCheckSummary{}, err
	}
	if summary.SchemaVersion != 1 {
		return releaseCheckSummary{}, errors.New("managed release check schema is unsupported")
	}
	return summary, nil
}

func (m *Manager) discoverCandidates(ctx context.Context, spec TemplateSpec, parameters map[string]string, current *ReleaseIdentity, templateSource string) ([]cachedReleaseCandidate, error) {
	if spec.Kind == DeploymentHost && spec.Host != nil && spec.Host.NPM != nil {
		return m.discoverNPMCandidates(ctx, spec, parameters, current, templateSource)
	}
	if spec.Kind == DeploymentContainer && spec.Container != nil {
		return m.discoverOCICandidates(ctx, spec, current, templateSource)
	}
	return nil, serviceError("RELEASE_DISCOVERY_UNSUPPORTED", "Release discovery supports npm Host and single-container templates.", 409, false, nil)
}

func (m *Manager) discoverNPMCandidates(ctx context.Context, spec TemplateSpec, parameters map[string]string, current *ReleaseIdentity, templateSource string) ([]cachedReleaseCandidate, error) {
	npm := *spec.Host.NPM
	token := ""
	if name := strings.TrimSpace(npm.AuthTokenParameter); name != "" {
		token = parameters[name]
	}
	items, err := fetchNPMReleases(ctx, m.releaseHTTPClient(), npm, token)
	if err != nil {
		return nil, err
	}
	trust := "user_configured_registry"
	if templateSource == "builtin" {
		trust = "catalog_reviewed_source"
	}
	result := make([]cachedReleaseCandidate, 0, len(items))
	for _, item := range items {
		candidateSpec := cloneTemplateSpec(spec)
		candidateSpec.Host.NPM.Version = item.Version
		channel := "stable"
		if strings.Contains(item.Version, "-") {
			channel = "preview"
		}
		selectable, reasonCode, reason := nodeRangeCompatible(item.NodeRange)
		if !item.IntegrityVerified {
			selectable = false
			reasonCode = "RELEASE_IDENTITY_UNVERIFIABLE"
			reason = "The npm Registry did not provide a verifiable SHA-512 integrity for this exact package version."
		}
		candidate := ReleaseCandidate{
			SourceKind: "npm", Source: npm.PackageName, Registry: normalizedRegistryURL(npm.RegistryURL), Version: item.Version, PublishedAtUnixMs: item.PublishedAtUnixMs,
			Channel: channel, Deprecated: item.Deprecated, DeprecationMessage: item.DeprecationMessage, Trust: trust,
			Selectable: selectable, ReasonCode: reasonCode, Reason: reason, Platform: currentPlatformKey(), Integrity: item.Integrity,
		}
		identity := ReleaseIdentity{SchemaVersion: 1, Kind: "npm", Source: npm.PackageName, Registry: normalizedRegistryURL(npm.RegistryURL), Version: item.Version, Integrity: item.Integrity, Platform: currentPlatformKey(), Trust: trust}
		result = append(result, cachedReleaseCandidate{Candidate: candidate, Identity: identity, Spec: candidateSpec})
	}
	return result, nil
}

func (m *Manager) discoverOCICandidates(ctx context.Context, spec TemplateSpec, current *ReleaseIdentity, templateSource string) ([]cachedReleaseCandidate, error) {
	reference := releaseImageRepository(spec.Container.Image)
	registryHost := releaseRegistryHost(reference)
	credential := containerengine.RegistryCredential{}
	var credentialErr error
	if m.containers != nil {
		value, err := m.containers.RegistryCredential(ctx, containerengine.EngineDocker, registryHost)
		if err != nil {
			credentialErr = err
		} else {
			credential = value
		}
	}
	discovery := containerengine.OCIReleaseDiscovery{Client: m.releaseHTTPClient()}
	items, err := discovery.Discover(ctx, containerengine.OCIReleaseDiscoveryRequest{Reference: reference, PlatformOS: "linux", PlatformArch: runtime.GOARCH, Credential: credential})
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return nil, err
		case errors.Is(err, containerengine.ErrImageAccessDenied):
			if credentialErr != nil {
				return nil, serviceError("RELEASE_SOURCE_AUTH_UNAVAILABLE", "Container Registry credentials could not be read from the current engine store.", 503, true, credentialErr)
			}
			return nil, serviceError("RELEASE_SOURCE_AUTH_REQUIRED", "The Container Registry rejected its current engine credentials.", 401, false, err)
		case errors.Is(err, containerengine.ErrImageRateLimited):
			return nil, serviceError("RELEASE_SOURCE_RATE_LIMITED", "The Container Registry rate limit was reached.", 429, true, err)
		default:
			return nil, serviceError("RELEASE_SOURCE_UNAVAILABLE", "The Container Registry could not provide release metadata.", 503, true, err)
		}
	}
	trust := "user_configured_registry"
	if templateSource == "builtin" {
		trust = "catalog_reviewed_source"
	}
	result := make([]cachedReleaseCandidate, 0, len(items))
	for _, item := range items {
		channel := "special"
		_, semanticTag := parseSemanticVersion(strings.TrimPrefix(item.Tag, "v"))
		if exactSemverPattern.MatchString(strings.TrimPrefix(item.Tag, "v")) && semanticTag {
			channel = "stable"
			if strings.Contains(item.Tag, "-") {
				channel = "preview"
			}
		}
		selectable, reasonCode, reason := item.Compatible, item.ReasonCode, item.Reason
		candidateSpec := cloneTemplateSpec(spec)
		candidateSpec.Container.Image = reference + ":" + item.Tag + "@" + item.PlatformDigest
		candidate := ReleaseCandidate{SourceKind: "oci", Source: reference, Tag: item.Tag, Channel: channel, Trust: trust, Selectable: selectable, ReasonCode: reasonCode, Reason: reason, Platform: "linux/" + runtime.GOARCH, IndexDigest: item.IndexDigest, Digest: item.PlatformDigest}
		if current != nil && current.Kind == "oci" && current.Tag == item.Tag && current.Digest != "" && current.Digest != item.PlatformDigest {
			candidate.TagMoved = true
		}
		identity := ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: reference, Tag: item.Tag, Digest: item.PlatformDigest, Platform: "linux/" + runtime.GOARCH, ArtifactReference: candidateSpec.Container.Image, Trust: trust}
		result = append(result, cachedReleaseCandidate{Candidate: candidate, Identity: identity, Spec: candidateSpec})
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, right := strings.TrimPrefix(result[i].Candidate.Tag, "v"), strings.TrimPrefix(result[j].Candidate.Tag, "v")
		_, leftSemver := parseSemanticVersion(left)
		_, rightSemver := parseSemanticVersion(right)
		leftSemver = leftSemver && exactSemverPattern.MatchString(left)
		rightSemver = rightSemver && exactSemverPattern.MatchString(right)
		if leftSemver != rightSemver {
			return leftSemver
		}
		if leftSemver {
			return compareReleaseVersions(left, right) > 0
		}
		return result[i].Candidate.Tag < result[j].Candidate.Tag
	})
	return result, nil
}

func cloneTemplateSpec(spec TemplateSpec) TemplateSpec {
	copy := spec
	if spec.Host != nil {
		host := *spec.Host
		copy.Host = &host
		if spec.Host.NPM != nil {
			npm := *spec.Host.NPM
			copy.Host.NPM = &npm
		}
	}
	if spec.Container != nil {
		container := *spec.Container
		copy.Container = &container
	}
	return copy
}

func nodeRangeCompatible(value string) (bool, string, string) {
	value = strings.TrimSpace(value)
	if value == "" || value == "*" {
		return true, "", ""
	}
	current, ok := parseSemanticVersion(nodeVersion)
	if !ok {
		return false, "NODE_RANGE_UNSUPPORTED", "Redeven could not verify this release against its managed Node.js Runtime."
	}
	understood := false
	for _, clause := range strings.Split(value, "||") {
		matches, recognized := nodeRangeClauseMatches(current, clause)
		understood = understood || recognized
		if recognized && matches {
			return true, "", ""
		}
	}
	if !understood {
		return false, "NODE_RANGE_UNSUPPORTED", "This release uses a Node.js version range that Redeven cannot verify safely."
	}
	return false, "NODE_VERSION_UNAVAILABLE", "This release is incompatible with the Node.js Runtime managed by this Redeven version."
}

func nodeRangeClauseMatches(current semanticVersion, clause string) (bool, bool) {
	clause = strings.ReplaceAll(strings.TrimSpace(clause), ",", " ")
	if clause == "" {
		return false, false
	}
	recognized := false
	for _, token := range strings.Fields(clause) {
		matches, ok := nodeComparatorMatches(current, token)
		if !ok {
			return false, false
		}
		recognized = true
		if !matches {
			return false, true
		}
	}
	return true, recognized
}

func nodeComparatorMatches(current semanticVersion, token string) (bool, bool) {
	token = strings.TrimSpace(token)
	operator := "="
	for _, candidate := range []string{">=", "<=", ">", "<", "^", "~", "="} {
		if strings.HasPrefix(token, candidate) {
			operator, token = candidate, strings.TrimSpace(strings.TrimPrefix(token, candidate))
			break
		}
	}
	parts := strings.Split(strings.TrimPrefix(token, "v"), ".")
	if len(parts) == 0 || len(parts) > 3 {
		return false, false
	}
	var target semanticVersion
	specified := len(parts)
	for index := 0; index < 3; index++ {
		if index >= len(parts) || parts[index] == "x" || parts[index] == "X" || parts[index] == "*" {
			specified = index
			break
		}
		part := parts[index]
		if index == len(parts)-1 {
			part, _, _ = strings.Cut(part, "-")
		}
		number, err := strconv.ParseInt(part, 10, 64)
		if err != nil || number < 0 {
			return false, false
		}
		target.core[index] = number
	}
	compare := func(left, right semanticVersion) int {
		for index := range left.core {
			if left.core[index] < right.core[index] {
				return -1
			}
			if left.core[index] > right.core[index] {
				return 1
			}
		}
		return 0
	}
	comparison := compare(current, target)
	switch operator {
	case ">=":
		return comparison >= 0, true
	case ">":
		return comparison > 0, true
	case "<=":
		return comparison <= 0, true
	case "<":
		return comparison < 0, true
	case "^", "~":
		upper := target
		if operator == "~" {
			upper.core[1]++
			upper.core[2] = 0
		} else if target.core[0] > 0 {
			upper.core[0]++
			upper.core[1], upper.core[2] = 0, 0
		} else {
			upper.core[1]++
			upper.core[2] = 0
		}
		return comparison >= 0 && compare(current, upper) < 0, true
	default:
		if specified < 3 {
			if specified == 0 {
				return true, true
			}
			for index := 0; index < specified; index++ {
				if current.core[index] != target.core[index] {
					return false, true
				}
			}
			return true, true
		}
		return comparison == 0, true
	}
}

func releaseRegistryHost(reference string) string {
	first, _, _ := strings.Cut(reference, "/")
	if strings.Contains(first, ".") || strings.Contains(first, ":") || first == "localhost" {
		if first == "docker.io" {
			return "registry-1.docker.io"
		}
		return first
	}
	return "registry-1.docker.io"
}

func (m *Manager) resolveReleaseCandidate(ctx context.Context, scope, candidateID string, parameters map[string]string, current *ReleaseIdentity, templateSource string) (*cachedReleaseCandidate, error) {
	candidateID = strings.TrimSpace(candidateID)
	m.releaseMu.Lock()
	cached, ok := m.releaseItems[candidateID]
	m.releaseMu.Unlock()
	if !ok || cached.Scope != scope || time.Now().After(cached.ExpiresAt) {
		return nil, serviceError("RELEASE_CANDIDATE_EXPIRED", "Refresh the version list before selecting this release.", 409, true, nil)
	}
	fresh, err := m.discoverCandidates(withReleaseSourceRefresh(ctx), cached.Spec, parameters, current, templateSource)
	if err != nil {
		return nil, err
	}
	for index := range fresh {
		if sameReleaseIdentity(fresh[index].Identity, cached.Identity) {
			if !fresh[index].Candidate.Selectable {
				return nil, serviceError(fresh[index].Candidate.ReasonCode, fresh[index].Candidate.Reason, 409, false, nil)
			}
			fresh[index].Candidate.CandidateID = candidateID
			fresh[index].Scope, fresh[index].TemplateID = cached.Scope, cached.TemplateID
			return &fresh[index], nil
		}
	}
	return nil, serviceError("RELEASE_CANDIDATE_CHANGED", "The selected release changed at its source. Refresh the version list and review it again.", 409, true, nil)
}

func sameReleaseIdentity(left, right ReleaseIdentity) bool {
	return left.Kind == right.Kind && left.Source == right.Source && left.Registry == right.Registry && left.Version == right.Version && left.Tag == right.Tag && left.Digest == right.Digest && left.Integrity == right.Integrity && left.Platform == right.Platform
}

func sameReleaseSelection(left, right ReleaseIdentity) bool {
	if left.Kind != right.Kind || left.Source != right.Source || left.Registry != right.Registry || left.Version != right.Version || left.Tag != right.Tag || left.Platform != right.Platform {
		return false
	}
	if left.Digest != "" && right.Digest != "" && left.Digest != right.Digest {
		return false
	}
	if left.Integrity != "" && right.Integrity != "" && left.Integrity != right.Integrity {
		return false
	}
	return true
}

func releaseRelation(current *ReleaseIdentity, target ReleaseIdentity) string {
	if current == nil {
		return "unknown"
	}
	if sameReleaseSelection(*current, target) {
		return "same"
	}
	if current.Kind == "npm" && target.Kind == "npm" && current.Source == target.Source && current.Registry == target.Registry {
		comparison := compareReleaseVersions(target.Version, current.Version)
		if comparison > 0 {
			return "newer"
		}
		if comparison < 0 {
			return "older"
		}
		return "unknown"
	}
	currentTag, targetTag := strings.TrimPrefix(current.Tag, "v"), strings.TrimPrefix(target.Tag, "v")
	_, currentOK := parseSemanticVersion(currentTag)
	_, targetOK := parseSemanticVersion(targetTag)
	if current.Kind == "oci" && target.Kind == "oci" && current.Source == target.Source && currentOK && targetOK && exactSemverPattern.MatchString(currentTag) && exactSemverPattern.MatchString(targetTag) {
		comparison := compareReleaseVersions(targetTag, currentTag)
		if comparison > 0 {
			return "newer"
		}
		if comparison < 0 {
			return "older"
		}
	}
	return "unknown"
}

func validateInstallReleaseRisks(template Template, candidate *cachedReleaseCandidate, accepted []string) error {
	acceptedSet := map[string]struct{}{}
	for _, id := range accepted {
		acceptedSet[strings.TrimSpace(id)] = struct{}{}
	}
	if candidate == nil {
		return nil
	}
	required := updatePlanRisks(template, candidate, nil, candidate.Identity, true, "unknown")
	for _, id := range required {
		if _, ok := acceptedSet[id]; !ok {
			return serviceError("RELEASE_RISK_ACKNOWLEDGEMENT_REQUIRED", "Accept every release safety warning before continuing.", 409, false, nil)
		}
	}
	return nil
}

func (m *Manager) startReleaseDiscovery() {
	m.releaseMu.Lock()
	if m.releaseCancel != nil {
		m.releaseMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.releaseCancel = cancel
	m.releaseMu.Unlock()
	m.workers.Add(1)
	go func() {
		defer m.workers.Done()
		delay := 30*time.Second + randomReleaseDelay(60*time.Second)
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		for {
			m.refreshInstalledReleases(ctx)
			timer.Reset(releaseCheckInterval)
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
		}
	}()
}

func (m *Manager) scheduleReleaseCheck(serviceID string) {
	serviceID = strings.TrimSpace(serviceID)
	if serviceID == "" {
		return
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.workers.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.workers.Done()
		if _, err := m.ServiceReleaseCandidates(context.Background(), serviceID, ReleaseCandidateRequest{Refresh: true}); err != nil {
			m.log.Debug("refresh managed Web Service release after lifecycle change", "service_id", serviceID, "error", err)
		}
	}()
}

func randomReleaseDelay(limit time.Duration) time.Duration {
	if limit <= 0 {
		return 0
	}
	var raw [8]byte
	if _, err := cryptorand.Read(raw[:]); err != nil {
		return 0
	}
	return time.Duration(binary.LittleEndian.Uint64(raw[:]) % uint64(limit))
}

func (m *Manager) refreshInstalledReleases(ctx context.Context) {
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		m.log.Warn("check managed Web Service releases", "cause", safeManagedFailureCause(err))
		return
	}
	for index := range services {
		if ctx.Err() != nil {
			return
		}
		_, err := m.ServiceReleaseCandidates(ctx, services[index].ServiceID, ReleaseCandidateRequest{})
		if err != nil {
			m.log.Debug("managed Web Service release check failed", "service_id", services[index].ServiceID, "error", err)
		}
	}
}

func (m *Manager) releaseView(scope string) (ReleaseCandidateResult, bool) {
	m.releaseMu.Lock()
	defer m.releaseMu.Unlock()
	value, ok := m.releaseViews[scope]
	return value, ok
}

func releaseCandidateTemplate(base Template, candidate cachedReleaseCandidate) Template {
	base.Spec = &candidate.Spec
	effective, _ := effectiveTemplateSpec(candidate.Spec)
	base.EffectiveSpec = &effective
	identity := candidate.Identity
	base.RecommendedRelease = &identity
	return base
}
