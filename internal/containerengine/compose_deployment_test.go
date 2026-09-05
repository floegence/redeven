package containerengine

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
)

func TestCLIClientBindsManagedComposeActionsToExactFilesAndProject(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	request := ComposeDeploymentRequest{ConfigPath: filepath.Join(root, "compose.yaml"), EnvFilePath: filepath.Join(root, "template.env"), ProjectName: "redeven_preview"}
	prefix := fmt.Sprintf("docker compose --file %s --project-name redeven_preview --env-file %s", request.ConfigPath, request.EnvFilePath)
	runner := &fakeCommandRunner{outputs: map[string]string{
		prefix + " config --quiet":               "",
		prefix + " up --detach --remove-orphans": "",
		"docker ps -a --no-trunc --filter label=com.docker.compose.project --format " + composeObservationFormat: `[{"ID":"container-one","Name":"redeven_preview-web-1","Project":"redeven_preview","Service":"web","State":"running","Status":"Up (healthy)"}]`,
		prefix + " stop":                      "",
		prefix + " down --volumes":            "",
		prefix + " logs --no-color --tail 20": "web-1 | ready\n",
	}}
	client := &CLIClient{Runner: runner}
	if err := client.ValidateComposeDeployment(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if err := client.ApplyComposeDeployment(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	details, err := client.InspectComposeDeployment(context.Background(), request)
	if err != nil || details.Name != request.ProjectName || details.RunningCount != 1 || len(details.Containers) != 1 || details.Containers[0].Service != "web" {
		t.Fatalf("details = %+v, err=%v", details, err)
	}
	if err := client.StopComposeDeployment(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if err := client.RemoveComposeDeployment(context.Background(), request, true); err != nil {
		t.Fatal(err)
	}
	lines, err := client.TailComposeDeploymentLogs(context.Background(), request, 20)
	if err != nil || len(lines) != 1 || lines[0] != "web-1 | ready" {
		t.Fatalf("logs = %#v, err=%v", lines, err)
	}
}
