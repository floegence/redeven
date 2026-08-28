package managedwebservice

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const webtopDockerSmokeEnv = "REDEVEN_WEBTOP_DOCKER_SMOKE"

func TestWebtopArtifactsPinEverySupportedArchitecture(t *testing.T) {
	t.Parallel()
	wants := map[string]map[string]string{
		WebtopUbuntuKDETemplateID: {
			"linux-amd64": "sha256:277ccc2688301ab076b6654ecb031a0061f34199add3d77503073ff3d8da429e",
			"linux-arm64": "sha256:3c35983ef7148cd14dd93d57dff9791d6a6b9d6018781e252edcfae0fe7d2f17",
		},
		WebtopDebianXFCETemplateID: {
			"linux-amd64": "sha256:686b8fac99918330a7a897ea8ab9e0aeeb822e7b4f5f5aeb837fa984f21d3c2b",
			"linux-arm64": "sha256:9092b349d525f765b0be912db1ec5a8d5aa97b0f1a3b57da27a7f72e69c90825",
		},
	}
	for templateID, platforms := range wants {
		for platform, digest := range platforms {
			artifact, ok := auditedWebtopArtifact(templateID, platform)
			if !ok || artifact.Image != webtopImage || artifact.Digest != digest || !dockerDigestPattern.MatchString(artifact.Digest) {
				t.Fatalf("artifact %s %s = %+v, available=%v", templateID, platform, artifact, ok)
			}
		}
		if _, ok := auditedWebtopArtifact(templateID, "linux-386"); ok {
			t.Fatalf("unsupported architecture accepted for %s", templateID)
		}
	}
}

