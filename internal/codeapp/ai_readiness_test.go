package codeapp

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func TestAIReadinessControllerDrainsGenerationBeforeReplacement(t *testing.T) {
	first := new(ai.Service)
	second := new(ai.Service)
	secondCreateStarted := make(chan struct{})
	allowSecondCreate := make(chan struct{})
	var createCount atomic.Int32
	create := func(context.Context, ai.Options) (*ai.Service, error) {
		if createCount.Add(1) == 1 {
			return first, nil
		}
		close(secondCreateStarted)
		<-allowSecondCreate
		return second, nil
	}
	var closeMu sync.Mutex
	closed := map[*ai.Service]int{}
	controller := newAIReadinessController(context.Background(), ai.Options{}, create, func(service *ai.Service) error {
		closeMu.Lock()
		closed[service]++
		closeMu.Unlock()
		return nil
	})
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)

	service, leaseCtx, generation, release, err := controller.AcquireAIService(context.Background())
	if err != nil || service != first || generation != 1 || release == nil {
		t.Fatalf("first lease = (%p, %d, %v), want first generation", service, generation, err)
	}
	if err := controller.RetryAIReadiness(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	select {
	case <-leaseCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("generation context was not cancelled during drain")
	}
	if _, _, _, _, err := controller.AcquireAIService(context.Background()); !errors.Is(err, appserver.ErrAIServiceUnavailable) {
		t.Fatalf("acquire while draining error = %v", err)
	}
	assertAIServiceCloseCount(t, &closeMu, closed, first, 0)

	release()
	release()
	select {
	case <-secondCreateStarted:
	case <-time.After(time.Second):
		t.Fatal("replacement did not start after the old lease drained")
	}
	assertAIServiceCloseCount(t, &closeMu, closed, first, 1)
	close(allowSecondCreate)
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)

	service, _, generation, release, err = controller.AcquireAIService(context.Background())
	if err != nil || service != second || generation != 2 {
		t.Fatalf("replacement lease = (%p, %d, %v), want second generation", service, generation, err)
	}
	release()
	if err := controller.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	assertAIServiceCloseCount(t, &closeMu, closed, first, 1)
	assertAIServiceCloseCount(t, &closeMu, closed, second, 1)
}

func TestAIReadinessControllerSerializesAttemptsAndSanitizesFailures(t *testing.T) {
	allowCreate := make(chan struct{})
	var calls atomic.Int32
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		call := calls.Add(1)
		if call == 1 {
			<-allowCreate
			return nil, &ai.FloretStoreStartupError{
				Class: ai.FloretStoreStartupTemporarilyBlocked, Retryable: true, SafeToRetry: true,
			}
		}
		return nil, errors.New("secret path and raw startup detail")
	}, nil)
	controller.maxStartupRetries = 0
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessInspecting)
	if err := controller.RetryAIReadiness(); !errors.Is(err, appserver.ErrAIRetryInProgress) {
		t.Fatalf("concurrent retry error = %v", err)
	}
	close(allowCreate)
	waitForAIReadinessState(t, controller, appserver.AIReadinessBlocked)
	snapshot := controller.AIReadiness()
	if snapshot.ReasonCode != string(ai.FloretStoreStartupTemporarilyBlocked) || !snapshot.Retryable || !snapshot.SafeToRetry {
		t.Fatalf("typed failure snapshot = %#v", snapshot)
	}

	if err := controller.RetryAIReadiness(); err != nil {
		t.Fatalf("retry generic failure: %v", err)
	}
	waitForAIReadinessState(t, controller, appserver.AIReadinessBlocked)
	snapshot = controller.AIReadiness()
	if snapshot.ReasonCode != "ai_service_startup_error" || snapshot.Retryable || snapshot.SafeToRetry || snapshot.Committed || snapshot.RolledBack {
		t.Fatalf("generic failure snapshot = %#v", snapshot)
	}
	_ = controller.Close()
}

