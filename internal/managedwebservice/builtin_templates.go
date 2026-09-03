package managedwebservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	servicetemplates "github.com/floegence/redeven-service-templates"
)

const catalogArtifactPlaceholder = "${REDEVEN_CATALOG_ARTIFACT}"

type BuiltinCatalog struct {
	version   string
	templates []catalogTemplate
	byID      map[string]catalogTemplate
}

type catalogBundle struct {
	SchemaVersion  int               `json:"schema_version"`
	CatalogVersion string            `json:"catalog_version"`
	Locales        []string          `json:"locales"`
	Templates      []catalogTemplate `json:"templates"`
}

type catalogTemplate struct {
	SchemaVersion      int                             `json:"schema_version"`
	TemplateID         string                          `json:"template_id"`
	ServiceFamilyID    string                          `json:"service_family_id"`
	RecommendedVersion string                          `json:"recommended_version"`
	Revision           int64                           `json:"revision"`
	SortOrder          int                             `json:"sort_order"`
	DeveloperPreview   bool                            `json:"developer_preview"`
	DiskBytes          int64                           `json:"disk_bytes"`
	SourceURL          string                          `json:"source_url"`
	DockerSourceURL    string                          `json:"docker_source_url,omitempty"`
	Deployment         Deployment                      `json:"deployment"`
	ContainerMode      string                          `json:"container_mode,omitempty"`
	DefaultAccessMode  string                          `json:"default_access_mode"`
	SupportedPlatforms []string                        `json:"supported_platforms,omitempty"`
	PlatformArtifacts  map[string]string               `json:"platform_artifacts,omitempty"`
	ReleaseDiscovery   *catalogReleaseDiscovery        `json:"release_discovery,omitempty"`
	Notices            []TemplateNotice                `json:"notices"`
	Spec               json.RawMessage                 `json:"spec"`
	Localizations      map[string]TemplateLocalization `json:"localizations"`
	Icon               TemplateIcon                    `json:"icon"`
}

type catalogReleaseDiscovery struct {
	Source string `json:"source"`
}

func LoadBuiltinCatalog() (*BuiltinCatalog, error) {
	raw := servicetemplates.Bundle()
	return loadBuiltinCatalog(raw, servicetemplates.Version, servicetemplates.BundleSHA256())
}

func loadBuiltinCatalog(raw []byte, expectedVersion, expectedSHA256 string) (*BuiltinCatalog, error) {
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expectedSHA256 {
		return nil, errors.New("managed service template bundle digest mismatch")
	}
	var bundle catalogBundle
	if err := decodeStrictJSON(raw, &bundle); err != nil {
		return nil, fmt.Errorf("decode managed service template bundle: %w", err)
	}
	if bundle.SchemaVersion != 2 || bundle.CatalogVersion != expectedVersion || len(bundle.Templates) == 0 || len(bundle.Locales) == 0 {
		return nil, errors.New("managed service template bundle identity is unsupported")
	}
	if !slices.Contains(bundle.Locales, "en-US") {
		return nil, errors.New("managed service template bundle is missing en-US")
	}
	catalog := &BuiltinCatalog{version: bundle.CatalogVersion, templates: append([]catalogTemplate(nil), bundle.Templates...), byID: make(map[string]catalogTemplate, len(bundle.Templates))}
	for _, template := range catalog.templates {
		if err := validateCatalogTemplate(template, bundle.Locales); err != nil {
			return nil, fmt.Errorf("managed service template %q: %w", template.TemplateID, err)
		}
		if _, duplicate := catalog.byID[template.TemplateID]; duplicate {
			return nil, fmt.Errorf("managed service template %q is duplicated", template.TemplateID)
		}
		catalog.byID[template.TemplateID] = template
	}
	return catalog, nil
}

