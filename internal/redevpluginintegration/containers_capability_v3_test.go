package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redevplugin/pkg/capability"
	"github.com/floegence/redevplugin/pkg/capabilitycontract"
	"github.com/floegence/redevplugin/pkg/mutation"
)

func TestContainersStatsWatchStreamsCandidateEventAndCancels(t *testing.T) {
	client := &extendedCapabilityEngineClient{capabilityEngineClient: &capabilityEngineClient{}}
	adapter := newTestContainersCapabilityAdapter(client)
	operation := newTestOperationSink("operation_stats")
	stream := newTestStreamSink("stream_stats")
	result, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodContainersStatsWatch)},
			Operation:        operation,
			Stream:           stream,
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1", "interval_ms": 1000},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersV3CandidateResponse(t, string(containers.MethodContainersStatsWatch), result.Data)
	select {
	case event := <-stream.events:
		validateContainersV3CandidateEvent(t, string(containers.MethodContainersStatsWatch), event)
		encoded := mustPreparedResponse(t, event)
		for _, expected := range []string{"\"container_id\":\"container_1\"", "\"cpu_percent\":1.5", "\"memory_bytes\":1024"} {
			if !strings.Contains(encoded, expected) {
				t.Fatalf("stats event missing %s: %s", expected, encoded)
			}
		}
	case <-time.After(time.Second):
		t.Fatal("stats event was not appended immediately")
	}
	if err := adapter.CancelOperation(context.Background(), capability.OperationCancellation{
		OperationID: operation.ID(),
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{
			TargetMethod: string(containers.MethodContainersStatsWatch),
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if terminal := waitTerminal(t, operation.terminal); terminal != "canceled" {
		t.Fatalf("stats operation terminal = %q", terminal)
	}
	if err := adapter.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestContainersStatsWatchRejectsInvalidIntervalBeforeRegisteringTask(t *testing.T) {
	adapter := newTestContainersCapabilityAdapter(&extendedCapabilityEngineClient{capabilityEngineClient: &capabilityEngineClient{}})
	operation := newTestOperationSink("operation_stats_invalid")
	_, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{
			ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodContainersStatsWatch)},
			Operation:        operation,
			Stream:           newTestStreamSink("stream_stats_invalid"),
		},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1", "interval_ms": 999},
	})
	if err == nil || !strings.Contains(err.Error(), "interval_ms") {
		t.Fatalf("Invoke() invalid interval error = %v", err)
	}
	adapter.tasksMu.Lock()
	taskCount := len(adapter.tasks)
	adapter.tasksMu.Unlock()
	if taskCount != 0 {
		t.Fatalf("invalid stats request registered %d tasks", taskCount)
	}
}

func TestContainersImageRemovePreflightProjectsExactConfirmedRequest(t *testing.T) {
	client := &extendedCapabilityEngineClient{
		capabilityEngineClient: &capabilityEngineClient{},
		images: []containers.ImageRecord{{
			ID: "sha256:image", Reference: "ghcr.io/acme/api:latest", SizeBytes: 4096, ReferencedContainers: 2,
		}},
	}
	adapter := newTestContainersCapabilityAdapter(client)

	_, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodImagesRemovePreflight)}},
		Arguments: map[string]any{"engine": "docker", "image": "ghcr.io/acme/api:latest"},
	})
	var businessError *capability.BusinessError
	if !errors.As(err, &businessError) || businessError.Code != "CONTAINER_IMAGE_IN_USE" ||
		businessError.Details["image"] != "ghcr.io/acme/api:latest" || fmt.Sprint(businessError.Details["referenced_containers"]) != "2" {
		t.Fatalf("unforced image preflight error = %#v, err=%v", businessError, err)
	}
	validateContainersV3CandidateBusinessError(t, businessError)

	result, err := adapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodImagesRemovePreflight)}},
		Arguments: map[string]any{
			"engine": "docker", "image": "ghcr.io/acme/api:latest", "force": true,
			"confirmation_name": "ghcr.io/acme/api:latest",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersV3CandidateResponse(t, string(containers.MethodImagesRemovePreflight), result.Data)
	prepared := mustPreparedResponse(t, result.Data)
	for _, expected := range []string{
		"\"method\":\"images.remove\"", "\"confirmation_name\":\"ghcr.io/acme/api:latest\"",
		"\"referenced_containers\":2", "\"reclaimable_bytes\":4096", "\"requires_admin\":true",
	} {
		if !strings.Contains(prepared, expected) {
			t.Fatalf("image preflight projection missing %s: %s", expected, prepared)
		}
	}
}