func TestCatalogIncludesIndependentWebtopTemplatesWithDeclarativeSafety(t *testing.T) {
	t.Parallel()
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("Webtop catalog supports amd64 and arm64")
	}
	if runningInsideContainer() {
		t.Skip("nested Docker is intentionally unavailable")
	}
	adapter, err := containerengine.NewAdapter(catalogDockerEngineClient{})
	if err != nil {
		t.Fatal(err)
	}
	scope, stateDir := newManagedServiceTestScope(t)
	manager := &Manager{scope: scope, stateDir: stateDir, containers: adapter, downloads: defaultPackageDownloadClient()}

	templates, err := manager.Catalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ubuntu := templateByID(templates, WebtopUbuntuKDETemplateID)
	debian := templateByID(templates, WebtopDebianXFCETemplateID)
	if ubuntu == nil || debian == nil {
		t.Fatalf("Webtop templates missing from catalog: %+v", templates)
	}
	if ubuntu.ServiceFamilyID == debian.ServiceFamilyID || ubuntu.ServiceFamilyID != WebtopUbuntuKDETemplateID || debian.ServiceFamilyID != WebtopDebianXFCETemplateID {
		t.Fatalf("Webtop service families = %q, %q", ubuntu.ServiceFamilyID, debian.ServiceFamilyID)
	}
	for _, template := range []*Template{ubuntu, debian} {
		if template.BrandIcon != BrandIconInteractiveDesktop || template.LocalizationKey == "" || template.SourceURL != webtopSourceURL || !template.Available {
			t.Fatalf("Webtop catalog metadata = %+v", template)
		}
		if len(template.Notices) != 1 || !template.Notices[0].AcknowledgementRequired || template.Notices[0].Revision != 1 {
			t.Fatalf("Webtop notices = %+v", template.Notices)
		}
		spec := template.Spec
		if spec == nil || spec.Container == nil || spec.Container.RuntimeProfile != ContainerRuntimeProfileInteractiveDesktop || spec.Endpoint.ContainerPort != 3000 {
			t.Fatalf("Webtop template spec = %+v", spec)
		}
		if spec.Container.ReadOnlyRoot || spec.Container.PIDsLimit != 2048 || !strings.Contains(spec.Container.Image, "@sha256:") {
			t.Fatalf("Webtop runtime identity = %+v", spec.Container)
		}
		if !reflect.DeepEqual(spec.Container.Mounts, []ContainerMountSpec{{Type: "volume", Source: "config", Target: "/config"}, {Type: "workspace", Target: "/workspace"}}) {
			t.Fatalf("Webtop mounts = %+v", spec.Container.Mounts)
		}
		for key, want := range map[string]string{
			"PUID": "${REDEVEN_RUNTIME_UID}", "PGID": "${REDEVEN_RUNTIME_GID}", "START_DOCKER": "false", "FILE_MANAGER_PATH": "/workspace",
			"SELKIES_USE_CPU":        "true|locked",
			"SELKIES_ENABLE_SHARING": "false|locked", "SELKIES_ENABLE_COLLAB": "false|locked", "SELKIES_ENABLE_SHARED": "false|locked",
			"SELKIES_UI_SIDEBAR_SHOW_SHARING": "false|locked",
		} {
			if spec.Container.Environment[key] != want {
				t.Fatalf("Webtop environment %s = %q, want %q", key, spec.Container.Environment[key], want)
			}
		}
	}
	if !strings.HasSuffix(ubuntu.DefaultWorkspacePath, filepath.Join("Redeven", "workspaces", "managed-services", WebtopUbuntuKDETemplateID)) ||
		!strings.HasSuffix(debian.DefaultWorkspacePath, filepath.Join("Redeven", "workspaces", "managed-services", WebtopDebianXFCETemplateID)) {
		t.Fatalf("Webtop workspaces = %q, %q", ubuntu.DefaultWorkspacePath, debian.DefaultWorkspacePath)
	}
	for _, workspace := range []string{ubuntu.DefaultWorkspacePath, debian.DefaultWorkspacePath} {
		if strings.Contains(workspace, " ") {
			t.Fatalf("generated Webtop workspace contains spaces: %q", workspace)
		}
	}
	ubuntuIndex, debianIndex := templateIndexByID(templates, ubuntu.TemplateID), templateIndexByID(templates, debian.TemplateID)
	if ubuntuIndex < 0 || debianIndex != ubuntuIndex+1 {
		t.Fatalf("Webtop catalog order = ubuntu:%d debian:%d", ubuntuIndex, debianIndex)
	}
}

func TestWebtopNoticeAcknowledgementIsEnforcedByManager(t *testing.T) {
	t.Parallel()
	template := Template{Notices: webtopNotices()}
	if err := validateAcceptedNotices(template, nil); managedErrorCode(err) != "NOTICE_ACKNOWLEDGEMENT_REQUIRED" {
		t.Fatalf("missing acknowledgement error = %v", err)
	}
	accepted := map[string]int64{webtopRootNoticeID: 1}
	if err := validateAcceptedNotices(template, accepted); err != nil {
		t.Fatalf("accepted notices: %v", err)
	}
	accepted[webtopRootNoticeID] = 2
	if err := validateAcceptedNotices(template, accepted); managedErrorCode(err) != "NOTICE_ACKNOWLEDGEMENT_STALE" {
		t.Fatalf("stale acknowledgement error = %v", err)
	}
}

