package managedwebservice

import (
	"context"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// A personal definition owns its spec and family; its immutable upstream files
// remain a verified pinned base, independent of the mutable source library.
func (m *Manager) applyPersonalTemplateBase(ctx context.Context, result *Template, probeRuntime bool) error {
	var base *pfregistry.ManagedTemplateSource
	var err error
	if m.registry != nil {
		base, err = m.registry.GetManagedTemplateBase(ctx, result.TemplateID)
	}
	if err != nil {
		return err
	}
	if base == nil {
		if result.Spec.Container != nil && result.Spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
			return serviceError("TEMPLATE_RUNTIME_PROFILE_RESERVED", "The interactive desktop runtime profile requires a reviewed immutable base.", 400, false, nil)
		}
		return nil
	}
	original, _, err := m.readSourceTemplateWithAvailability(ctx, *base, probeRuntime)
	if err != nil {
		return err
	}
	if result.Spec.Container != nil && result.Spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
		if err := validatePersonalRuntime(*original.Spec, *result.Spec); err != nil {
			return err
		}
		result.RuntimeLocked = true
	}
	result.SourceDirectory = original.SourceDirectory
	result.SourceRuntimeSHA256 = original.SourceRuntimeSHA256
	result.SourceSHA256 = original.SourceSHA256
	result.GitSource = original.GitSource
	result.Icon = original.Icon
	result.Notices = original.Notices
	result.DefaultLocale = original.DefaultLocale
	result.Localizations = make(map[string]TemplateLocalization, len(original.Localizations))
	for locale, value := range original.Localizations {
		value.Name, value.Description = result.Name, result.Description
		result.Localizations[locale] = value
	}
	result.DefaultAccessMode = original.DefaultAccessMode
	result.SourceURL = original.SourceURL
	result.DockerSourceURL = original.DockerSourceURL
	result.DeveloperPreview = original.DeveloperPreview
	result.DiskBytes = original.DiskBytes
	return nil
}

func validatePersonalRuntime(original, edited TemplateSpec) error {
	_, before, err := canonicalTemplateSpec(original)
	if err != nil {
		return err
	}
	_, after, err := canonicalTemplateSpec(edited)
	if err != nil {
		return err
	}
	if before != after {
		return serviceError("TEMPLATE_RUNTIME_PROFILE_RESERVED", "This reviewed desktop runtime must remain unchanged. Customize instance settings after deployment.", 400, false, nil)
	}
	return nil
}