func TestAIReadinessControllerAutomaticallyRecoversTransientStoreFailure(t *testing.T) {
	var calls atomic.Int32
	allowFirstAttempt := make(chan struct{})
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		call := calls.Add(1)
		if call == 1 {
			<-allowFirstAttempt
		}
		if call < 3 {
			return nil, &ai.FloretStoreStartupError{
				Class: ai.FloretStoreStartupTemporarilyBlocked, Retryable: true, SafeToRetry: true,
			}
		}
		return new(ai.Service), nil
	}, nil)
	controller.startupRetryDelay = func(int) time.Duration { return 20 * time.Millisecond }
	controller.maxStartupRetries = 3
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessInspecting)
	inspecting := controller.AIReadiness()
	if inspecting.TraceID == "" || inspecting.StartupPhase != string(ai.FloretStoreStartupInspecting) {
		t.Fatalf("inspecting diagnostics = %#v, want trace and startup phase", inspecting)
	}
	close(allowFirstAttempt)
	waitForAIReadinessState(t, controller, appserver.AIReadinessRecovering)
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	if got := calls.Load(); got != 3 {
		t.Fatalf("startup attempts = %d, want 3", got)
	}
	if err := controller.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

func TestAIReadinessControllerBoundsAndCancelsTransientRecovery(t *testing.T) {
	t.Run("authority corruption is never retried", func(t *testing.T) {
		var calls atomic.Int32
		controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
			calls.Add(1)
			return nil, &ai.FloretStoreStartupError{
				Class: ai.FloretStoreStartupIntegrityError, Retryable: false, SafeToRetry: false,
			}
		}, nil)
		controller.startupRetryDelay = func(int) time.Duration { return 0 }
		controller.Start()
		waitForAIReadinessState(t, controller, appserver.AIReadinessBlocked)
		if got := calls.Load(); got != 1 {
			t.Fatalf("authority corruption startup attempts = %d, want 1", got)
		}
		snapshot := controller.AIReadiness()
		if snapshot.ReasonCode != string(ai.FloretStoreStartupIntegrityError) || snapshot.Retryable || snapshot.SafeToRetry {
			t.Fatalf("authority corruption snapshot = %#v", snapshot)
		}
		_ = controller.Close()
	})

	t.Run("retry window", func(t *testing.T) {
		var calls atomic.Int32
		controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
			calls.Add(1)
			return nil, &ai.FloretStoreStartupError{
				Class: ai.FloretStoreStartupTemporarilyBlocked, Retryable: true, SafeToRetry: true,
			}
		}, nil)
		controller.startupRetryDelay = func(int) time.Duration { return 0 }
		controller.maxStartupRetries = 2
		controller.Start()
		waitForAIReadinessState(t, controller, appserver.AIReadinessBlocked)
		if got := calls.Load(); got != 3 {
			t.Fatalf("startup attempts = %d, want initial plus two retries", got)
		}
		_ = controller.Close()
	})

	t.Run("parent cancellation", func(t *testing.T) {
		parent, cancel := context.WithCancel(context.Background())
		var calls atomic.Int32
		controller := newAIReadinessController(parent, ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
			calls.Add(1)
			return nil, &ai.FloretStoreStartupError{
				Class: ai.FloretStoreStartupTemporarilyBlocked, Retryable: true, SafeToRetry: true,
			}
		}, nil)
		controller.startupRetryDelay = func(int) time.Duration { return time.Hour }
		controller.Start()
		waitForAIReadinessState(t, controller, appserver.AIReadinessRecovering)
		cancel()
		select {
		case <-controller.closeDone:
		case <-time.After(time.Second):
			t.Fatal("controller did not cancel recovery")
		}
		if got := calls.Load(); got != 1 {
			t.Fatalf("startup attempts after cancellation = %d, want 1", got)
		}
	})
}

func TestAIReadinessControllerClosesLateStartupResult(t *testing.T) {
	lateService := new(ai.Service)
	createStarted := make(chan struct{})
	allowCreate := make(chan struct{})
	closed := make(chan struct{}, 1)
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		close(createStarted)
		<-allowCreate
		return lateService, nil
	}, func(service *ai.Service) error {
		if service == lateService {
			closed <- struct{}{}
		}
		return nil
	})
	controller.Start()
	<-createStarted
	closeDone := make(chan struct{})
	go func() {
		_ = controller.Close()
		close(closeDone)
	}()
	close(allowCreate)
	select {
	case <-closeDone:
	case <-time.After(time.Second):
		t.Fatal("close did not wait for late startup")
	}
	select {
	case <-closed:
	default:
		t.Fatal("late startup service was not closed")
	}
	if got := controller.AIReadiness().State; got != appserver.AIReadinessUnavailable {
		t.Fatalf("state after close = %q", got)
	}
}