func TestContainersDestructivePreflightsReturnTypedCandidateErrors(t *testing.T) {
	runningAdapter := newTestContainersCapabilityAdapter(&capabilityEngineClient{containers: []containers.EngineContainer{{
		Engine: containers.EngineDocker, ContainerID: "container_1", Name: "api", State: containers.ContainerStateRunning,
	}}})
	_, err := runningAdapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodContainersRemovePreflight)}},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1"},
	})
	var running *capability.BusinessError
	if !errors.As(err, &running) || running.Code != "CONTAINER_RUNNING" ||
		running.Details["container_id"] != "container_1" || running.Details["container_name"] != "api" {
		t.Fatalf("running container preflight error = %#v, err=%v", running, err)
	}
	validateContainersV3CandidateBusinessError(t, running)

	volumeAdapter := newTestContainersCapabilityAdapter(&extendedCapabilityEngineClient{
		capabilityEngineClient: &capabilityEngineClient{},
		volumes:                []containers.VolumeRecord{{Name: "data", ReferencedContainers: 3}},
	})
	_, err = volumeAdapter.Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodVolumesRemovePreflight)}},
		Arguments: map[string]any{"engine": "docker", "name": "data", "confirmation_name": "data"},
	})
	var volume *capability.BusinessError
	if !errors.As(err, &volume) || volume.Code != "CONTAINER_VOLUME_IN_USE" ||
		volume.Details["name"] != "data" || fmt.Sprint(volume.Details["referenced_containers"]) != "3" {
		t.Fatalf("referenced volume preflight error = %#v, err=%v", volume, err)
	}
	validateContainersV3CandidateBusinessError(t, volume)
}

func TestContainersPruneOperationForwardsExactConfirmedIdentities(t *testing.T) {
	client := &extendedCapabilityEngineClient{
		capabilityEngineClient: &capabilityEngineClient{},
		images:                 []containers.ImageRecord{{ID: "sha256:a"}, {ID: "sha256:b"}},
		volumes:                []containers.VolumeRecord{{Name: "cache"}, {Name: "data"}},
	}
	adapter := newTestContainersCapabilityAdapter(client)
	for _, test := range []struct {
		method     containers.Method
		operation  string
		identities []string
	}{
		{method: containers.MethodImagesPrune, operation: "operation_prune_images", identities: []string{"sha256:a", "sha256:b"}},
		{method: containers.MethodVolumesPrune, operation: "operation_prune_volumes", identities: []string{"cache", "data"}},
	} {
		sink := newTestOperationSink(test.operation)
		result, err := adapter.Invoke(context.Background(), capability.Invocation{
			Execution: capability.ExecutionContext{
				ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(test.method)},
				Operation:        sink,
			},
			Arguments: map[string]any{"engine": "docker", "resource_identities": test.identities},
		})
		if err != nil {
			t.Fatalf("Invoke(%s) error = %v", test.method, err)
		}
		validateContainersV3CandidateResponse(t, string(test.method), result.Data)
		if terminal := waitTerminal(t, sink.terminal); terminal != "completed" {
			t.Fatalf("Invoke(%s) terminal = %q", test.method, terminal)
		}
	}
	if len(client.prunedImageRequests) != 1 || len(client.prunedVolumeRequests) != 1 {
		t.Fatalf("exact prune calls = images %#v, volumes %#v", client.prunedImageRequests, client.prunedVolumeRequests)
	}
	if got := client.prunedImageRequests[0].ResourceIdentities; !equalStrings(got, []string{"sha256:a", "sha256:b"}) {
		t.Fatalf("image prune identities = %#v", got)
	}
	if got := client.prunedVolumeRequests[0].ResourceIdentities; !equalStrings(got, []string{"cache", "data"}) {
		t.Fatalf("volume prune identities = %#v", got)
	}
}

