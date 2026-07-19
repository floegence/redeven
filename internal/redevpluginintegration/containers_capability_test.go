package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/capabilities/containers"
	redevpluginartifacts "github.com/floegence/redeven/spec/redevplugin"
	"github.com/floegence/redevplugin/pkg/capability"
	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/observability"
	"github.com/floegence/redevplugin/pkg/version"
)

func TestContainersCapabilityRegistryUsesVerifiedSignedArtifacts(t *testing.T) {
	registry, bridge, err := newContainersCapabilityRegistry(containers.NewAdapter(&capabilityEngineClient{}), nil)
	if err != nil {
		t.Fatalf("newContainersCapabilityRegistry() error = %v", err)
	}
	t.Cleanup(func() { _ = bridge.Close() })
	bundle, _, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	registration, err := registry.Resolve(bundle.Pin)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if registration.Contract.Contract.CapabilityID != containersCapabilityID || registration.Contract.Contract.CapabilityVersion != containersCapabilityVersion {
		t.Fatalf("registered capability identity = %s@%s", registration.Contract.Contract.CapabilityID, registration.Contract.Contract.CapabilityVersion)
	}
}

func TestContainersCapabilityTargetProjectionOwnsCanonicalFields(t *testing.T) {
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{})
	input := map[string]any{"engine": "docker", "container_id": "container_1"}
	target, err := adapter.ProjectTarget(context.Background(), capability.TargetResolutionRequest{
		CapabilityID: containersCapabilityID, CapabilityVersion: containersCapabilityVersion,
		TargetMethod: string(containers.MethodInspect), TargetInput: input,
	})
	if err != nil {
		t.Fatal(err)
	}
	input["container_id"] = "mutated"
	if target.Kind != "container" || target.Fields["container_id"] != "container_1" {
		t.Fatalf("projected target = %#v", target)
	}
}

func TestContainersCapabilitySyncResponsesMatchSignedContract(t *testing.T) {
	client := &capabilityEngineClient{
		status: containers.EngineStatus{Engine: containers.EngineDocker, Available: true, Version: "27.1.0"},
		containers: []containers.EngineContainer{{
			Engine: containers.EngineDocker, ContainerID: "container_1", Name: "api",
			Image: containers.ImageInput{Reference: "ghcr.io/acme/api:latest", Digest: "sha256:feed"},
			State: containers.ContainerStateRunning, CreatedAtUnixMs: 1704067200000,
			Ports: []containers.PortSummary{{Protocol: "tcp", HostPort: 8080, Port: 80}},
		}},
	}
	adapter := newTestContainersCapabilityAdapter(client)
	result, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodList)}},
		Arguments: map[string]any{"engine": "docker", "all": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersCapabilityResponse(t, string(containers.MethodList), result.Data)
	encoded := mustPreparedResponse(t, result.Data)
	if strings.Contains(encoded, "schema_version") || strings.Contains(encoded, "capability_id") {
		t.Fatalf("business DTO metadata crossed the signed capability boundary: %s", encoded)
	}

	preflight, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodStartPreflight)}},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersCapabilityResponse(t, string(containers.MethodStartPreflight), preflight.Data)
	prepared := mustPreparedResponse(t, preflight.Data)
	for _, forbidden := range []string{"/Users/", "API_TOKEN", "raw-token", "\"env\"", "\"mounts\""} {
		if strings.Contains(prepared, forbidden) {
			t.Fatalf("preflight response exposed forbidden data %q: %s", forbidden, prepared)
		}
	}
}

func TestContainersCapabilityReturnsPublishedBusinessError(t *testing.T) {
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{
		status: containers.EngineStatus{Engine: containers.EngineDocker, Available: false},
	})
	_, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodStatus)}},
		Arguments: map[string]any{"engine": "docker"},
	})
	var businessError *capability.BusinessError
	if !errors.As(err, &businessError) || businessError.Code != "CONTAINER_ENGINE_UNAVAILABLE" || len(businessError.Details) != 0 {
		t.Fatalf("business error = %#v, err=%v", businessError, err)
	}
}

func TestContainersCapabilityOperationUsesHostOwnedSink(t *testing.T) {
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{})
	sink := newTestOperationSink("operation_1")
	result, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodStart)},
			Operation:        sink,
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersCapabilityResponse(t, string(containers.MethodStart), result.Data)
	data := result.Data.(map[string]any)
	if data["accepted"] != true || data["method"] != string(containers.MethodStart) {
		t.Fatalf("accepted response = %#v", data)
	}
	if terminal := waitTerminal(t, sink.terminal); terminal != "completed" {
		t.Fatalf("operation terminal = %q", terminal)
	}
}

