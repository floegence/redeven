package managedwebservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func openingRuleDigest(spec TemplateSpec) string {
	hook, after := "", ""
	if spec.Host != nil {
		hook, after = spec.Host.OpenScript, spec.Host.AfterStartScript
	}
	raw, _ := json.Marshal(struct {
		Endpoint    WebEndpointSpec
		Startup     *templatecontract.StartupURLSpec
		Hook, After string
	}{spec.Endpoint, spec.StartupURL, hook, after})
	return requestFingerprint("opening-rule-v1", string(raw))
}

func (m *Manager) openingStatePath(service *pfregistry.ManagedService) string {
	binding, err := decodeRuntimeBinding(service)
	if err == nil && binding.Deployment == DeploymentHost {
		if driver, ok := m.host.(*hostScriptDriver); ok {
			return driver.openSessionPath(service)
		}
	}
	return m.staticOpeningPath(service)
}

func (m *Manager) readOpeningState(service *pfregistry.ManagedService) (serviceOpenSessionState, error) {
	path := m.openingStatePath(service)
	info, err := os.Lstat(path)
	if err != nil {
		return serviceOpenSessionState{}, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 64*1024 {
		return serviceOpenSessionState{}, serviceError("SERVICE_OPEN_TARGET_INVALID", "The saved entrance is not a private regular file.", 409, true, nil)
	}
	file, err := os.Open(path)
	if err != nil {
		return serviceOpenSessionState{}, err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return serviceOpenSessionState{}, serviceError("SERVICE_OPEN_TARGET_INVALID", "The private entrance identity changed.", 409, true, nil)
	}
	raw, err := io.ReadAll(io.LimitReader(file, 64*1024+1))
	if err != nil || len(raw) > 64*1024 {
		return serviceOpenSessionState{}, serviceError("SERVICE_OPEN_TARGET_INVALID", "The private entrance could not be read safely.", 409, true, nil)
	}
	var state serviceOpenSessionState
	if err := decodeStrictJSON(raw, &state); err != nil || (state.SchemaVersion != 1 && state.SchemaVersion != serviceOpenSessionSchemaVersion) || state.ServiceID != service.ServiceID || state.RuntimeIdentity != service.RuntimeIdentity || state.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 || (state.AppPath != "" && !validServiceOpeningPath(state.AppPath, true)) {
		return state, serviceError("SERVICE_OPEN_TARGET_INVALID", "The saved service entrance identity is invalid.", 409, true, nil)
	}
	return state, nil
}

func (m *Manager) persistOpeningState(service *pfregistry.ManagedService, state serviceOpenSessionState) error {
	path := m.openingStatePath(service)
	if path == "" {
		return serviceError("SERVICE_OPEN_TARGET_UNAVAILABLE", "Private entrance storage is unavailable.", 500, true, nil)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if err := privateDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	return writePrivateJSON(path, state)
}

// prepareServiceOpening is the only Runtime entrance preparation path. Drivers
// supply verified launch facts; preparation never creates a lifecycle operation.
type openingPreparation struct {
	Refresh   bool
	NewLaunch bool // Only the lifecycle owner can apply a current entrance rule.
}

func (m *Manager) prepareServiceOpening(ctx context.Context, service *pfregistry.ManagedService, launch serviceOpeningLaunch, options openingPreparation) (appPath string, bootstrap bool, resultErr error) {
	resolved, resolveErr := m.resolveCurrentRuntime(ctx, service)
	cached, cacheErr := m.readOpeningState(service)
	if cacheErr != nil && !errors.Is(cacheErr, os.ErrNotExist) && !options.NewLaunch {
		return "", false, cacheErr
	}
	dynamic := resolveErr == nil && resolved.Spec.StartupURL != nil
	if cacheErr == nil && cached.AppPath != "" && (!options.Refresh || !cached.ManagedBootstrap) {
		sameLaunch := cached.LaunchGeneration == launch.Generation || (cached.SchemaVersion == 1 && launch.Generation == service.RuntimeIdentity)
		// Legacy container root paths were saved without any authentication source.
		// A newly declared read-only source can prepare the same applied runtime.
		upgradingSource := cached.SchemaVersion == 1 && dynamic && sameAppliedRuntime(resolved, service)
		if !upgradingSource && (sameLaunch || (!cached.ManagedBootstrap && !options.NewLaunch)) {
			if cached.SchemaVersion == 1 && resolveErr == nil && resolved.Spec.Host != nil && resolved.Spec.Host.OpenScript != "" {
				cached.ManagedBootstrap = true
			}
			if cached.SchemaVersion != serviceOpenSessionSchemaVersion || cached.LaunchGeneration != launch.Generation {
				cached.SchemaVersion = serviceOpenSessionSchemaVersion
				cached.LaunchGeneration = launch.Generation
				if err := m.verifyOpeningLaunch(ctx, service, launch); err != nil {
					return "", false, err
				}
				if err := m.persistOpeningState(service, cached); err != nil {
					return "", false, err
				}
			}
			return cached.AppPath, cached.ManagedBootstrap, nil
		}
	}
	if resolveErr != nil || !sameAppliedRuntime(resolved, service) {
		return "", false, serviceError("SERVICE_OPEN_TARGET_UNAVAILABLE", "The applied entrance cannot be reconstructed from the changed or unavailable template. Restore its template or restart explicitly after reviewing settings.", 409, true, nil)
	}
	spec := resolved.Spec
	// An entrance-only edit cannot replace a fixed deep link of a live instance.
	// New launches are authorized by the lifecycle owner; legacy v1 identities
	// still verify the original path through the frozen digest algorithm.
	if spec.StartupURL == nil && spec.Kind != DeploymentHost && !options.NewLaunch {
		secrets, err := m.serviceSecretDocument(service.ServiceID)
		if err != nil {
			return "", false, err
		}
		verifiedLegacy := matchesFrozenRuntimeIdentity(resolved, secrets, service)
		rule := templateSourceRuntimeDigest(openingRuleDigest(spec), resolved.Template.SourceSHA256)
		if !verifiedLegacy && (cacheErr != nil || cached.OpeningRuleSHA256 != rule) {
			return "", false, serviceError("SERVICE_OPEN_TARGET_UNAVAILABLE", "The applied fixed entrance record is unavailable. Restart explicitly after reviewing settings to apply the current entrance.", 409, true, nil)
		}
	}
	rule := templateSourceRuntimeDigest(openingRuleDigest(spec), resolved.Template.SourceSHA256)
	state := serviceOpenSessionState{SchemaVersion: serviceOpenSessionSchemaVersion, ServiceID: service.ServiceID, RuntimeIdentity: service.RuntimeIdentity, RuntimeSpecSHA256: service.RuntimeSpecSHA256, LaunchGeneration: launch.Generation, OpeningRuleSHA256: rule}
	defer func() {
		if resultErr != nil {
			state.ErrorCode, state.ErrorMessage, _, _ = ErrorDetails(resultErr)
		} else {
			state.AppPath, state.ManagedBootstrap = appPath, bootstrap
		}
		if err := m.verifyOpeningLaunch(ctx, service, launch); err != nil {
			resultErr = err
			return
		}
		if err := m.persistOpeningState(service, state); err != nil && resultErr == nil {
			resultErr = serviceError("SERVICE_OPEN_TARGET_UNAVAILABLE", "The entrance could not be saved privately.", 500, true, nil)
		}
		if resultErr == nil && spec.Kind == DeploymentHost && spec.Host != nil && spec.Host.OpenScript != "" {
			if driver, ok := m.host.(*hostScriptDriver); ok {
				_ = truncatePrivateOutput(filepath.Join(driver.runDirectory(service), "output"), 0)
			}
		}
	}()
	if spec.StartupURL != nil {
		if launch.ReadOutput == nil {
			return "", false, serviceError("OPENING_OUTPUT_UNAVAILABLE", "This launch has no readable startup output.", 409, true, nil)
		}
		raw, err := launch.ReadOutput(ctx)
		if err != nil {
			return "", false, serviceError("OPENING_OUTPUT_UNAVAILABLE", "This launch's output is unavailable. Check logs or restart explicitly to produce a new entrance.", 409, true, nil)
		}
		target, err := templatecontract.ParseStartupURL(bytes.NewReader(raw), *spec.StartupURL)
		if err != nil {
			var e *templatecontract.Error
			if errors.As(err, &e) {
				return "", false, serviceError(e.Code, e.Message, 409, true, nil)
			}
			return "", false, err
		}
		path, err := parseServiceOpeningURL(target, spec.Endpoint, launch.Port)
		return path, true, err
	}
	if spec.Kind == DeploymentHost {
		driver, ok := m.host.(*hostScriptDriver)
		if !ok {
			return "", false, serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The Host entrance is unavailable.", 409, true, nil)
		}
		run, err := driver.readRunState(service)
		if err != nil {
			return "", false, err
		}
		if spec.Host.OpenScript != "" && ((run.OpeningRuleSHA256 != "" && run.OpeningRuleSHA256 != rule) || (run.OpeningRuleSHA256 == "" && !resolved.OpeningMatchesApplied)) {
			return "", false, serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The applied opening hook has changed. Restore its template or restart explicitly.", 409, true, nil)
		}
		path, err := driver.prepareOpening(ctx, service, spec)
		return path, spec.Host.OpenScript != "", err
	}
	appPath = spec.Endpoint.Path
	if appPath == "" {
		appPath = "/"
	}
	if !validServiceOpeningPath(appPath, true) {
		return "", false, serviceError("SERVICE_OPEN_TARGET_INVALID", "The service entrance path is invalid.", 409, true, nil)
	}
	return appPath, false, nil
}

func (m *Manager) verifyOpeningLaunch(ctx context.Context, service *pfregistry.ManagedService, launch serviceOpeningLaunch) error {
	current, _, err := m.serviceAndForward(ctx, service.ServiceID)
	if err != nil || current.RuntimeIdentity != service.RuntimeIdentity || current.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 {
		return serviceError("RESOURCE_PLAN_STALE", "The managed instance changed while preparing its entrance.", 409, true, nil)
	}
	latest, err := m.openingLaunch(ctx, current)
	if err != nil || latest.Generation != launch.Generation {
		return serviceError("RESOURCE_PLAN_STALE", "The application restarted while preparing its entrance.", 409, true, nil)
	}
	return nil
}

// Lifecycle owners call this only after committing a verified successful launch.
// The entrance result has its own failure boundary and cannot fail the lifecycle.
func (m *Manager) prepareSuccessfulOpening(ctx context.Context, service *pfregistry.ManagedService) {
	if service.ObservedState != "running" {
		return
	}
	if launch, err := m.openingLaunch(ctx, service); err == nil {
		_, _, _ = m.prepareServiceOpening(ctx, service, launch, openingPreparation{NewLaunch: true})
	}
}
