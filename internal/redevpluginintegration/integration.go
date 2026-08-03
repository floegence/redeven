package redevpluginintegration

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/pluginmarket"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/pkg/bridge"
	"github.com/floegence/redevplugin/pkg/connectivity"
	"github.com/floegence/redevplugin/pkg/externalsource"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/httpadapter"
	"github.com/floegence/redevplugin/pkg/installstage"
	rpobservability "github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/operation"
	"github.com/floegence/redevplugin/pkg/plugindata"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
	"github.com/floegence/redevplugin/pkg/secrets"
	"github.com/floegence/redevplugin/pkg/security"
	"github.com/floegence/redevplugin/pkg/sessionscope"
	"github.com/floegence/redevplugin/pkg/stream"
)

type Options struct {
	StateDir           string
	PermissionPolicy   *config.PermissionPolicy
	RuntimePath        string
	ResolveSessionMeta func(channelID string) (*session.Meta, bool)
	Audit              *auditlog.Store
	Diagnostics        *diagnostics.Store
	Containers         *containers.Adapter
	RuntimeAuthority   *RuntimeProcessAuthority
	PluginMarket       *pluginmarket.Service
	releaseTrustNow    func() time.Time
	newReleaseModule   func(string) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error)
	newExternalFetcher func(*externalsource.StageStore) (host.ExternalPackageFetcher, error)
	closeExternalStage func(*externalsource.StageStore) error
}

type Integration struct {
	handler          http.Handler
	host             *host.Host
	capabilities     *containersCapabilityAdapter
	sessionLifecycle *sessionLifecycleAdapter
	marketSnapshot   *pluginmarket.Snapshot
	marketService    *pluginmarket.Service
	marketErr        error
	closers          []func() error
}