func TestContainersCapabilityCancellationStopsBusinessOperation(t *testing.T) {
	started := make(chan struct{})
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{
		action: func(ctx context.Context, req containers.EngineActionRequest) (containers.EngineActionResult, error) {
			close(started)
			<-ctx.Done()
			return containers.EngineActionResult{}, ctx.Err()
		},
	})
	sink := newTestOperationSink("operation_cancel")
	_, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodRemove)},
			Operation:        sink,
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1", "force": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("business operation did not start")
	}
	if err := adapter.CancelOperation(context.Background(), capability.OperationCancellation{
		OperationID: "operation_cancel",
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{
			TargetMethod: string(containers.MethodRemove),
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if terminal := waitTerminal(t, sink.terminal); terminal != "canceled" {
		t.Fatalf("operation terminal = %q", terminal)
	}
}

func TestContainersCapabilitySubscriptionAppendsDirectlyToHostStream(t *testing.T) {
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{
		logs: containers.EngineLogsResult{
			Engine: containers.EngineDocker, ContainerID: "container_1",
			Lines: []containers.LogLine{{TimestampUnixMs: 1704067200000, Message: "ready"}},
		},
	})
	operation := newTestOperationSink("operation_logs")
	stream := newTestStreamSink("stream_logs")
	result, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodLogsTail)},
			Operation:        operation,
			Stream:           stream,
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1", "tail_lines": 50},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersCapabilityResponse(t, string(containers.MethodLogsTail), result.Data)
	select {
	case event := <-stream.events:
		validateContainersCapabilityEvent(t, string(containers.MethodLogsTail), event)
	case <-time.After(time.Second):
		t.Fatal("stream event was not appended")
	}
	if terminal := waitTerminal(t, stream.terminal); terminal != "closed" {
		t.Fatalf("stream terminal = %q", terminal)
	}
}

func TestContainersCapabilityReportsTerminalSinkFailure(t *testing.T) {
	diagnostics := &capabilityDiagnosticSink{events: make(chan observability.DiagnosticEvent, 1)}
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{})
	adapter.diagnostics = diagnostics
	sink := newTestOperationSink("operation_terminal_failure")
	sink.completeErr = errors.New("sqlite /Users/alice/private.db token=secret")
	_, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{
				TargetMethod: "containers.start", PluginID: "com.redeven.official.containers",
				PluginInstanceID: "plugin_1", OperationID: sink.ID(), AuditCorrelationID: "audit_1",
			},
			Operation: sink,
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-diagnostics.events:
		if event.Message != containerTerminalFailure || !event.Failure.Valid() || strings.Contains(event.Message, "private.db") {
			t.Fatalf("terminal diagnostic = %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("terminal sink failure was not diagnosed")
	}
	if err := adapter.Close(); err == nil || err.Error() != containerTerminalFailure {
		t.Fatalf("Close() error = %v, want stable terminal failure", err)
	}
}

func TestContainersCapabilityCloseCancelsAndWaitsForTasks(t *testing.T) {
	started := make(chan struct{})
	adapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{
		action: func(ctx context.Context, req containers.EngineActionRequest) (containers.EngineActionResult, error) {
			close(started)
			<-ctx.Done()
			return containers.EngineActionResult{}, ctx.Err()
		},
	})
	sink := newTestOperationSink("operation_close")
	_, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodStart)},
			Operation:        sink,
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("business operation did not start")
	}
	if err := adapter.Close(); err != nil {
		t.Fatal(err)
	}
	if terminal := waitTerminal(t, sink.terminal); terminal != "failed" {
		t.Fatalf("operation terminal = %q", terminal)
	}
	if _, err := adapter.registerTask(context.Background(), "operation_after_close", string(containers.MethodStart)); !errors.Is(err, errContainersCapabilityClosed) {
		t.Fatalf("registerTask() after Close error = %v", err)
	}
}

func newTestContainersCapabilityAdapter(client containers.EngineClient) *containersCapabilityAdapter {
	return &containersCapabilityAdapter{containers: containers.NewAdapter(client), tasks: make(map[string]containerCapabilityTask)}
}

func validateContainersCapabilityResponse(t *testing.T, method string, value any) {
	t.Helper()
	contract := verifiedContainersContract(t).Contract
	for _, candidate := range contract.Methods {
		if candidate.Name == method {
			prepared, err := capability.PrepareResponseData(value)
			if err != nil {
				t.Fatal(err)
			}
			if err := capabilitycontract.ValidateValue(candidate.ResponseSchema, prepared); err != nil {
				t.Fatalf("response for %s does not match signed contract: %v\n%#v", method, err, prepared)
			}
			return
		}
	}
	t.Fatalf("signed contract method %q not found", method)
}

func validateContainersCapabilityEvent(t *testing.T, method string, value any) {
	t.Helper()
	contract := verifiedContainersContract(t).Contract
	for _, candidate := range contract.Methods {
		if candidate.Name == method {
			if err := capabilitycontract.ValidateValue(candidate.EventSchema, value); err != nil {
				t.Fatalf("event for %s does not match signed contract: %v", method, err)
			}
			return
		}
	}
	t.Fatalf("signed contract method %q not found", method)
}