func TestContainersPartialPruneRequiresUnknownOutcomeReconciliation(t *testing.T) {
	cause := &containers.ResourcePrunePartialError{
		ResourceKind:        "image",
		CompletedIdentities: []string{"sha256:a"},
		PendingIdentities:   []string{"sha256:b"},
		Cause:               errors.New("second identity failed"),
	}
	err := containerBusinessErrorForBinding(capability.ExecutionBinding{CapabilityVersion: containersCapabilityV3Version}, cause)
	if outcome := mutation.ForError(err); outcome != mutation.OutcomeUnknown {
		t.Fatalf("partial prune mutation outcome = %q, want unknown", outcome)
	}
	var businessError *capability.BusinessError
	if !errors.As(err, &businessError) || businessError.Code != "CONTAINER_OPERATION_FAILED" {
		t.Fatalf("partial prune business error = %#v, err=%v", businessError, err)
	}
	validateContainersV3CandidateBusinessError(t, businessError)
}

func TestContainersInspectCandidateProjectionOmitsRawHostPathsAndSecrets(t *testing.T) {
	client := &capabilityEngineClient{containers: []containers.EngineContainer{{
		Engine: containers.EngineDocker, ContainerID: "container_1", Name: "api",
		Image: containers.ImageInput{Reference: "ghcr.io/acme/api:latest"}, State: containers.ContainerStateRunning,
		Runtime: containers.RuntimeInput{
			Privileged: true, NetworkMode: "host", PIDMode: "host", IPCMode: "private", RestartPolicy: "always",
			Env: []string{"MODE=prod", "API_TOKEN=raw-token"}, Labels: map[string]string{"token": "raw-label-secret"},
			Mounts: []containers.MountInput{
				{Type: containers.MountTypeBind, Source: "/srv/private/api", Target: "/workspace"},
				{Type: containers.MountTypeVolume, Source: "cache", Target: "/cache"},
			},
			Devices: []containers.DeviceInput{{HostPath: "/dev/kvm", ContainerPath: "/dev/kvm", Permissions: "rwm"}},
			CapAdd:  []string{"NET_ADMIN"}, CapDrop: []string{"SYS_ADMIN"},
		},
	}}}
	result, err := newTestContainersCapabilityAdapter(client).Invoke(context.Background(), capability.Invocation{
		Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(containers.MethodInspect)}},
		Arguments: map[string]any{"engine": "docker", "container_id": "container_1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	validateContainersV3CandidateResponse(t, string(containers.MethodInspect), result.Data)
	raw, err := json.Marshal(result.Data)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"/srv/private/api", "/workspace", "/dev/kvm", "API_TOKEN", "raw-token", "raw-label-secret"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("inspect candidate projection leaked %q: %s", forbidden, raw)
		}
	}
	for _, expected := range []string{"\"source_kind\":\"host_path\"", "\"permissions\":\"rwm\"", "\"protected_count\":1", "\"NET_ADMIN\""} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("inspect candidate projection omitted safe summary %s: %s", expected, raw)
		}
	}
}