func New(ctx context.Context, opts Options) (*Integration, error) {
	if ctx == nil {
		return nil, errors.New("context is required")
	}
	stateDir := strings.TrimSpace(opts.StateDir)
	if stateDir == "" {
		return nil, errors.New("missing StateDir")
	}
	stateAbs, err := filepath.Abs(stateDir)
	if err != nil {
		return nil, err
	}
	if opts.ResolveSessionMeta == nil {
		return nil, errors.New("missing ResolveSessionMeta")
	}
	if opts.PermissionPolicy == nil {
		return nil, errors.New("missing permission policy")
	}
	if err := opts.PermissionPolicy.Validate(); err != nil {
		return nil, err
	}
	if err := opts.Containers.Validate(); err != nil {
		return nil, err
	}
	packageTrustVerifier, err := newPackageTrustVerifier()
	if err != nil {
		return nil, err
	}

	generation, err := PrepareOwnerScopeGeneration(ctx, stateAbs)
	if err != nil {
		return nil, err
	}
	root := generation.Path
	dbRoot := filepath.Join(root, "db")
	if err := os.MkdirAll(dbRoot, 0o700); err != nil {
		return nil, err
	}

	var closers []func() error
	closeOnError := func() { _ = closeAll(closers) }
	externalStage, err := externalsource.NewStageStore(filepath.Join(root, "external-package-stage"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	// The Host owns pending inspection cleanup, so the shared stage closes only
	// after Host.Close has revoked and removed all process-local inspections.
	externalStageCloser := externalStage.Close
	if opts.closeExternalStage != nil {
		externalStageCloser = func() error { return opts.closeExternalStage(externalStage) }
	}
	closers = append(closers, externalStageCloser)
	externalFetcher, err := externalsource.NewFetcher(externalsource.FetcherOptions{
		Stage:    externalStage,
		SourceID: "redeven.external-package",
	})
	if err != nil {
		closeOnError()
		return nil, err
	}
	var externalPackageFetcher host.ExternalPackageFetcher = externalFetcher
	if opts.newExternalFetcher != nil {
		externalPackageFetcher, err = opts.newExternalFetcher(externalStage)
		if err != nil {
			closeOnError()
			return nil, err
		}
	}
	externalGitHubResolver, err := externalsource.NewGitHubRESTReleaseResolver(
		externalsource.GitHubRESTReleaseClientOptions{
			Token:     "",
			UserAgent: "Redeven",
		},
		externalFetcher,
	)
	if err != nil {
		closeOnError()
		return nil, err
	}
	var releaseModule *host.ReleaseModule
	var closeReleaseTrust func() error
	var marketSnapshot *pluginmarket.Snapshot
	var marketErr error
	if opts.newReleaseModule != nil {
		releaseModule, _, closeReleaseTrust, err = opts.newReleaseModule(filepath.Join(root, "trust"))
	} else if opts.PluginMarket != nil {
		var snapshot pluginmarket.Snapshot
		snapshot, marketErr = opts.PluginMarket.Snapshot(ctx)
		if marketErr == nil {
			var release pluginmarket.LatestRelease
			release, marketErr = snapshot.LatestRelease(officialContainersPluginID, officialReleaseChannel)
			if marketErr == nil {
				now := time.Now
				if opts.releaseTrustNow != nil {
					now = opts.releaseTrustNow
				}
				releaseModule, _, closeReleaseTrust, marketErr = newOfficialReleaseModuleWithClock(
					ctx, filepath.Join(root, "trust"), release, externalFetcher, now,
				)
			}
			if marketErr == nil {
				frozen := snapshot.Clone()
				marketSnapshot = &frozen
			}
		}
	}
	if err != nil {
		closeOnError()
		return nil, err
	}
	if closeReleaseTrust != nil {
		closers = append(closers, closeReleaseTrust)
	}

	registryStore, err := registry.NewSQLiteStore(ctx, filepath.Join(dbRoot, "registry.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, registryStore.Close)

	sessionScopeStore, err := sessionscope.NewSQLiteStore(ctx, filepath.Join(dbRoot, "session_scopes.sqlite"), sessionscope.StoreOptions{})
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, sessionScopeStore.Close)
	sessionScopes, err := sessionscope.NewCoordinator(sessionScopeStore)
	if err != nil {
		closeOnError()
		return nil, err
	}
	sessionLifecycle, err := newSessionLifecycleAdapter(filepath.Join(dbRoot, "closed_sessions.json"), sessionLifecycleStartupAuthority{
		runtime: opts.RuntimeAuthority, stateGenerationID: generation.Status.FreshGenerationID,
	})
	if err != nil {
		closeOnError()
		return nil, err
	}

	installStages, err := installstage.NewSQLiteStore(ctx, filepath.Join(dbRoot, "install_stage.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, installStages.Close)

	observabilityStore, err := rpobservability.NewSQLiteStore(ctx, filepath.Join(dbRoot, "observability.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, observabilityStore.Close)
	observability := newObservabilityAdapter(observabilityStore, opts.Audit, opts.Diagnostics)

	operationStore, err := operation.NewSQLiteStore(ctx, filepath.Join(dbRoot, "operations.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, operationStore.Close)

	confirmationIntents, err := security.NewSQLiteConfirmationIntentStore(ctx, filepath.Join(dbRoot, "confirmation_intents.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, confirmationIntents.Close)

	streamStore, err := stream.NewSQLiteStore(ctx, filepath.Join(dbRoot, "streams.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, streamStore.CloseDatabase)

	secretStore, err := secrets.NewSQLiteStore(ctx, filepath.Join(dbRoot, "secrets.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, secretStore.Close)

	assetStore, err := pluginpkg.NewFileAssetStore(filepath.Join(root, "assets"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	pluginData, err := plugindata.Open(ctx, filepath.Join(root, "storage"), registryStore)
	if err != nil {
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	sessions, err := newSessionAdapter(opts.ResolveSessionMeta, opts.PermissionPolicy)
	if err != nil {
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	capabilities, capabilityAdapter, err := newContainersCapabilityRegistry(opts.Containers, observability)
	if err != nil {
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	surfaceTokens := bridge.NewSurfaceTokenService(nil, bridge.SurfaceTokenOptions{})
	connectivityBroker := connectivity.NewMemoryBroker()
	networkExecutor := connectivity.NewExecutor(connectivity.ExecutorOptions{})
	runtimeModule, err := newOfficialRuntimeModule(ctx, runtimeModuleDependencies{
		Path:          opts.RuntimePath,
		ExecutionRoot: filepath.Join(root, "runtime-exec"),
	})
	if err != nil {
		_ = capabilityAdapter.Close()
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	h, err := host.Open(ctx, host.Config{
		Core: host.CoreAdapters{
			Policy:               sessions,
			Authorization:        sessions,
			PackageTrustVerifier: packageTrustVerifier,
			Registry:             registryStore,
			Audit:                observability,
			SecurityAudit:        observabilityStore,
			Diagnostics:          observability,
			SurfaceTokens:        surfaceTokens,
			PluginData:           pluginData,
			Assets:               assetStore,
			InstallStages:        installStages,
			Operations:           operationStore,
			ConfirmationIntents:  confirmationIntents,
			Streams:              streamStore,
			SessionLifecycle:     sessionLifecycle,
			SessionMaintenance:   sessionLifecycle,
			SessionScopes:        sessionScopes,
		},
		Release: releaseModule,
		Runtime: runtimeModule,
		Connectivity: &host.ConnectivityModule{
			Broker:          connectivityBroker,
			NetworkExecutor: networkExecutor,
		},
		Secrets:    &host.SecretsModule{Store: secretStore},
		Capability: &host.CapabilityModule{Registry: capabilities},
		ExternalPackage: &host.ExternalPackageModule{
			StageStore:        externalStage,
			PackageFetcher:    externalPackageFetcher,
			GitHubResolver:    externalGitHubResolver,
			SignatureAssessor: packageTrustVerifier,
		},
	})
	if err != nil {
		var configErr *host.HostConfigError
		if runtimeModule != nil && errors.As(err, &configErr) && configErr.RuntimeModuleDisposition() == host.RuntimeModuleCallerOwned {
			_, _ = runtimeModule.Close(context.Background())
		}
		_ = pluginData.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	handler, err := httpadapter.NewHandler(httpadapter.Dependencies{Host: h, Guard: sessions})
	if err != nil {
		_ = h.Close()
		closeOnError()
		return nil, err
	}
	integration := &Integration{
		handler:          handler,
		host:             h,
		capabilities:     capabilityAdapter,
		sessionLifecycle: sessionLifecycle,
		marketSnapshot:   marketSnapshot,
		marketService:    opts.PluginMarket,
		marketErr:        marketErr,
		closers:          closers,
	}
	return integration, nil
}

func (i *Integration) MarketSnapshot() (pluginmarket.Snapshot, bool) {
	if i == nil || i.marketSnapshot == nil {
		return pluginmarket.Snapshot{}, false
	}
	return i.marketSnapshot.Clone(), true
}

func (i *Integration) MarketDetail(ctx context.Context, pluginID string) (pluginmarket.PluginDetail, int64, error) {
	if i == nil || i.marketService == nil {
		return pluginmarket.PluginDetail{}, -1, pluginmarket.ErrUnavailable
	}
	return i.marketService.Detail(ctx, pluginID)
}

func (i *Integration) MarketError() error {
	if i == nil {
		return pluginmarket.ErrUnavailable
	}
	return i.marketErr
}

func (i *Integration) Handler() http.Handler {
	return i.handler
}

func (i *Integration) PluginProcessGeneration() string {
	if i == nil || i.sessionLifecycle == nil {
		return ""
	}
	if !i.sessionLifecycle.startupAuthority.runtime.valid() {
		return ""
	}
	return i.sessionLifecycle.startupAuthority.runtime.processGeneration
}

func (i *Integration) BindActiveGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.sessionLifecycle == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	return i.sessionLifecycle.bindActiveGeneration(ctx, generation)
}

func (i *Integration) RecordCloseContinuation(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.sessionLifecycle == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	return i.sessionLifecycle.recordCloseContinuation(ctx, generation)
}

func (i *Integration) RecordTerminalIntent(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.sessionLifecycle == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	return i.sessionLifecycle.recordTerminalIntent(ctx, generation)
}

func (i *Integration) DiscardFinalizedGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.sessionLifecycle == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	return i.sessionLifecycle.discardFinalizedGeneration(ctx, generation)
}

// MaintainTerminalGeneration keeps the opaque teardown identity inside the
// integration boundary while converging one exact terminal generation.
func (i *Integration) MaintainTerminalGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.host == nil || i.sessionLifecycle == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	if _, err := validatePluginSessionGeneration(generation); err != nil {
		return err
	}
	record, err := i.sessionLifecycle.InspectSessionScopeMaintenance(ctx, host.InspectSessionScopeMaintenanceRequest{
		Session: generation.Session,
	})
	if err != nil {
		return err
	}
	if !record.TerminalEvidence {
		return host.ErrSessionMaintenanceState
	}
	if record.Phase == "" {
		closed, err := i.host.CloseAuthenticatedSessionScope(ctx, host.CloseAuthenticatedSessionScopeRequest{
			Session: generation.Session,
		})
		if err != nil {
			return err
		}
		if closed.Status == host.SessionScopeTeardownAbsent {
			return host.ErrSessionMaintenanceState
		}
		record, err = i.sessionLifecycle.InspectSessionScopeMaintenance(ctx, host.InspectSessionScopeMaintenanceRequest{
			Session: generation.Session,
		})
		if err != nil {
			return err
		}
	}
	resumed, err := i.host.ResumeClosedSessionScopeTeardown(ctx, host.ResumeClosedSessionScopeTeardownRequest{
		Session:  generation.Session,
		Identity: record.Identity,
	})
	if err != nil {
		return err
	}
	if resumed.Status != host.SessionScopeTeardownComplete {
		return nil
	}
	finalized, err := i.host.FinalizeClosedSessionScope(ctx, host.FinalizeClosedSessionScopeRequest{
		Session:  generation.Session,
		Identity: record.Identity,
	})
	if err != nil {
		return err
	}
	if finalized.Status == host.SessionScopeFinalizationAbsent {
		return host.ErrSessionMaintenanceState
	}
	return i.sessionLifecycle.discardFinalizedGeneration(ctx, generation)
}

func (i *Integration) Close() error {
	if i == nil {
		return nil
	}
	var out error
	if i.capabilities != nil {
		out = errors.Join(out, i.capabilities.Close())
	}
	if i.host != nil {
		out = errors.Join(out, i.host.Close())
	}
	out = errors.Join(out, closeAll(i.closers))
	return out
}

func closeAll(closers []func() error) error {
	var out error
	for index := len(closers) - 1; index >= 0; index-- {
		if closers[index] == nil {
			continue
		}
		out = errors.Join(out, closers[index]())
	}
	return out
}