func TestInteractiveDesktopCreateRequestUsesOnlyReviewedCapabilities(t *testing.T) {
	t.Parallel()
	spec := webtopTemplateSpec(WebtopUbuntuKDETemplateID, dockerArtifact{Image: webtopImage, Digest: strings.Repeat("a", 64)})
	spec.Container.Image = webtopImage + "@sha256:" + strings.Repeat("a", 64)
	service := &pfregistry.ManagedService{ServiceID: "mws_webtop", WorkspacePath: "/workspace/project", RuntimePort: 43123}
	mounts := []containerengine.ContainerMount{
		{Type: containerengine.MountTypeVolume, Source: "redeven-config", Target: "/config"},
		{Type: containerengine.MountTypeBind, Source: service.WorkspacePath, Target: "/workspace"},
	}
	request := containerCreateRequest(service, spec, spec.Container.Image, mounts, []string{"PUID=501", "PGID=20"})
	if request.Privileged || request.ReadOnlyRoot || request.NetworkMode != "bridge" || request.PIDMode != "" || request.IPCMode != "" {
		t.Fatalf("interactive desktop namespace policy = %+v", request)
	}
	if len(request.CapAdd) != 0 || len(request.CapDrop) != 0 || len(request.Devices) != 0 || len(request.SecurityOpts) != 0 || request.User != "" {
		t.Fatalf("interactive desktop host capabilities = %+v", request)
	}
	if request.ShmSizeBytes != 1024*1024*1024 || request.PIDsLimit != 2048 {
		t.Fatalf("interactive desktop resource policy = %+v", request)
	}
	if !reflect.DeepEqual(request.Ports, []containerengine.ContainerPortPublish{{ContainerPort: 3000, HostPort: 43123, HostIP: "127.0.0.1", Protocol: "tcp"}}) {
		t.Fatalf("interactive desktop ports = %+v", request.Ports)
	}
}

func TestInteractiveDesktopRuntimeAcceptsOnlyPrivateNamespaces(t *testing.T) {
	t.Parallel()
	runtime := containerengine.RuntimeSummary{
		NetworkMode: "bridge", IPCMode: "private", PIDsLimit: 2048, ShmSizeBytes: 1024 * 1024 * 1024,
	}
	if !containerRuntimeMatchesProfile(runtime, ContainerRuntimeProfileInteractiveDesktop, 2048) {
		t.Fatalf("private Docker namespace rejected: %+v", runtime)
	}
	runtime.IPCMode = "host"
	if containerRuntimeMatchesProfile(runtime, ContainerRuntimeProfileInteractiveDesktop, 2048) {
		t.Fatal("host IPC namespace accepted")
	}
	runtime.IPCMode, runtime.PIDMode = "private", "host"
	if containerRuntimeMatchesProfile(runtime, ContainerRuntimeProfileInteractiveDesktop, 2048) {
		t.Fatal("host PID namespace accepted")
	}
	runtime.PIDMode, runtime.SecurityOpts = "", []string{"seccomp=unconfined"}
	if containerRuntimeMatchesProfile(runtime, ContainerRuntimeProfileInteractiveDesktop, 2048) {
		t.Fatal("unconfined seccomp accepted")
	}
}

func TestMountSourceMatchingOnlyNormalizesDockerDesktopBindPaths(t *testing.T) {
	t.Parallel()
	bind := containerengine.ContainerMount{Type: containerengine.MountTypeBind, Source: "/Users/redeven/workspace", Target: "/workspace"}
	actual := containerengine.MountSummary{Type: containerengine.MountTypeBind, Source: "/host_mnt/Users/redeven/workspace", Target: "/workspace"}
	if !mountSourceMatchesForHost(bind, actual, "darwin") {
		t.Fatal("Docker Desktop bind path was not recognized as the same host path")
	}
	if mountSourceMatchesForHost(bind, actual, "linux") {
		t.Fatal("Docker Desktop path normalization was accepted on Linux")
	}
	volume := containerengine.ContainerMount{Type: containerengine.MountTypeVolume, Source: "redeven-config", Target: "/config"}
	if mountSourceMatchesForHost(volume, containerengine.MountSummary{Type: containerengine.MountTypeVolume, Source: "/host_mnt/redeven-config"}, "darwin") {
		t.Fatal("Docker Desktop path normalization was applied to a named volume")
	}
}