func TestAIReadinessControllerPublishesObservedMaintenancePhases(t *testing.T) {
	allowInspect := make(chan struct{})
	allowVerify := make(chan struct{})
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(_ context.Context, opts ai.Options) (*ai.Service, error) {
		opts.StoreStartupProgress(ai.FloretStoreStartupInspecting)
		<-allowInspect
		opts.StoreStartupProgress(ai.FloretStoreStartupVerifying)
		<-allowVerify
		return new(ai.Service), nil
	}, func(*ai.Service) error { return nil })
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessInspecting)
	close(allowInspect)
	waitForAIReadinessState(t, controller, appserver.AIReadinessVerifying)
	close(allowVerify)
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	_ = controller.Close()
}

func TestAIReadinessControllerKeepsDegradedGenerationAcquirableAndRetryOnlyRechecks(t *testing.T) {
	service := new(ai.Service)
	var creates atomic.Int32
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		creates.Add(1)
		return service, nil
	}, func(*ai.Service) error { return nil })
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	controller.mu.Lock()
	controller.snapshot = aiReadinessSnapshotForIssueCount(2)
	generation := controller.current
	controller.mu.Unlock()

	got, _, gotGeneration, release, err := controller.AcquireAIService(context.Background())
	if err != nil || got != service || gotGeneration != generation.id {
		t.Fatalf("degraded acquire = (%p, %d, %v)", got, gotGeneration, err)
	}
	release()
	if err := controller.RetryAIReadiness(); err != nil {
		t.Fatalf("degraded retry: %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		controller.mu.Lock()
		running := controller.running
		current := controller.current
		controller.mu.Unlock()
		if !running {
			if current != generation || creates.Load() != 1 {
				t.Fatalf("degraded retry replaced generation: current=%p original=%p creates=%d", current, generation, creates.Load())
			}
			if snapshot := controller.AIReadiness(); snapshot.State != appserver.AIReadinessDegraded || snapshot.IssueCount != 2 {
				t.Fatalf("failed observational recheck changed snapshot: %#v", snapshot)
			}
			_ = controller.Close()
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("degraded recheck did not settle")
}

func TestAIReadinessControllerDegradedRecheckHoldsGenerationLeaseUntilItExits(t *testing.T) {
	service := new(ai.Service)
	recheckStarted := make(chan struct{})
	allowRecheck := make(chan struct{})
	serviceClosed := make(chan struct{}, 1)
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		return service, nil
	}, func(*ai.Service) error {
		serviceClosed <- struct{}{}
		return nil
	})
	controller.reconcile = func(context.Context, *ai.Service) (int, error) {
		close(recheckStarted)
		<-allowRecheck
		return 1, nil
	}
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	controller.mu.Lock()
	controller.snapshot = aiReadinessSnapshotForIssueCount(1)
	controller.mu.Unlock()

	if err := controller.RetryAIReadiness(); err != nil {
		t.Fatalf("degraded retry: %v", err)
	}
	<-recheckStarted
	closeDone := make(chan struct{})
	go func() {
		_ = controller.Close()
		close(closeDone)
	}()
	select {
	case <-serviceClosed:
		t.Fatal("service closed while degraded reconciliation still held its generation lease")
	case <-time.After(20 * time.Millisecond):
	}
	close(allowRecheck)
	select {
	case <-closeDone:
	case <-time.After(time.Second):
		t.Fatal("controller close did not finish after degraded reconciliation released its lease")
	}
	select {
	case <-serviceClosed:
	default:
		t.Fatal("service was not closed after degraded reconciliation exited")
	}
}

func TestAIReadinessControllerFailsClosedWhenGenerationCloseFails(t *testing.T) {
	service := new(ai.Service)
	closeErr := errors.New("close failed")
	var creates atomic.Int32
	controller := newAIReadinessController(context.Background(), ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		creates.Add(1)
		return service, nil
	}, func(*ai.Service) error { return closeErr })
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	if err := controller.RetryAIReadiness(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	waitForAIReadinessState(t, controller, appserver.AIReadinessBlocked)
	if got := creates.Load(); got != 1 {
		t.Fatalf("service create count = %d, want 1", got)
	}
	if err := controller.RetryAIReadiness(); !errors.Is(err, appserver.ErrAIServiceUnavailable) {
		t.Fatalf("retry after close failure = %v", err)
	}
	if err := controller.Close(); !errors.Is(err, closeErr) {
		t.Fatalf("controller close error = %v, want %v", err, closeErr)
	}
}

