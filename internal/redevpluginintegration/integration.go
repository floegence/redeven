package redevpluginintegration

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/pluginmarket"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/connectivity"
	"github.com/floegence/redevplugin/v3/pkg/externalsource"
	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/httpadapter"
	rpobservability "github.com/floegence/redevplugin/v3/pkg/observability"
	"github.com/floegence/redevplugin/v3/pkg/pluginpkg"
	"github.com/floegence/redevplugin/v3/pkg/secrets"
)

type Options struct {
	StateDir             string
	AgentHomeDir         string
	ResolveWorkspacePath workspacePathResolver
	PermissionPolicy     *config.PermissionPolicy
	RuntimePath          string
	ResolveSessionMeta   func(channelID string) (*session.Meta, bool)
	Audit                *auditlog.Store
	Diagnostics          *diagnostics.Store
	Containers           *containers.Adapter
	RuntimeAuthority     *RuntimeProcessAuthority
	PluginMarket         *pluginmarket.Service
	newReleaseModule     func(string) (*host.ReleaseModule, host.PluginReleaseRef, func() error, error)
}

type Integration struct {
	handler          http.Handler
	host             *host.Host
	capabilities     *containersCapabilityAdapter
	runtimeAuthority *RuntimeProcessAuthority
	marketSnapshot   *pluginmarket.Snapshot
	marketService    *pluginmarket.Service
	releaseProvider  *officialReleaseProvider
	marketErr        error
	marketMu         sync.RWMutex
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
	if strings.TrimSpace(opts.AgentHomeDir) == "" {
		opts.AgentHomeDir, err = os.UserHomeDir()
		if err != nil {
			return nil, err
		}
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

	// ReDevPlugin v3 owns the control database and its current-only schema.
	// Redeven supplies the selected state root and must not maintain a second
	// generation or migration protocol around it.
	if err := os.MkdirAll(stateAbs, 0o700); err != nil {
		return nil, err
	}
	root := stateAbs

	var closers []func() error
	closeOnError := func() { _ = closeAll(closers) }
	// Release assets have a short-lived fetch cache. Host-owned external package
	// inspections are configured below and live only under external-inspections.
	releaseStage, err := externalsource.NewStageStore(filepath.Join(root, "release-artifacts"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, releaseStage.Close)
	releaseFetcher, err := externalsource.NewFetcher(externalsource.FetcherOptions{
		Stage: releaseStage, SourceID: "redeven.official-release",
	})
	if err != nil {
		closeOnError()
		return nil, err
	}
	var releaseModule *host.ReleaseModule
	var closeReleaseTrust func() error
	var marketSnapshot *pluginmarket.Snapshot
	var releaseProvider *officialReleaseProvider
	var marketErr error
	if opts.newReleaseModule != nil {
		releaseModule, _, closeReleaseTrust, err = opts.newReleaseModule(filepath.Join(root, "trust"))
	} else if opts.PluginMarket != nil {
		releaseModule, releaseProvider, err = newOfficialReleaseModulePending(releaseFetcher)
		if err != nil {
			marketErr = err
		}
		var snapshot pluginmarket.Snapshot
		if marketErr == nil {
			snapshot, marketErr = opts.PluginMarket.Snapshot(ctx)
		}
		if marketErr == nil {
			var release pluginmarket.LatestRelease
			release, marketErr = snapshot.LatestRelease(officialContainersPluginID, officialReleaseChannel)
			if marketErr == nil {
				if releaseProvider != nil {
					marketErr = releaseProvider.setRelease(release)
				}
				if marketErr == nil {
					releaseProvider, _ = releaseModule.ReleaseArtifactResolver.(*officialReleaseProvider)
				}
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

	observabilityStore, err := rpobservability.NewSQLiteStore(ctx, filepath.Join(root, "observability.sqlite"))
	if err != nil {
		closeOnError()
		return nil, err
	}
	closers = append(closers, observabilityStore.Close)
	observability := newObservabilityAdapter(observabilityStore, opts.Audit, opts.Diagnostics)

	secretStore, err := secrets.NewSQLiteStore(ctx, filepath.Join(root, "secrets.sqlite"))
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
	sessions, err := newSessionAdapter(opts.ResolveSessionMeta, opts.PermissionPolicy)
	if err != nil {
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	ioModule, err := newIOModule(opts.AgentHomeDir, sessions.resolver.cache, opts.ResolveWorkspacePath)
	if err != nil {
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	capabilities, capabilityAdapter, err := newContainersCapabilityRegistry(opts.Containers, observability)
	if err != nil {
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}
	connectivityBroker := connectivity.NewMemoryBroker()
	networkExecutor := connectivity.NewExecutor(connectivity.ExecutorOptions{})
	runtimeModule, err := newOfficialRuntimeModule(ctx, runtimeModuleDependencies{
		Path:          opts.RuntimePath,
		ExecutionRoot: filepath.Join(root, "runtime-exec"),
	})
	if err != nil {
		_ = capabilityAdapter.Close()
		_ = assetStore.Close()
		closeOnError()
		return nil, err
	}

	h, err := host.Open(ctx, host.Config{
		StateRoot: root,
		Core: host.CoreAdapters{
			Policy:               sessions,
			Authorization:        sessions,
			PackageTrustVerifier: packageTrustVerifier,
			Audit:                observability,
			SecurityAudit:        observabilityStore,
			Diagnostics:          observability,
			Assets:               assetStore,
		},
		Release: releaseModule,
		Runtime: runtimeModule,
		IO:      ioModule,
		Connectivity: &host.ConnectivityModule{
			Broker:          connectivityBroker,
			NetworkExecutor: networkExecutor,
		},
		Secrets:    &host.SecretsModule{Store: secretStore},
		Capability: &host.CapabilityModule{Registry: capabilities},
		ExternalPackage: &host.ExternalPackageModule{
			SignatureAssessor: packageTrustVerifier,
			SourceID:          "redeven.external-package",
			GitHub:            externalsource.GitHubRESTReleaseClientOptions{UserAgent: "Redeven"},
		},
	})
	if err != nil {
		var configErr *host.HostConfigError
		if runtimeModule != nil && errors.As(err, &configErr) && configErr.RuntimeModuleDisposition() == host.RuntimeModuleCallerOwned {
			_, _ = runtimeModule.Close(context.Background())
		}
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
		runtimeAuthority: opts.RuntimeAuthority,
		marketSnapshot:   marketSnapshot,
		marketService:    opts.PluginMarket,
		releaseProvider:  releaseProvider,
		marketErr:        marketErr,
		closers:          closers,
	}
	return integration, nil
}

func (i *Integration) MarketSnapshot() (pluginmarket.Snapshot, bool) {
	if i == nil {
		return pluginmarket.Snapshot{}, false
	}
	if i.marketService != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if snapshot, err := i.refreshMarket(ctx); err == nil {
			return snapshot, true
		}
	}
	i.marketMu.RLock()
	defer i.marketMu.RUnlock()
	if i.marketSnapshot == nil {
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

func (i *Integration) MarketIcon(ctx context.Context, pluginID, digest string) (pluginmarket.IconAsset, error) {
	if i == nil || i.marketService == nil {
		return pluginmarket.IconAsset{}, pluginmarket.ErrUnavailable
	}
	snapshot, err := i.refreshMarket(ctx)
	if err != nil {
		i.marketMu.RLock()
		if i.marketSnapshot == nil {
			i.marketMu.RUnlock()
			return pluginmarket.IconAsset{}, err
		}
		snapshot = i.marketSnapshot.Clone()
		i.marketMu.RUnlock()
	}
	for _, plugin := range snapshot.Plugins {
		icon := plugin.Presentation.Icon
		if plugin.PluginID == pluginID && icon != nil && icon.SHA256 == digest {
			return i.marketService.Icon(ctx, pluginID, *icon)
		}
	}
	return pluginmarket.IconAsset{}, pluginmarket.ErrReleaseMissing
}

func (i *Integration) MarketError() error {
	if i == nil {
		return pluginmarket.ErrUnavailable
	}
	i.marketMu.RLock()
	defer i.marketMu.RUnlock()
	return i.marketErr
}

func (i *Integration) refreshMarket(ctx context.Context) (pluginmarket.Snapshot, error) {
	if i == nil || i.marketService == nil {
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	}
	snapshot, err := i.marketService.Snapshot(ctx)
	if err != nil {
		i.marketMu.Lock()
		i.marketErr = err
		i.marketMu.Unlock()
		return pluginmarket.Snapshot{}, err
	}
	if i.releaseProvider != nil {
		release, releaseErr := snapshot.LatestRelease(officialContainersPluginID, officialReleaseChannel)
		if releaseErr != nil {
			i.marketMu.Lock()
			i.marketErr = releaseErr
			i.marketMu.Unlock()
			return pluginmarket.Snapshot{}, releaseErr
		}
		if releaseErr = i.releaseProvider.setRelease(release); releaseErr != nil {
			i.marketMu.Lock()
			i.marketErr = releaseErr
			i.marketMu.Unlock()
			return pluginmarket.Snapshot{}, releaseErr
		}
	}
	frozen := snapshot.Clone()
	i.marketMu.Lock()
	i.marketSnapshot = &frozen
	i.marketErr = nil
	i.marketMu.Unlock()
	return frozen, nil
}

func (i *Integration) Handler() http.Handler {
	return i.handler
}

func (i *Integration) PluginProcessGeneration() string {
	if i == nil || !i.runtimeAuthority.valid() {
		return ""
	}
	return i.runtimeAuthority.ProcessGeneration()
}

func (i *Integration) BindActiveGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.host == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	_, err := validatePluginSessionGeneration(generation)
	return err
}

func (i *Integration) RecordCloseContinuation(ctx context.Context, generation PluginSessionGeneration) error {
	return i.BindActiveGeneration(ctx, generation)
}

func (i *Integration) RecordTerminalIntent(ctx context.Context, generation PluginSessionGeneration) error {
	return i.BindActiveGeneration(ctx, generation)
}

func (i *Integration) DiscardFinalizedGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	return i.BindActiveGeneration(ctx, generation)
}

// MaintainTerminalGeneration delegates the entire durable teardown lifecycle
// to Host. Redeven retains only its in-process connection generation.
func (i *Integration) MaintainTerminalGeneration(ctx context.Context, generation PluginSessionGeneration) error {
	if i == nil || i.host == nil {
		return errors.New("plugin session lifecycle is unavailable")
	}
	if _, err := validatePluginSessionGeneration(generation); err != nil {
		return err
	}
	result, err := i.host.CloseAuthenticatedSessionScope(ctx, host.CloseAuthenticatedSessionScopeRequest{
		Session: generation.Session,
	})
	if err != nil {
		return err
	}
	if result.Status == host.SessionScopeTeardownAbsent {
		return nil
	}
	if result.Status != host.SessionScopeTeardownComplete {
		result, err = i.host.ResumeClosedSessionScopeTeardown(ctx, host.ResumeClosedSessionScopeTeardownRequest{
			Session: generation.Session, Identity: result.Identity,
		})
		if err != nil {
			return err
		}
	}
	if result.Status == host.SessionScopeTeardownAbsent {
		return nil
	}
	if result.Status != host.SessionScopeTeardownComplete {
		return host.ErrSessionMaintenanceState
	}
	finalized, err := i.host.FinalizeClosedSessionScope(ctx, host.FinalizeClosedSessionScopeRequest{
		Session:  generation.Session,
		Identity: result.Identity,
	})
	if err != nil {
		return err
	}
	if finalized.Status != host.SessionScopeFinalized && finalized.Status != host.SessionScopeFinalizationAbsent {
		return host.ErrSessionMaintenanceState
	}
	return nil
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