func validateCatalogTemplate(template catalogTemplate, locales []string) error {
	if template.SchemaVersion != 2 || !managedWorkspaceIdentityPattern.MatchString(template.TemplateID) || !managedWorkspaceIdentityPattern.MatchString(template.ServiceFamilyID) || template.Revision < 1 || template.RecommendedVersion == "" || template.DiskBytes < 1 {
		return errors.New("identity, revision, recommended version, or disk requirement is invalid")
	}
	if template.Deployment != DeploymentHost && template.Deployment != DeploymentContainer && template.Deployment != DeploymentCompose {
		return errors.New("deployment is invalid")
	}
	if len(template.Localizations) != len(locales) {
		return errors.New("localization set is incomplete")
	}
	for _, locale := range locales {
		localized, ok := template.Localizations[locale]
		if !ok || strings.TrimSpace(localized.Name) == "" || strings.TrimSpace(localized.Description) == "" || len(localized.Notices) != len(template.Notices) {
			return fmt.Errorf("localization %q is incomplete", locale)
		}
		for _, notice := range template.Notices {
			copy, ok := localized.Notices[notice.ID]
			if !ok || strings.TrimSpace(copy.Title) == "" || strings.TrimSpace(copy.Description) == "" {
				return fmt.Errorf("localization %q notice %q is incomplete", locale, notice.ID)
			}
		}
	}
	if template.Icon.MediaType != "image/svg+xml" || strings.TrimSpace(template.Icon.Data) == "" || len(template.Icon.Data) > 64*1024 {
		return errors.New("icon is invalid")
	}
	iconSum := sha256.Sum256([]byte(template.Icon.Data))
	if hex.EncodeToString(iconSum[:]) != template.Icon.SHA256 {
		return errors.New("icon digest mismatch")
	}
	var spec TemplateSpec
	if err := decodeStrictJSON(template.Spec, &spec); err != nil {
		return fmt.Errorf("decode TemplateSpec: %w", err)
	}
	if spec.SchemaVersion != templateSpecSchemaVersion || spec.Kind != template.Deployment {
		return errors.New("TemplateSpec identity does not match deployment")
	}
	if template.Deployment == DeploymentContainer {
		if template.ReleaseDiscovery == nil || template.ReleaseDiscovery.Source != "oci" || template.ContainerMode != "single" || len(template.PlatformArtifacts) == 0 || spec.Container == nil || spec.Container.Image != catalogArtifactPlaceholder {
			return errors.New("single-container template artifacts are incomplete")
		}
		for platform, reference := range template.PlatformArtifacts {
			if !strings.HasPrefix(platform, "linux-") || imageReferenceDigest(reference) == "" {
				return fmt.Errorf("platform artifact %q is not an exact image reference", platform)
			}
			if releaseImageTag(strings.SplitN(reference, "@", 2)[0]) != template.RecommendedVersion {
				return fmt.Errorf("platform artifact %q does not match the recommended version", platform)
			}
		}
	}
	if template.Deployment == DeploymentHost {
		if template.ReleaseDiscovery == nil || template.ReleaseDiscovery.Source != "npm" || len(template.SupportedPlatforms) == 0 || spec.Host == nil || spec.Host.NPM == nil {
			return errors.New("host template npm package or platform matrix is incomplete")
		}
		if spec.Host.NPM.Version != template.RecommendedVersion {
			return errors.New("host template npm package does not match the recommended version")
		}
	}
	if template.Deployment == DeploymentCompose && template.ReleaseDiscovery != nil {
		return errors.New("compose templates cannot declare single-release discovery")
	}
	return nil
}

func (c *BuiltinCatalog) definition(templateID string) (catalogTemplate, bool) {
	if c == nil {
		return catalogTemplate{}, false
	}
	definition, ok := c.byID[strings.TrimSpace(templateID)]
	return definition, ok
}