func TestAIReadinessControllerUsesLatestStartupOptions(t *testing.T) {
	seen := make(chan ai.Options, 2)
	controller := newAIReadinessController(context.Background(), ai.Options{AgentHomeDir: "/old", Shell: "/bin/old"}, func(_ context.Context, opts ai.Options) (*ai.Service, error) {
		seen <- opts
		return new(ai.Service), nil
	}, func(*ai.Service) error { return nil })
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	<-seen

	nextConfig := &config.AIConfig{PermissionType: config.AIPermissionReadonly}
	controller.UpdateAIServiceStartupOptions(appserver.AIServiceStartupOptions{
		Config: nextConfig, AgentHomeDir: "/new", Shell: "/bin/new",
	})
	if err := controller.RetryAIReadiness(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	got := <-seen
	if got.Config != nextConfig || got.AgentHomeDir != "/new" || got.Shell != "/bin/new" {
		t.Fatalf("replacement options = %#v", got)
	}
	_ = controller.Close()
}

func TestAIReadinessControllerRejectsStartupWithStaleFilesystemScopeRevision(t *testing.T) {
	home := t.TempDir()
	custom := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatalf("NewDefaultRegistry: %v", err)
	}
	first := new(ai.Service)
	second := new(ai.Service)
	firstStarted := make(chan struct{})
	allowFirst := make(chan struct{})
	var creates atomic.Int32
	var closedFirst atomic.Int32
	controller := newAIReadinessController(context.Background(), ai.Options{
		AgentHomeDir: home, FilesystemScope: scope,
	}, func(context.Context, ai.Options) (*ai.Service, error) {
		if creates.Add(1) == 1 {
			close(firstStarted)
			<-allowFirst
			return first, nil
		}
		return second, nil
	}, func(service *ai.Service) error {
		if service == first {
			closedFirst.Add(1)
		}
		return nil
	})
	controller.Start()
	<-firstStarted

	if err := scope.UpdateFromConfig(&config.Config{
		AgentHomeDir: home,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "custom",
			Roots: []config.FilesystemRootPolicy{{
				ID: "custom", Label: "Custom", Path: custom, Kind: config.FilesystemRootCustom,
				Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
			}},
		},
	}); err != nil {
		t.Fatalf("UpdateFromConfig: %v", err)
	}
	controller.UpdateAIServiceStartupOptions(appserver.AIServiceStartupOptions{
		AgentHomeDir: home, FilesystemScope: scope,
	})
	close(allowFirst)
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	if got := creates.Load(); got != 2 {
		t.Fatalf("service create count = %d, want 2", got)
	}
	if got := closedFirst.Load(); got != 1 {
		t.Fatalf("stale service close count = %d, want 1", got)
	}
	service, _, _, release, err := controller.AcquireAIService(context.Background())
	if err != nil || service != second {
		t.Fatalf("published service = %p, %v; want replacement", service, err)
	}
	release()
	_ = controller.Close()
}

func TestAIReadinessControllerClosesWhenParentLifecycleEnds(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	closed := make(chan struct{}, 1)
	controller := newAIReadinessController(parent, ai.Options{}, func(context.Context, ai.Options) (*ai.Service, error) {
		return new(ai.Service), nil
	}, func(*ai.Service) error {
		closed <- struct{}{}
		return nil
	})
	controller.Start()
	waitForAIReadinessState(t, controller, appserver.AIReadinessReady)
	cancel()
	select {
	case <-controller.closeDone:
	case <-time.After(time.Second):
		t.Fatal("controller did not close after parent cancellation")
	}
	select {
	case <-closed:
	default:
		t.Fatal("parent cancellation did not close the service")
	}
	if _, _, _, _, err := controller.AcquireAIService(context.Background()); !errors.Is(err, appserver.ErrAIServiceUnavailable) {
		t.Fatalf("acquire after parent cancellation = %v", err)
	}
}

func waitForAIReadinessState(t *testing.T, controller *aiReadinessController, want appserver.AIReadinessState) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if controller.AIReadiness().State == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("readiness state = %q, want %q", controller.AIReadiness().State, want)
}

func assertAIServiceCloseCount(t *testing.T, mu *sync.Mutex, counts map[*ai.Service]int, service *ai.Service, want int) {
	t.Helper()
	mu.Lock()
	defer mu.Unlock()
	if got := counts[service]; got != want {
		t.Fatalf("service %p close count = %d, want %d", service, got, want)
	}
}
