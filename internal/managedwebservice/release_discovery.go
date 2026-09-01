package managedwebservice

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"errors"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

const (
	releaseCandidateSchemaVersion = 1
	releaseCandidateTTL           = 15 * time.Minute
	releaseCheckInterval          = 6 * time.Hour
)

const (
	releaseRiskPreview    = "preview_release"
	releaseRiskUnreviewed = "unreviewed_source"
	releaseRiskNPMScripts = "npm_lifecycle_scripts"
	releaseRiskDowngrade  = "downgrade"
)

type cachedReleaseCandidate struct {
	Scope      string
	TemplateID string
	Candidate  ReleaseCandidate
	Identity   ReleaseIdentity
	Spec       TemplateSpec
	ExpiresAt  time.Time
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
	result := ReleaseCandidateResult{SchemaVersion: releaseCandidateSchemaVersion, Current: current, Candidates: []ReleaseCandidate{}, CheckedAtUnixMs: now.UnixMilli(), NextCheckAtUnixMs: now.Add(releaseCheckInterval).UnixMilli()}
	if err != nil {
		code, message, _, _ := ErrorDetails(err)
		result.LastErrorCode, result.LastErrorMessage = code, message
		hasPrevious := false
		m.releaseMu.Lock()
		if previous, ok := m.releaseViews[scope]; ok && len(previous.Candidates) > 0 {
			hasPrevious = true
			previous.LastErrorCode, previous.LastErrorMessage = code, message
			previous.NextCheckAtUnixMs = result.NextCheckAtUnixMs
			m.releaseViews[scope] = previous
			result = previous
		} else {
			m.releaseViews[scope] = result
		}
		m.releaseMu.Unlock()
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
		result.Candidates = append(result.Candidates, candidates[index].Candidate)
	}
	m.releaseViews[scope] = result
	return &result, nil
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
	if templateSource == "builtin" && npm.PackageName == "@deepseek-ai/dsh" && normalizedRegistryURL(npm.RegistryURL) == "https://registry.npmjs.org/" {
		trust = "upstream_registry"
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
		if item.Deprecated {
			selectable, reasonCode, reason = false, "RELEASE_DEPRECATED", "The npm Registry marks this release as deprecated."
		}
		candidate := ReleaseCandidate{
			SourceKind: "npm", Source: npm.PackageName, Registry: normalizedRegistryURL(npm.RegistryURL), Version: item.Version, PublishedAtUnixMs: item.PublishedAtUnixMs,
			Channel: channel, Deprecated: item.Deprecated, DeprecationMessage: item.DeprecationMessage, Trust: trust,
			Selectable: selectable, ReasonCode: reasonCode, Reason: reason, Platform: currentPlatformKey(), Integrity: item.Integrity,
		}
		identity := ReleaseIdentity{SchemaVersion: 1, Kind: "npm", Source: npm.PackageName, Registry: normalizedRegistryURL(npm.RegistryURL), Version: item.Version, Integrity: item.Integrity, Platform: currentPlatformKey(), Trust: trust}
		if current != nil {
			candidate.Downgrade = releaseIsDowngrade(*current, identity)
		}
		result = append(result, cachedReleaseCandidate{Candidate: candidate, Identity: identity, Spec: candidateSpec})
	}
	return result, nil
}