func TestWebtopArtifactPreparationRejectsAnyDigestDrift(t *testing.T) {
	t.Parallel()
	adapter, err := containerengine.NewAdapter(webtopPullEngineClient{digest: "sha256:" + strings.Repeat("b", 64)})
	if err != nil {
		t.Fatal(err)
	}
	driver := containerTemplateDriver{adapter: adapter}
	spec := webtopTemplateSpec(WebtopUbuntuKDETemplateID, dockerArtifact{Image: webtopImage, Digest: "sha256:" + strings.Repeat("a", 64)})
	if _, err := driver.PrepareUpdateArtifact(context.Background(), spec); managedErrorCode(err) != "IMAGE_DIGEST_MISMATCH" {
		t.Fatalf("digest drift error = %v", err)
	}
}

func TestCustomTemplatesCannotOptIntoInteractiveDesktopProfile(t *testing.T) {
	t.Parallel()
	spec := webtopTemplateSpec(WebtopUbuntuKDETemplateID, dockerArtifact{Image: webtopImage, Digest: "sha256:" + strings.Repeat("a", 64)})
	err := validateTemplateWriteRequest(TemplateWriteRequest{Name: "Unsafe desktop", Spec: spec})
	if managedErrorCode(err) != "TEMPLATE_RUNTIME_PROFILE_RESERVED" {
		t.Fatalf("custom interactive desktop error = %v", err)
	}
}