func (m *Manager) builtInCatalog(ctx context.Context) ([]Template, error) {
	if m.catalog == nil {
		return nil, errors.New("managed service template catalog is unavailable")
	}
	dockerAvailable, dockerReasonCode, dockerReason := m.dockerAvailability(ctx)
	items := make([]Template, 0, len(m.catalog.templates))
	for _, definition := range m.catalog.templates {
		available, reasonCode, reason := true, "", ""
		if definition.Deployment == DeploymentContainer || definition.Deployment == DeploymentCompose {
			available, reasonCode, reason = dockerAvailable, dockerReasonCode, dockerReason
		}
		specRaw := append([]byte(nil), definition.Spec...)
		if definition.Deployment == DeploymentHost {
			if !slices.Contains(definition.SupportedPlatforms, currentPlatformKey()) {
				available, reasonCode, reason = false, "PLATFORM_UNSUPPORTED", "This template does not provide a release for the Environment platform."
			} else if artifact, ok := auditedNodeRuntimeArtifact(currentPlatformKey()); !ok || validateVerifiedPackageArtifact(artifact, m.downloads.packageHTTPClient(), defaultNodePackageOrigin) != nil {
				available, reasonCode, reason = false, "HOST_RUNTIME_UNAVAILABLE", "The managed Host runtime is unavailable for the Environment platform."
			}
		}
		if definition.Deployment == DeploymentContainer {
			artifact, ok := definition.PlatformArtifacts["linux-"+runtime.GOARCH]
			if !ok {
				available, reasonCode, reason = false, "CONTAINER_PLATFORM_UNSUPPORTED", "This template does not provide a container image for the Environment CPU architecture."
			} else {
				if bytes.Count(specRaw, []byte(catalogArtifactPlaceholder)) != 1 {
					return nil, fmt.Errorf("managed service template %q artifact placeholder is invalid", definition.TemplateID)
				}
				specRaw = bytes.ReplaceAll(specRaw, []byte(catalogArtifactPlaceholder), []byte(artifact))
			}
		}
		var spec TemplateSpec
		if err := decodeStrictJSON(specRaw, &spec); err != nil {
			return nil, fmt.Errorf("decode managed service template %q: %w", definition.TemplateID, err)
		}
		if err := validateTemplateSpec(spec); err != nil && available {
			return nil, fmt.Errorf("validate managed service template %q: %w", definition.TemplateID, err)
		}
		workspace, err := m.defaultWorkspacePath(definition.TemplateID)
		if err != nil {
			return nil, err
		}
		var effectiveSpec *TemplateSpec
		if available {
			effective, err := effectiveTemplateSpec(spec)
			if err != nil {
				return nil, err
			}
			effectiveSpec = &effective
		}
		name, description := definition.TemplateID, ""
		if localized, ok := definition.Localizations["en-US"]; ok {
			name, description = localized.Name, localized.Description
		}
		icon := definition.Icon
		dataLocation := ""
		if definition.Deployment == DeploymentHost {
			dataLocation = filepath.Join(m.stateDir, "data", definition.ServiceFamilyID)
		}
		item := Template{
			TemplateID: definition.TemplateID, ServiceFamilyID: definition.ServiceFamilyID,
			Name: name, Description: description, Localizations: cloneLocalizations(definition.Localizations), Icon: &icon,
			Notices:          append([]TemplateNotice(nil), definition.Notices...),
			DeveloperPreview: definition.DeveloperPreview, DiskBytes: definition.DiskBytes,
			DataLocation: dataLocation,
			SourceURL:    definition.SourceURL, DockerSourceURL: definition.DockerSourceURL,
			Source: "builtin", Deployment: definition.Deployment, ContainerMode: definition.ContainerMode,
			Revision: definition.Revision, Editable: false, Duplicateable: completeBuiltInDuplicateSpec(spec),
			Available: available, ReasonCode: reasonCode, Reason: reason, SortOrder: definition.SortOrder,
			Deployments:          []DeploymentAvailability{{Deployment: definition.Deployment, Available: available, ReasonCode: reasonCode, Reason: reason}},
			DefaultWorkspacePath: workspace, WorkspaceRoots: m.workspaceRoots(), Spec: &spec, EffectiveSpec: effectiveSpec,
			HostLifecyclePlan: hostLifecyclePlan(spec), DefaultAccessMode: defaultAccessMode(definition.DefaultAccessMode),
		}
		if definition.ReleaseDiscovery != nil {
			item.ReleaseSource = definition.ReleaseDiscovery.Source
		}
		item.RecommendedRelease = recommendedReleaseForTemplate(item)
		items = append(items, item)
	}
	return items, nil
}

func cloneLocalizations(source map[string]TemplateLocalization) map[string]TemplateLocalization {
	result := make(map[string]TemplateLocalization, len(source))
	for locale, localized := range source {
		copy := localized
		copy.Notices = make(map[string]LocalizedTemplateNotice, len(localized.Notices))
		for id, notice := range localized.Notices {
			copy.Notices[id] = notice
		}
		result[locale] = copy
	}
	return result
}

func defaultAccessMode(value string) string {
	if strings.TrimSpace(value) == "desktop_loopback" {
		return "desktop_loopback"
	}
	return "unified_proxy"
}