func (m *Manager) discoverOCICandidates(ctx context.Context, spec TemplateSpec, current *ReleaseIdentity, templateSource string) ([]cachedReleaseCandidate, error) {
	reference := releaseImageRepository(spec.Container.Image)
	registryHost := releaseRegistryHost(reference)
	credential := containerengine.RegistryCredential{}
	if m.containers != nil {
		value, err := m.containers.RegistryCredential(ctx, containerengine.EngineDocker, registryHost)
		if err != nil {
			return nil, serviceError("RELEASE_SOURCE_AUTH_UNAVAILABLE", "Container Registry credentials could not be read from the current engine store.", 503, true, err)
		}
		credential = value
	}
	discovery := containerengine.OCIReleaseDiscovery{Client: m.releaseHTTPClient()}
	items, err := discovery.Discover(ctx, containerengine.OCIReleaseDiscoveryRequest{Reference: reference, PlatformOS: "linux", PlatformArch: runtime.GOARCH, Credential: credential})
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return nil, err
		case errors.Is(err, containerengine.ErrImageAccessDenied):
			return nil, serviceError("RELEASE_SOURCE_AUTH_REQUIRED", "The Container Registry rejected its current engine credentials.", 401, false, err)
		case errors.Is(err, containerengine.ErrImageRateLimited):
			return nil, serviceError("RELEASE_SOURCE_RATE_LIMITED", "The Container Registry rate limit was reached.", 429, true, err)
		default:
			return nil, serviceError("RELEASE_SOURCE_UNAVAILABLE", "The Container Registry could not provide release metadata.", 503, true, err)
		}
	}
	trust := "user_configured_registry"
	if templateSource == "builtin" {
		trust = "upstream_registry"
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
		for _, prefix := range releaseBlockedTagPrefixes(spec.Container) {
			if strings.HasPrefix(strings.ToLower(item.Tag), strings.ToLower(prefix)) {
				selectable, reasonCode, reason = false, "SPECIAL_TAG_BLOCKED", "This template marks the Registry tag as a non-deployable special build."
				break
			}
		}
		candidateSpec := cloneTemplateSpec(spec)
		candidateSpec.Container.Image = reference + ":" + item.Tag + "@" + item.PlatformDigest
		candidate := ReleaseCandidate{SourceKind: "oci", Source: reference, Tag: item.Tag, Channel: channel, Trust: trust, Selectable: selectable, ReasonCode: reasonCode, Reason: reason, Platform: "linux/" + runtime.GOARCH, IndexDigest: item.IndexDigest, Digest: item.PlatformDigest}
		if current != nil && current.Kind == "oci" && current.Tag == item.Tag && current.Digest != "" && current.Digest != item.PlatformDigest {
			candidate.TagMoved = true
		}
		identity := ReleaseIdentity{SchemaVersion: 1, Kind: "oci", Source: reference, Tag: item.Tag, Digest: item.PlatformDigest, Platform: "linux/" + runtime.GOARCH, ArtifactReference: candidateSpec.Container.Image, Trust: trust}
		if current != nil {
			candidate.Downgrade = releaseIsDowngrade(*current, identity)
		}
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

func releaseBlockedTagPrefixes(container *ContainerTemplateSpec) []string {
	if container == nil || container.ReleasePolicy == nil {
		return nil
	}
	return container.ReleasePolicy.BlockedTagPrefixes
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
		if spec.Container.ReleasePolicy != nil {
			policy := *spec.Container.ReleasePolicy
			policy.BlockedTagPrefixes = append([]string(nil), policy.BlockedTagPrefixes...)
			copy.Container.ReleasePolicy = &policy
		}
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

func validateReleaseRisks(candidate *cachedReleaseCandidate, current *ReleaseIdentity, accepted []string, npmScripts bool) error {
	acceptedSet := map[string]struct{}{}
	for _, id := range accepted {
		acceptedSet[strings.TrimSpace(id)] = struct{}{}
	}
	required := []string{}
	if npmScripts {
		required = append(required, releaseRiskNPMScripts)
	}
	if candidate != nil {
		if candidate.Candidate.Channel == "preview" {
			required = append(required, releaseRiskPreview)
		}
		if candidate.Candidate.Trust != "redeven_reviewed" {
			required = append(required, releaseRiskUnreviewed)
		}
		if current != nil && releaseIsDowngrade(*current, candidate.Identity) {
			required = append(required, releaseRiskDowngrade)
		}
	}
	for _, id := range required {
		if _, ok := acceptedSet[id]; !ok {
			return serviceError("RELEASE_RISK_ACKNOWLEDGEMENT_REQUIRED", "Accept every release safety warning before continuing.", 409, false, nil)
		}
	}
	return nil
}

func releaseIsDowngrade(current, target ReleaseIdentity) bool {
	if current.Kind == "npm" && target.Kind == "npm" && current.Source == target.Source && current.Registry == target.Registry {
		return compareReleaseVersions(target.Version, current.Version) < 0
	}
	_, currentSemver := parseSemanticVersion(strings.TrimPrefix(current.Tag, "v"))
	_, targetSemver := parseSemanticVersion(strings.TrimPrefix(target.Tag, "v"))
	if current.Kind == "oci" && target.Kind == "oci" && currentSemver && targetSemver && exactSemverPattern.MatchString(strings.TrimPrefix(current.Tag, "v")) && exactSemverPattern.MatchString(strings.TrimPrefix(target.Tag, "v")) {
		return compareReleaseVersions(strings.TrimPrefix(target.Tag, "v"), strings.TrimPrefix(current.Tag, "v")) < 0
	}
	return false
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
		m.log.Warn("check managed Web Service releases", "error", err)
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
	if candidate.Identity.Version != "" {
		base.Version = candidate.Identity.Version
	} else {
		base.Version = candidate.Identity.Tag
	}
	return base
}

func targetReleaseVersion(identity ReleaseIdentity) string {
	if identity.Version != "" {
		return identity.Version
	}
	return identity.Tag
}
