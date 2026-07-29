package containers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestCLIClientV4BatchesPodInspectionWithinResourceLimits(t *testing.T) {
	t.Parallel()
	list := make([]map[string]any, 0, podInspectBatchSize+1)
	first := make([]map[string]any, 0, podInspectBatchSize)
	second := make([]map[string]any, 0, 1)
	firstIDs := make([]string, 0, podInspectBatchSize)
	for index := 0; index <= podInspectBatchSize; index++ {
		id := fmt.Sprintf("pod-%02d", index)
		name := fmt.Sprintf("application-%02d", index)
		list = append(list, map[string]any{"Id": id, "Name": name, "Status": "Running", "NumberOfContainers": 1})
		document := map[string]any{"Id": id, "Name": name, "State": "Running", "Containers": []map[string]any{{"Id": "container-" + id, "Name": "app", "State": "running", "Infra": false}}}
		if index < podInspectBatchSize {
			firstIDs = append(firstIDs, id)
			first = append(first, document)
		} else {
			second = append(second, document)
		}
	}
	listJSON, _ := json.Marshal(list)
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json":                           `[{"Name":"remote","Default":true}]`,
		"podman --connection remote pod ps --format json":                       string(listJSON),
		"podman --connection remote pod inspect " + strings.Join(firstIDs, " "): string(firstJSON),
		"podman --connection remote pod inspect pod-32":                         string(secondJSON),
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EnginePodman)
	if err != nil {
		t.Fatal(err)
	}
	bound, _, err := client.BindEndpoint(context.Background(), EnginePodman, endpoints[len(endpoints)-1].EndpointID)
	if err != nil {
		t.Fatal(err)
	}
	pods, err := client.ListPods(bound)
	if err != nil {
		t.Fatalf("ListPods() error = %v", err)
	}
	if len(pods) != podInspectBatchSize+1 || pods[0].Containers[0].ContainerID != "container-pod-00" || pods[len(pods)-1].PodID != "pod-32" {
		t.Fatalf("Pod inventory = %+v", pods)
	}
}

func TestCLIClientV4BindsOpaqueDockerEndpointWithoutChangingGlobalContext(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}":                      "{\"Name\":\"default\",\"Current\":false}\n{\"Name\":\"production\",\"Current\":true}\n",
		"docker --context production ps -a --no-trunc --format json": "",
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EngineDocker)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	if len(endpoints) != 2 || endpoints[1].DisplayName != "production" || !endpoints[1].Default {
		t.Fatalf("endpoints = %+v", endpoints)
	}
	if endpoints[1].EndpointID == EndpointID("production") || !endpoints[1].EndpointID.Valid() {
		t.Fatalf("endpoint ID = %q, want an opaque Host projection", endpoints[1].EndpointID)
	}
	bound, _, err := client.BindEndpoint(context.Background(), EngineDocker, endpoints[1].EndpointID)
	if err != nil {
		t.Fatalf("BindEndpoint() error = %v", err)
	}
	if _, err := client.List(bound, EngineDocker, true); err != nil {
		t.Fatalf("List() error = %v", err)
	}
	for _, call := range runner.calls {
		if strings.Contains(call, "context use") {
			t.Fatalf("endpoint selection mutated Docker global context: %q", call)
		}
	}
}

func TestCLIClientV4BindsDockerDefaultContextExplicitly(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}":                   `{"Name":"default","Current":true}`,
		"docker --context default ps -a --no-trunc --format json": "",
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EngineDocker)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	bound, _, err := client.BindEndpoint(context.Background(), EngineDocker, endpoints[0].EndpointID)
	if err != nil {
		t.Fatalf("BindEndpoint() error = %v", err)
	}
	if _, err := client.List(bound, EngineDocker, true); err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if got := runner.calls[len(runner.calls)-1]; got != "docker --context default ps -a --no-trunc --format json" {
		t.Fatalf("last runner call = %q", got)
	}
}

func TestCLIClientV4KeepsPodmanLocalAndNamedLocalConnectionDistinct(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json": `[{"Name":"local","Default":true}]`,
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EnginePodman)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	if len(endpoints) != 2 || endpoints[0].EndpointID == endpoints[1].EndpointID {
		t.Fatalf("endpoints = %+v, want distinct local and connection identities", endpoints)
	}
}

func TestCLIClientV4ProjectsPodPublishedPortsFromInspect(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json":     `[{"Name":"remote","Default":true}]`,
		"podman --connection remote pod ps --format json": `[{"Id":"pod-a","Name":"application","Status":"Running","NumberOfContainers":2}]`,
		"podman --connection remote pod inspect pod-a":    `[{"Id":"pod-a","Name":"application","State":"Running","InfraContainerID":"infra-a","InfraConfig":{"PortBindings":{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"}]}},"Containers":[{"Id":"infra-a","Name":"infra","State":"running","Infra":true},{"Id":"app-a","Name":"app","State":"running","Infra":false}]}]`,
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EnginePodman)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	bound, _, err := client.BindEndpoint(context.Background(), EnginePodman, endpoints[len(endpoints)-1].EndpointID)
	if err != nil {
		t.Fatalf("BindEndpoint() error = %v", err)
	}
	pods, err := client.ListPods(bound)
	if err != nil {
		t.Fatalf("ListPods() error = %v", err)
	}
	if len(pods) != 1 || len(pods[0].Ports) != 1 || pods[0].Ports[0].HostPort != 8080 || pods[0].Ports[0].Port != 80 {
		t.Fatalf("pods = %+v", pods)
	}
}