func TestContainersPreflightProjectionKeepsExactDigestButOmitsSensitiveInputs(t *testing.T) {
	adapter := newTestContainersCapabilityAdapter(&extendedCapabilityEngineClient{capabilityEngineClient: &capabilityEngineClient{}})
	for _, test := range []struct {
		method    containers.Method
		arguments map[string]any
		forbidden []string
	}{
		{
			method: containers.MethodContainersCreatePreflight,
			arguments: map[string]any{
				"engine": "docker", "name": "api", "image": "ghcr.io/acme/api:latest",
				"env":     []any{"API_TOKEN=raw-secret"},
				"mounts":  []any{map[string]any{"type": "bind", "source": "/srv/private", "target": "/workspace"}},
				"devices": []any{map[string]any{"host_path": "/dev/kvm", "container_path": "/dev/kvm", "permissions": "rwm"}},
			},
			forbidden: []string{"raw-secret", "/srv/private", "/workspace", "/dev/kvm", "API_TOKEN"},
		},
		{
			method:    containers.MethodVolumesCreatePreflight,
			arguments: map[string]any{"engine": "docker", "name": "data", "driver": "local", "options": []any{map[string]any{"key": "password", "value": "volume-secret"}}},
			forbidden: []string{"volume-secret"},
		},
	} {
		result, err := adapter.Invoke(context.Background(), capability.Invocation{
			Execution: capability.ExecutionContext{ExecutionBinding: capability.ExecutionBinding{TargetMethod: string(test.method)}},
			Arguments: test.arguments,
		})
		if err != nil {
			t.Fatalf("Invoke(%s) error = %v", test.method, err)
		}
		validateContainersV3CandidateResponse(t, string(test.method), result.Data)
		raw := mustPreparedResponse(t, result.Data)
		if !strings.Contains(raw, "plan_digest") {
			t.Fatalf("Invoke(%s) omitted exact plan digest: %s", test.method, raw)
		}
		for _, forbidden := range test.forbidden {
			if strings.Contains(raw, forbidden) {
				t.Fatalf("Invoke(%s) leaked %q: %s", test.method, forbidden, raw)
			}
		}
	}
}

func TestContainerResourceBusinessErrorSeparatesRecoveryStates(t *testing.T) {
	for _, test := range []struct {
		cause error
		code  string
	}{
		{containers.ErrCLIUnavailable, "CONTAINER_CLI_UNAVAILABLE"},
		{containers.ErrDaemonStopped, "CONTAINER_DAEMON_STOPPED"},
		{containers.ErrBackendUnreachable, "CONTAINER_ENGINE_UNREACHABLE"},
		{containers.ErrPermissionDenied, "CONTAINER_PERMISSION_DENIED"},
		{containers.ErrEngineTimeout, "CONTAINER_OPERATION_TIMEOUT"},
		{containers.ErrReferenceStateIncomplete, "CONTAINER_REFERENCE_STATE_INCOMPLETE"},
	} {
		var businessError *capability.BusinessError
		if err := containerResourceBusinessError(test.cause); !errors.As(err, &businessError) || businessError.Code != test.code {
			t.Fatalf("containerResourceBusinessError(%v) = %#v, want %s", test.cause, businessError, test.code)
		}
		validateContainersV3CandidateBusinessError(t, businessError)
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func validateContainersV3CandidateEvent(t *testing.T, method string, value any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "capabilities", "container-resources-v3.contract.json"))
	if err != nil {
		t.Fatal(err)
	}
	var contract capabilitycontract.Contract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range contract.Methods {
		if candidate.Name != method {
			continue
		}
		if candidate.EventSchema == nil {
			t.Fatalf("candidate contract method %q has no event schema", method)
		}
		prepared, err := capability.PrepareResponseData(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := capabilitycontract.ValidateValue(candidate.EventSchema, prepared); err != nil {
			t.Fatalf("candidate event for %s does not match v3 contract: %v\n%#v", method, err, prepared)
		}
		return
	}
	t.Fatalf("candidate contract method %q not found", method)
}

func validateContainersV3CandidateBusinessError(t *testing.T, businessError *capability.BusinessError) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "capabilities", "container-resources-v3.contract.json"))
	if err != nil {
		t.Fatal(err)
	}
	var contract capabilitycontract.Contract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range contract.Errors {
		if candidate.Code != businessError.Code {
			continue
		}
		if candidate.Message != businessError.Message {
			t.Fatalf("candidate error %s message = %q, want %q", businessError.Code, businessError.Message, candidate.Message)
		}
		if candidate.DetailsSchema == nil {
			if len(businessError.Details) != 0 {
				t.Fatalf("candidate error %s returned unexpected details %#v", businessError.Code, businessError.Details)
			}
			return
		}
		if err := capabilitycontract.ValidateValue(candidate.DetailsSchema, businessError.Details); err != nil {
			t.Fatalf("candidate error %s details do not match v3 contract: %v\n%#v", businessError.Code, err, businessError.Details)
		}
		return
	}
	t.Fatalf("candidate error %q not found", businessError.Code)
}