func verifiedContainersContract(t *testing.T) capabilitycontract.VerifiedContract {
	t.Helper()
	bundle, key, err := redevpluginartifacts.ContainersCapabilityBundle()
	if err != nil {
		t.Fatal(err)
	}
	verified, err := capabilitycontract.Verify(capabilitycontract.VerifyRequest{
		Bundle: bundle, ExpectedPin: bundle.Pin, TrustedKey: key,
		CurrentReDevPluginVersion: version.CurrentCompatibilityVersion(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return verified
}

func mustPreparedResponse(t *testing.T, value any) string {
	t.Helper()
	prepared, err := capability.PrepareResponseData(value)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

type capabilityEngineClient struct {
	status     containers.EngineStatus
	containers []containers.EngineContainer
	logs       containers.EngineLogsResult
	action     func(context.Context, containers.EngineActionRequest) (containers.EngineActionResult, error)
}

func (c *capabilityEngineClient) Status(_ context.Context, engine containers.Engine) (containers.EngineStatus, error) {
	if c.status.Engine == "" {
		return containers.EngineStatus{Engine: engine, Available: true, Version: "test"}, nil
	}
	return c.status, nil
}

func (c *capabilityEngineClient) List(context.Context, containers.Engine, bool) ([]containers.EngineContainer, error) {
	return append([]containers.EngineContainer(nil), c.containers...), nil
}

func (c *capabilityEngineClient) Inspect(_ context.Context, engine containers.Engine, containerID string) (containers.EngineContainer, error) {
	for _, item := range c.containers {
		if item.ContainerID == containerID {
			return item, nil
		}
	}
	return containers.EngineContainer{
		Engine: engine, ContainerID: containerID, Name: "api",
		Image: containers.ImageInput{Reference: "ghcr.io/acme/api:latest"}, State: containers.ContainerStateStopped,
		Runtime: containers.RuntimeInput{Privileged: true, Env: []string{"API_TOKEN=raw-token"}},
	}, nil
}

func (c *capabilityEngineClient) Action(ctx context.Context, req containers.EngineActionRequest) (containers.EngineActionResult, error) {
	if c.action != nil {
		return c.action(ctx, req)
	}
	return containers.EngineActionResult{Engine: req.Engine, Method: req.Method, ContainerID: req.ContainerID, Completed: true}, nil
}

func (c *capabilityEngineClient) TailLogs(context.Context, containers.EngineLogsRequest) (containers.EngineLogsResult, error) {
	return c.logs, nil
}

func (c *capabilityEngineClient) PullImage(_ context.Context, engine containers.Engine, imageRef string) (containers.EngineImageResult, error) {
	return containers.EngineImageResult{Engine: engine, Image: containers.ImageInput{Reference: imageRef}, Completed: true}, nil
}

type testOperationSink struct {
	id              string
	terminal        chan string
	cancelRequested chan struct{}
	completeErr     error
}

func newTestOperationSink(id string) *testOperationSink {
	return &testOperationSink{id: id, terminal: make(chan string, 1), cancelRequested: make(chan struct{})}
}

func (s *testOperationSink) ID() string { return s.id }

func (s *testOperationSink) Complete(context.Context) error {
	if s.completeErr != nil {
		return s.completeErr
	}
	s.terminal <- "completed"
	return nil
}

func (s *testOperationSink) Cancel(context.Context, string) error {
	s.terminal <- "canceled"
	return nil
}

func (s *testOperationSink) Fail(context.Context, capability.ExecutionFailureCode, error) error {
	s.terminal <- "failed"
	return nil
}

func (s *testOperationSink) CancelRequested() <-chan struct{} { return s.cancelRequested }

type testStreamSink struct {
	id       string
	events   chan any
	terminal chan string
}

func newTestStreamSink(id string) *testStreamSink {
	return &testStreamSink{id: id, events: make(chan any, 4), terminal: make(chan string, 1)}
}

func (s *testStreamSink) ID() string { return s.id }

func (s *testStreamSink) Append(_ context.Context, event any) error {
	s.events <- event
	return nil
}

func (s *testStreamSink) Close(context.Context) error {
	s.terminal <- "closed"
	return nil
}

func (s *testStreamSink) Fail(context.Context, capability.ExecutionFailureCode, error) error {
	s.terminal <- "failed"
	return nil
}

func waitTerminal(t *testing.T, terminal <-chan string) string {
	t.Helper()
	select {
	case value := <-terminal:
		return value
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for terminal sink state")
		return ""
	}
}

type capabilityDiagnosticSink struct {
	events chan observability.DiagnosticEvent
}

func (s *capabilityDiagnosticSink) AppendPluginDiagnostic(_ context.Context, event observability.DiagnosticEvent) error {
	s.events <- event
	return nil
}