func TestAdapterV4RejectsForgedEndpointBeforePodPreflight(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json": `[{"Name":"remote","Default":true}]`,
	}}
	adapter, err := NewAdapter(&CLIClient{Runner: runner})
	if err != nil {
		t.Fatalf("NewAdapter() error = %v", err)
	}
	forged := EndpointID("endpoint_" + strings.Repeat("f", 64))
	_, err = adapter.CreatePodPreflight(context.Background(), PodCreateRequest{Engine: EnginePodman, EndpointID: forged, Name: "application"})
	if !errors.Is(err, ErrEndpointNotFound) {
		t.Fatalf("CreatePodPreflight() error = %v, want ErrEndpointNotFound", err)
	}
}

func TestAdapterV4ProjectsPodmanRootlessMetadataForBoundConnection(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json":            `[{"Name":"remote","Default":true}]`,
		"podman --connection remote version --format {{json .}}": `{"Client":{"Version":"5.2.0"},"Server":{"Version":"5.2.0"}}`,
		"podman --connection remote info --format json":          `{"host":{"security":{"rootless":true}}}`,
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EnginePodman)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	remote := endpoints[len(endpoints)-1]
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatalf("NewAdapter() error = %v", err)
	}
	status, err := adapter.EndpointStatus(context.Background(), EndpointStatusRequest{Engine: EnginePodman, EndpointID: remote.EndpointID})
	if err != nil {
		t.Fatalf("EndpointStatus() error = %v", err)
	}
	if !status.Available || status.Rootless == nil || !*status.Rootless {
		t.Fatalf("endpoint status = %+v", status)
	}
}

func TestAdapterV4ComposeDownRetainsVolumesAndBindsExactProject(t *testing.T) {
	t.Parallel()
	projectName := "application"
	projectID := composeProjectID(projectName)
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker context ls --format {{json .}}":                      `{"Name":"production","Current":true}`,
		"docker --context production compose ls --all --format json": `[{"Name":"application","Status":"running(1)","ConfigFiles":"/srv/application/compose.yml"}]`,
		"docker --context production compose --file /srv/application/compose.yml --project-name application ps --all --format json": `[{"ID":"container-a","Name":"application-web","Service":"web","State":"running"}]`,
		"docker --context production compose --file /srv/application/compose.yml --project-name application down":                   "",
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EngineDocker)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatalf("NewAdapter() error = %v", err)
	}
	req := ComposeProjectRequest{Engine: EngineDocker, EndpointID: endpoints[0].EndpointID, ProjectID: projectID, ConfirmationName: projectName}
	plan, err := adapter.ComposeProjectPreflight(context.Background(), MethodComposeProjectsDown, req)
	if err != nil {
		t.Fatalf("ComposeProjectPreflight() error = %v", err)
	}
	if plan.RiskLevel != RiskLevelHigh || plan.Target["endpoint_id"] != endpoints[0].EndpointID {
		t.Fatalf("plan = %+v", plan)
	}
	if _, err := adapter.ComposeProjectAction(context.Background(), MethodComposeProjectsDown, req); err != nil {
		t.Fatalf("ComposeProjectAction() error = %v", err)
	}
	for _, call := range runner.calls {
		if strings.Contains(call, "--volumes") {
			t.Fatalf("Compose down unexpectedly removes volumes: %q", call)
		}
	}
}

func TestAdapterV4PodRemovalRequiresExactNameAndConnection(t *testing.T) {
	t.Parallel()
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman system connection list --format json":  `[{"Name":"remote","Default":true}]`,
		"podman --connection remote pod inspect pod-a": `[{"Id":"pod-a","Name":"application","State":"Running","InfraContainerID":"infra-a","Containers":[{"Id":"infra-a","Name":"infra","State":"running","Infra":true}]}]`,
		"podman --connection remote pod rm pod-a":      "",
	}}
	client := &CLIClient{Runner: runner}
	endpoints, err := client.ListEndpoints(context.Background(), EnginePodman)
	if err != nil {
		t.Fatalf("ListEndpoints() error = %v", err)
	}
	remote := endpoints[len(endpoints)-1]
	adapter, err := NewAdapter(client)
	if err != nil {
		t.Fatalf("NewAdapter() error = %v", err)
	}
	req := PodRequest{Engine: EnginePodman, EndpointID: remote.EndpointID, PodID: "pod-a", ConfirmationName: "wrong"}
	if _, err := adapter.PodActionPreflight(context.Background(), MethodPodsRemove, req); err == nil {
		t.Fatal("PodActionPreflight() accepted a mismatched confirmation name")
	}
	req.ConfirmationName = "application"
	if _, err := adapter.PodAction(context.Background(), MethodPodsRemove, req); err != nil {
		t.Fatalf("PodAction() error = %v", err)
	}
	if got := runner.calls[len(runner.calls)-1]; got != "podman --connection remote pod rm pod-a" {
		t.Fatalf("last runner call = %q", got)
	}
}