func TestWebtopRealDockerLifecycle(t *testing.T) {
	if os.Getenv(webtopDockerSmokeEnv) != "1" {
		t.Skipf("set %s=1 to run the real Webtop Docker lifecycle smoke", webtopDockerSmokeEnv)
	}
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		t.Skip("Webtop Docker smoke supports amd64 and arm64")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Fatal("Docker CLI is unavailable")
	}
	client := containerengine.NewCLIClient()
	client.Timeout = 10 * time.Minute
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	smokeRoot, err := os.MkdirTemp(home, ".redeven-webtop-smoke-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(smokeRoot) })
	manager := &Manager{scope: scope, stateDir: filepath.Join(smokeRoot, "state"), containers: adapter}
	driver := &containerTemplateDriver{manager: manager, adapter: adapter}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()

	type runningService struct {
		service *pfregistry.ManagedService
		spec    TemplateSpec
		volume  string
	}
	running := make([]runningService, 0, 2)
	stamp := strconv.FormatInt(time.Now().UnixNano(), 10)
	for _, templateID := range []string{WebtopUbuntuKDETemplateID, WebtopDebianXFCETemplateID} {
		artifact, ok := auditedWebtopArtifact(templateID, "linux-"+runtime.GOARCH)
		if !ok {
			t.Fatalf("missing %s artifact for %s", templateID, runtime.GOARCH)
		}
		spec := webtopTemplateSpec(templateID, artifact)
		snapshot, hash, err := canonicalTemplateSpec(spec)
		if err != nil {
			t.Fatal(err)
		}
		workspace := filepath.Join(smokeRoot, templateID)
		if err := os.MkdirAll(workspace, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(workspace, "redeven-workspace-marker.txt"), []byte("workspace\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		port, err := reserveLoopbackPort()
		if err != nil {
			t.Fatal(err)
		}
		service := &pfregistry.ManagedService{
			ServiceID:  "mws_smoke_" + strings.TrimPrefix(templateID, "linuxserver-webtop-") + "_" + stamp,
			TemplateID: templateID, TemplateSource: "builtin", TemplateRevision: 1,
			TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: hash,
			ServiceFamilyID: "webtop-smoke-" + strings.TrimPrefix(templateID, "linuxserver-webtop-") + "-" + stamp,
			Deployment:      string(DeploymentContainer), WorkspacePath: workspace, RuntimePort: port,
			DesiredState: "running", ObservedState: "installing",
		}
		volumeName := "redeven-mws-data-" + resourceNameSuffix(service.ServiceFamilyID) + "-0"
		t.Cleanup(func() {
			_, _ = client.Action(context.Background(), containerengine.EngineActionRequest{Engine: containerengine.EngineDocker, Method: containerengine.MethodRemove, ContainerID: customContainerName(service.ServiceID), Force: true})
			_ = adapter.RemoveVolume(context.Background(), containerengine.VolumeRemoveRequest{Engine: containerengine.EngineDocker, Name: volumeName})
		})
		runtimeID, artifactReference, err := driver.Install(ctx, service, catalogPayload{}, func(string, int64) {})
		if err != nil {
			t.Fatalf("install %s: %v", templateID, err)
		}
		service.RuntimeIdentity, service.ArtifactReference = runtimeID, artifactReference
		if _, err := driver.Start(ctx, service); err != nil {
			t.Fatalf("start %s: %v", templateID, err)
		}
		if err := manager.waitHealthy(ctx, service); err != nil {
			t.Fatalf("health %s: %v", templateID, err)
		}
		if err := exec.CommandContext(ctx, "docker", "exec", runtimeID, "test", "-f", "/workspace/redeven-workspace-marker.txt").Run(); err != nil {
			t.Fatalf("workspace mount %s: %v", templateID, err)
		}
		if err := exec.CommandContext(ctx, "docker", "exec", runtimeID, "touch", "/config/redeven-config-marker.txt").Run(); err != nil {
			t.Fatalf("config write %s: %v", templateID, err)
		}
		running = append(running, runningService{service: service, spec: spec, volume: volumeName})
	}

	for _, item := range running {
		if err := driver.VerifyRuntime(ctx, item.service, item.spec); err != nil {
			t.Fatalf("verify simultaneous %s: %v", item.service.TemplateID, err)
		}
		if err := driver.Stop(ctx, item.service); err != nil {
			t.Fatalf("stop %s: %v", item.service.TemplateID, err)
		}
		if _, err := driver.Start(ctx, item.service); err != nil {
			t.Fatalf("restart %s: %v", item.service.TemplateID, err)
		}
	}

	for _, item := range running {
		if err := driver.Uninstall(ctx, item.service, false); err != nil {
			t.Fatalf("retain-data uninstall %s: %v", item.service.TemplateID, err)
		}
		item.service.RuntimeIdentity = ""
		runtimeID, err := driver.CreateRuntime(ctx, item.service, item.spec, item.service.ArtifactReference)
		if err != nil {
			t.Fatalf("recreate %s: %v", item.service.TemplateID, err)
		}
		item.service.RuntimeIdentity = runtimeID
		if _, err := driver.Start(ctx, item.service); err != nil {
			t.Fatalf("start recreated %s: %v", item.service.TemplateID, err)
		}
		if err := exec.CommandContext(ctx, "docker", "exec", runtimeID, "test", "-f", "/config/redeven-config-marker.txt").Run(); err != nil {
			t.Fatalf("retained config %s: %v", item.service.TemplateID, err)
		}
		if err := driver.Uninstall(ctx, item.service, true); err != nil {
			t.Fatalf("delete-data uninstall %s: %v", item.service.TemplateID, err)
		}
		volumes, err := adapter.ListVolumes(ctx, containerengine.EngineDocker)
		if err != nil {
			t.Fatalf("list volumes after deleting %s: %v", item.volume, err)
		}
		for _, volume := range volumes {
			if volume.Name == item.volume {
				t.Fatalf("deleted volume %s remained", item.volume)
			}
		}
	}
}

func templateIndexByID(templates []Template, templateID string) int {
	for i := range templates {
		if templates[i].TemplateID == templateID {
			return i
		}
	}
	return -1
}

type webtopPullEngineClient struct {
	catalogDockerEngineClient
	digest string
}

func (c webtopPullEngineClient) PullImage(_ context.Context, engine containerengine.Engine, imageRef string) (containerengine.EngineImageResult, error) {
	return containerengine.EngineImageResult{
		Engine: engine, Image: containerengine.ImageInput{Reference: imageRef, Digest: c.digest}, Completed: true,
	}, nil
}
