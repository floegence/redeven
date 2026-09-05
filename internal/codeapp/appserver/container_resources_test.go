package appserver

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/containerresource"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
)

type appserverContainerEngine struct {
	volumes      map[string]containerengine.VolumeRecord
	imagePresent bool
	image        containerengine.ImageRecord
	buildHistory []containerengine.ImageBuildHistoryEntry
}

const appserverContainerServiceID = "container_service_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type appserverContainerServiceEngine struct {
	*appserverContainerEngine
}

func (f *appserverContainerServiceEngine) ContainerServices(context.Context) ([]containerengine.ContainerService, error) {
	return []containerengine.ContainerService{{
		ServiceID: appserverContainerServiceID, Engine: containerengine.EngineDocker, Name: "Docker Engine",
		Implementation: containerengine.ContainerServiceDockerEngine, State: containerengine.ContainerServiceStateStopped,
		Capabilities: containerengine.ContainerServiceCapabilities{Start: true},
		ConfigurationAccess: containerengine.ContainerServiceConfigurationAccess{
			Mode:    containerengine.ContainerServiceConfigurationLocal,
			Sources: []containerengine.ContainerServiceConfigurationSourceID{containerengine.ContainerServiceConfigurationSourceEngine},
		},
	}}, nil
}

func (f *appserverContainerServiceEngine) ContainerServiceConfiguration(context.Context, string) (containerengine.ContainerServiceConfiguration, error) {
	return containerengine.ContainerServiceConfiguration{
		ServiceID: appserverContainerServiceID,
		Sources: []containerengine.ContainerServiceConfigurationSource{{
			SourceID: containerengine.ContainerServiceConfigurationSourceEngine, DisplayPath: "~/.docker/daemon.json",
			Status: containerengine.ContainerServiceConfigurationSourceReady, Exists: true,
			Format:     containerengine.ContainerServiceConfigurationJSON,
			Sections:   []containerengine.ContainerServiceConfigurationSection{containerengine.ContainerServiceConfigurationSectionProxy, containerengine.ContainerServiceConfigurationSectionAdvanced},
			ApplyModes: []containerengine.ContainerServiceApplyMode{containerengine.ContainerServiceSave},
			Content:    `{"proxies":{"http-proxy":"http://user:secret@example.test"}}`, BaseRevision: "sha256:base",
			HTTPProxy: "http://user:secret@example.test",
		}},
	}, nil
}

func (f *appserverContainerServiceEngine) ContainerServiceAction(_ context.Context, _ containerengine.Method, _ containerengine.ContainerServiceActionRequest) (containerengine.ContainerServiceActionResult, error) {
	return containerengine.ContainerServiceActionResult{ServiceID: appserverContainerServiceID, State: containerengine.ContainerServiceStateRunning}, nil
}

func (f *appserverContainerServiceEngine) ValidateContainerServiceConfiguration(context.Context, containerengine.ContainerServiceConfigurationUpdateRequest) error {
	return nil
}

func (f *appserverContainerServiceEngine) UpdateContainerServiceConfiguration(_ context.Context, _ containerengine.ContainerServiceConfigurationUpdateRequest) (containerengine.ContainerServiceActionResult, error) {
	return containerengine.ContainerServiceActionResult{ServiceID: appserverContainerServiceID, State: containerengine.ContainerServiceStateStopped, Revision: "sha256:updated", RestartRequired: true}, nil
}

func (f *appserverContainerEngine) Status(context.Context, containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{Engine: containerengine.EngineDocker, Available: true}, nil
}

func (f *appserverContainerEngine) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	return []containerengine.EngineContainer{{Engine: containerengine.EngineDocker, ContainerID: "container-one", Name: "api", State: containerengine.ContainerStateRunning}}, nil
}

func (f *appserverContainerEngine) Inspect(_ context.Context, engine containerengine.Engine, id string) (containerengine.EngineContainer, error) {
	if id != "container-one" {
		return containerengine.EngineContainer{}, containerengine.ErrContainerNotFound
	}
	return containerengine.EngineContainer{Engine: engine, ContainerID: id, Name: "api", State: containerengine.ContainerStateRunning}, nil
}

func (f *appserverContainerEngine) Action(_ context.Context, req containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	return containerengine.EngineActionResult{Engine: req.Engine, Method: req.Method, ContainerID: req.ContainerID, Completed: true}, nil
}

func (f *appserverContainerEngine) TailLogs(context.Context, containerengine.EngineLogsRequest) (containerengine.EngineLogsResult, error) {
	return containerengine.EngineLogsResult{}, nil
}

func (f *appserverContainerEngine) PullImage(context.Context, containerengine.Engine, string) (containerengine.EngineImageResult, error) {
	return containerengine.EngineImageResult{}, nil
}

func (f *appserverContainerEngine) ContainerExecProgram(_ context.Context, req containerengine.ContainerExecRequest) (containerengine.ProgramSpec, error) {
	args := []string{"exec", "--interactive", "--tty", req.ContainerID}
	args = append(args, req.Argv...)
	return containerengine.ProgramSpec{Executable: string(req.Engine), Args: args}, nil
}

func (f *appserverContainerEngine) CreateContainer(context.Context, containerengine.ContainerCreateRequest) (containerengine.ContainerActionResponse, error) {
	return containerengine.ContainerActionResponse{ContainerID: "container-created", Completed: true}, nil
}

func (f *appserverContainerEngine) Stats(context.Context, containerengine.Engine, string) (containerengine.ContainerStats, error) {
	return containerengine.ContainerStats{}, nil
}

func (f *appserverContainerEngine) StatsMany(context.Context, containerengine.Engine) ([]containerengine.ContainerStats, error) {
	return []containerengine.ContainerStats{{ContainerID: "container-one", CPUPercent: 1.5, MemoryBytes: 1024}}, nil
}

func (f *appserverContainerEngine) RawInspectContainer(context.Context, containerengine.Engine, string) (json.RawMessage, error) {
	return json.RawMessage(`[{"Id":"container-one","Config":{"Secret":"raw-secret-value"}}]`), nil
}

func (f *appserverContainerEngine) VolumeArchive(context.Context, containerengine.Engine, string) ([]byte, error) {
	return appserverResourceArchive("token.txt", []byte("volume-value")), nil
}

func appserverResourceArchive(values ...any) []byte {
	var buffer bytes.Buffer
	writer := tar.NewWriter(&buffer)
	for index := 0; index+1 < len(values); index += 2 {
		name := values[index].(string)
		data := values[index+1].([]byte)
		header := &tar.Header{Name: name, Mode: 0o644, Size: int64(len(data)), Typeflag: tar.TypeReg}
		if strings.HasSuffix(name, "/") {
			header.Typeflag = tar.TypeDir
			header.Size = 0
		}
		_ = writer.WriteHeader(header)
		if len(data) > 0 {
			_, _ = writer.Write(data)
		}
	}
	_ = writer.Close()
	return buffer.Bytes()
}

func (f *appserverContainerEngine) ListImages(context.Context, containerengine.Engine) ([]containerengine.ImageRecord, error) {
	return nil, nil
}

func (f *appserverContainerEngine) InspectImage(context.Context, containerengine.Engine, string) (containerengine.ImageRecord, error) {
	if !f.imagePresent {
		return containerengine.ImageRecord{}, containerengine.ErrImageNotFound
	}
	return f.image, nil
}

func (f *appserverContainerEngine) BuildHistoryImage(context.Context, containerengine.Engine, string) ([]containerengine.ImageBuildHistoryEntry, error) {
	return append([]containerengine.ImageBuildHistoryEntry(nil), f.buildHistory...), nil
}

func (f *appserverContainerEngine) TagImage(context.Context, containerengine.ImageTagRequest) error {
	return nil
}
func (f *appserverContainerEngine) RemoveImage(context.Context, containerengine.ImageRemoveRequest) error {
	return nil
}
func (f *appserverContainerEngine) PruneImages(context.Context, containerengine.ResourcePruneRequest) error {
	return nil
}

func (f *appserverContainerEngine) ListVolumes(context.Context, containerengine.Engine) ([]containerengine.VolumeRecord, error) {
	result := make([]containerengine.VolumeRecord, 0, len(f.volumes))
	for _, item := range f.volumes {
		result = append(result, item)
	}
	return result, nil
}

func (f *appserverContainerEngine) InspectVolume(_ context.Context, _ containerengine.Engine, name string) (containerengine.VolumeRecord, error) {
	item, ok := f.volumes[name]
	if !ok {
		return containerengine.VolumeRecord{}, errors.New("volume not found")
	}
	return item, nil
}

func (f *appserverContainerEngine) CreateVolume(_ context.Context, req containerengine.VolumeCreateRequest) (containerengine.VolumeRecord, error) {
	item := containerengine.VolumeRecord{Name: req.Name, Driver: req.Driver}
	f.volumes[req.Name] = item
	return item, nil
}

func (f *appserverContainerEngine) RemoveVolume(_ context.Context, req containerengine.VolumeRemoveRequest) error {
	delete(f.volumes, req.Name)
	return nil
}

func (f *appserverContainerEngine) PruneVolumes(context.Context, containerengine.ResourcePruneRequest) error {
	return nil
}

func (f *appserverContainerEngine) ValidateComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return nil
}

func (f *appserverContainerEngine) ApplyComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return nil
}

func (f *appserverContainerEngine) InspectComposeDeployment(_ context.Context, req containerengine.ComposeDeploymentRequest) (containerengine.ComposeProjectDetails, error) {
	return containerengine.ComposeProjectDetails{ComposeProject: containerengine.ComposeProject{ProjectID: containerengine.ComposeProjectID(req.ProjectName), Name: req.ProjectName, Status: "stopped"}}, nil
}

func (f *appserverContainerEngine) StartComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return nil
}

func (f *appserverContainerEngine) StopComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return nil
}

func (f *appserverContainerEngine) RestartComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return nil
}

func (f *appserverContainerEngine) RemoveComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest, bool) error {
	return nil
}

func (f *appserverContainerEngine) TailComposeDeploymentLogs(context.Context, containerengine.ComposeDeploymentRequest, int) ([]string, error) {
	return nil, nil
}

func newContainerAPITestService(t *testing.T) *containerresource.Service {
	t.Helper()
	client := &appserverContainerEngine{volumes: map[string]containerengine.VolumeRecord{"important-data": {Name: "important-data", Driver: "local"}}}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	service, err := containerresource.Open(containerresource.Options{DatabasePath: filepath.Join(t.TempDir(), "containers.sqlite"), Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	return service
}

func newContainerRuntimeAPITestService(t *testing.T) *containerresource.Service {
	t.Helper()
	runner := containerengine.CommandRunnerFunc(func(_ context.Context, name string, args ...string) ([]byte, error) {
		command := strings.TrimSpace(name + " " + strings.Join(args, " "))
		switch command {
		case "docker context ls --format {{json .}}":
			return nil, containerengine.ErrCLIUnavailable
		case "podman system connection list --format json":
			return []byte(`[]`), nil
		case "podman version --format {{json .}}":
			return []byte(`{"Client":{"Version":"5.4.0"},"Server":{"Version":"5.4.0"}}`), nil
		case "podman info --format json":
			return []byte(`{"host":{"security":{"rootless":true}}}`), nil
		default:
			return nil, errors.New("unexpected container command")
		}
	})
	adapter, err := containerengine.NewAdapter(&containerengine.CLIClient{Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	service, err := containerresource.Open(containerresource.Options{DatabasePath: filepath.Join(t.TempDir(), "containers.sqlite"), Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	return service
}

func newContainerServiceAPITestService(t *testing.T) *containerresource.Service {
	t.Helper()
	client := &appserverContainerServiceEngine{appserverContainerEngine: &appserverContainerEngine{volumes: make(map[string]containerengine.VolumeRecord)}}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	service, err := containerresource.Open(containerresource.Options{DatabasePath: filepath.Join(t.TempDir(), "containers.sqlite"), Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	return service
}

func serveContainerAPI(t *testing.T, server *Server, channelID, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Origin", envOriginWithChannel(channelID))
	response := httptest.NewRecorder()
	if !server.handleContainerResourcesAPI(response, request) {
		t.Fatal("container API route was not handled")
	}
	return response
}

func TestContainerImageBuildHistoryRouteIsSeparateFromLegacyHistory(t *testing.T) {
	client := &appserverContainerEngine{
		volumes:      map[string]containerengine.VolumeRecord{},
		imagePresent: true,
		image:        containerengine.ImageRecord{ID: "sha256:image", Layers: []containerengine.ImageLayer{{Digest: "sha256:layer"}}},
		buildHistory: []containerengine.ImageBuildHistoryEntry{{IntermediateImageID: "sha256:step", SizeBytes: 1024}},
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	service, err := containerresource.Open(containerresource.Options{DatabasePath: filepath.Join(t.TempDir(), "containers.sqlite"), Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	channelID := "ch_container_image_history"
	server := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, UserPublicID: "user-image"})}

	response := serveContainerAPI(t, server, channelID, http.MethodGet, containerResourcesAPIBase+"/images/sha256%3Aimage/build-history?engine=docker", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"build_history"`) || !strings.Contains(response.Body.String(), `sha256:step`) {
		t.Fatalf("build history response status=%d body=%s", response.Code, response.Body.String())
	}
	legacy := serveContainerAPI(t, server, channelID, http.MethodGet, containerResourcesAPIBase+"/images/sha256%3Aimage/history?engine=docker", "")
	if legacy.Code != http.StatusNotFound {
		t.Fatalf("legacy history route status=%d body=%s", legacy.Code, legacy.Body.String())
	}
}

type appserverExecTerminalManager struct {
	created terminal.ContainerExecSessionRequest
	deleted string
	owner   string
}

func (m *appserverExecTerminalManager) CreateSessionInGroup(string, string, string) (*terminal.SessionInfo, error) {
	return nil, errors.New("not implemented")
}
func (m *appserverExecTerminalManager) DeleteSession(string) error { return nil }
func (m *appserverExecTerminalManager) DeleteSessionForWidget(string, string) error {
	return nil
}
func (m *appserverExecTerminalManager) AddSessionLifecycleHook(terminal.SessionLifecycleHook) func() {
	return func() {}
}
func (m *appserverExecTerminalManager) CreateContainerExecSession(req terminal.ContainerExecSessionRequest) (*terminal.SessionInfo, error) {
	m.created = req
	return &terminal.SessionInfo{ID: "session-exec-one"}, nil
}
func (m *appserverExecTerminalManager) DeleteContainerExecSession(sessionID string, ownerUserID string) error {
	if sessionID != "session-exec-one" || ownerUserID == "" {
		return terminal.ErrSessionNotFound
	}
	m.deleted, m.owner = sessionID, ownerUserID
	return nil
}

func TestContainerExecSessionUsesReadExecuteExactArgvAndRedactedAudit(t *testing.T) {
	service := newContainerAPITestService(t)
	auditStore, err := auditlog.New(auditlog.Options{StateDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	channelID := "ch_container_exec"
	termManager := &appserverExecTerminalManager{}
	server := &Server{
		containers: service, term: termManager, audit: auditStore,
		resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanExecute: true, UserPublicID: "user-exec"}),
	}
	body := `{"engine":"docker","argv":["/bin/sh","-c","printf super-secret"]}`
	response := serveContainerAPI(t, server, channelID, http.MethodPost, containerResourcesAPIBase+"/containers/container-one/exec-sessions", body)
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"session_id":"session-exec-one"`) {
		t.Fatalf("create Exec status=%d body=%s", response.Code, response.Body.String())
	}
	if termManager.created.Executable != "docker" || strings.Join(termManager.created.Args, "|") != "exec|--interactive|--tty|container-one|/bin/sh|-c|printf super-secret" || termManager.created.OwnerUserID != "user-exec" {
		t.Fatalf("terminal Exec request = %+v", termManager.created)
	}
	entries, err := auditStore.List(10)
	if err != nil {
		t.Fatal(err)
	}
	rawAudit, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(rawAudit, []byte("super-secret")) || bytes.Contains(rawAudit, []byte("/bin/sh")) {
		t.Fatalf("audit leaked Exec argv: %s", rawAudit)
	}

	response = serveContainerAPI(t, server, channelID, http.MethodDelete, containerResourcesAPIBase+"/exec-sessions/session-exec-one", "")
	if response.Code != http.StatusOK || termManager.deleted != "session-exec-one" || termManager.owner != "user-exec" {
		t.Fatalf("close Exec status=%d body=%s manager=%+v", response.Code, response.Body.String(), termManager)
	}
}

func TestContainerExecSessionRequiresReadExecuteAndRejectsInvalidArgv(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_exec_permissions"
	termManager := &appserverExecTerminalManager{}
	readOnly := &Server{containers: service, term: termManager, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, UserPublicID: "user-exec"})}
	response := serveContainerAPI(t, readOnly, channelID, http.MethodPost, containerResourcesAPIBase+"/containers/container-one/exec-sessions", `{"engine":"docker"}`)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-only Exec status=%d body=%s", response.Code, response.Body.String())
	}
	readExecute := &Server{containers: service, term: termManager, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanExecute: true, UserPublicID: "user-exec"})}
	response = serveContainerAPI(t, readExecute, channelID, http.MethodPost, containerResourcesAPIBase+"/containers/container-one/exec-sessions", "{\"engine\":\"docker\",\"argv\":[\"/bin/sh\",\"line\\nbreak\"]}")
	if response.Code != http.StatusBadRequest || termManager.created.Executable != "" {
		t.Fatalf("invalid argv status=%d body=%s manager=%+v", response.Code, response.Body.String(), termManager)
	}
}

func TestContainerRuntimeDiscoveryKeepsEngineFailuresIndependent(t *testing.T) {
	service := newContainerRuntimeAPITestService(t)
	channelID := "ch_container_runtimes"
	server := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}

	response := serveContainerAPI(t, server, channelID, http.MethodGet, containerResourcesAPIBase+"/runtimes", "")
	if response.Code != http.StatusOK {
		t.Fatalf("runtime discovery status=%d body=%s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, expected := range []string{`"engine":"docker"`, `"state":"not_installed"`, `"engine":"podman"`, `"state":"ready"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("runtime discovery body=%s, want %s", body, expected)
		}
	}
	if strings.Contains(body, `"display_name"`) || strings.Contains(body, `"remote"`) {
		t.Fatalf("runtime discovery leaked endpoint presentation: %s", body)
	}
	if strings.Contains(body, "unexpected container command") {
		t.Fatalf("runtime discovery leaked engine error detail: %s", body)
	}

	deniedChannelID := "ch_container_runtimes_denied"
	denied := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(deniedChannelID, session.Meta{})}
	response = serveContainerAPI(t, denied, deniedChannelID, http.MethodGet, containerResourcesAPIBase+"/runtimes", "")
	if response.Code != http.StatusForbidden {
		t.Fatalf("runtime discovery without Read status=%d body=%s", response.Code, response.Body.String())
	}

	legacy := serveContainerAPI(t, server, channelID, http.MethodGet, containerResourcesAPIBase+"/endpoints?engine=podman", "")
	if legacy.Code != http.StatusNotFound {
		t.Fatalf("legacy endpoint route status=%d body=%s", legacy.Code, legacy.Body.String())
	}
}

func TestContainerServicesRequireAdminForConfigurationAndKeepSecretsOutOfAudit(t *testing.T) {
	service := newContainerServiceAPITestService(t)
	channelID := "ch_container_services"
	readOnly := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}

	response := serveContainerAPI(t, readOnly, channelID, http.MethodGet, containerResourcesAPIBase+"/services", "")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), appserverContainerServiceID) || !strings.Contains(response.Body.String(), `"configuration":{"mode":"local","sources":["engine"]}`) || strings.Contains(response.Body.String(), "secret") || strings.Contains(response.Body.String(), "configure_proxy") {
		t.Fatalf("service list status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveContainerAPI(t, readOnly, channelID, http.MethodGet, containerResourcesAPIBase+"/services/"+appserverContainerServiceID+"/configuration", "")
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-admin configuration status=%d body=%s", response.Code, response.Body.String())
	}

	auditStore, err := auditlog.New(auditlog.Options{StateDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	admin := &Server{containers: service, audit: auditStore, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})}
	response = serveContainerAPI(t, admin, channelID, http.MethodGet, containerResourcesAPIBase+"/services/"+appserverContainerServiceID+"/configuration", "")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), "user:secret") {
		t.Fatalf("admin configuration status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}

	request := `{"method":"container.services.configuration.update","request":{"engine":"docker","service_id":"` + appserverContainerServiceID + `","source_id":"engine","base_revision":"sha256:base","mode":"proxy","apply_mode":"save","http_proxy":"http://new-secret@example.test","confirmation_name":"Docker Engine"}}`
	response = serveContainerAPI(t, admin, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", request)
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "new-secret") {
		t.Fatalf("configuration preflight status=%d body=%s", response.Code, response.Body.String())
	}
	entries, err := auditStore.List(10)
	if err != nil {
		t.Fatal(err)
	}
	rawAudit, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(rawAudit, []byte("user:secret")) || bytes.Contains(rawAudit, []byte("new-secret")) {
		t.Fatalf("container service audit leaked configuration: %s", rawAudit)
	}
}

func TestContainerServiceMutationsRequireFullRWXAndAdmin(t *testing.T) {
	service := newContainerServiceAPITestService(t)
	channelID := "ch_container_service_permissions"
	request := `{"method":"container.services.start","request":{"engine":"docker","service_id":"` + appserverContainerServiceID + `"}}`
	readExecute := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanExecute: true, CanAdmin: true})}
	response := serveContainerAPI(t, readExecute, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("service mutation without Write status=%d body=%s", response.Code, response.Body.String())
	}
	fullNonAdmin := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	response = serveContainerAPI(t, fullNonAdmin, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "ADMIN_REQUIRED") {
		t.Fatalf("service mutation without Admin status=%d body=%s", response.Code, response.Body.String())
	}
	admin := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})}
	response = serveContainerAPI(t, admin, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", request)
	if response.Code != http.StatusOK {
		t.Fatalf("service mutation with RWX+Admin status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestContainerResourcePermissionsFollowRWXMatrix(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_permissions"
	readOnly := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	readExecute := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanExecute: true})}
	full := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	admin := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})}

	response := serveContainerAPI(t, readOnly, channelID, http.MethodGet, containerResourcesAPIBase+"/volumes?engine=docker", "")
	if response.Code != http.StatusOK {
		t.Fatalf("read inventory status=%d body=%s", response.Code, response.Body.String())
	}

	lifecycle := `{"method":"containers.stop","request":{"engine":"docker","container_id":"container-one"}}`
	response = serveContainerAPI(t, readOnly, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", lifecycle)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-only lifecycle status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveContainerAPI(t, readExecute, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", lifecycle)
	if response.Code != http.StatusOK {
		t.Fatalf("read-execute lifecycle status=%d body=%s", response.Code, response.Body.String())
	}

	create := `{"method":"volumes.create","request":{"engine":"docker","name":"new-data","driver":"local"}}`
	response = serveContainerAPI(t, readExecute, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", create)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-execute create status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveContainerAPI(t, full, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", create)
	if response.Code != http.StatusOK {
		t.Fatalf("full create status=%d body=%s", response.Code, response.Body.String())
	}

	remove := `{"method":"volumes.remove","request":{"engine":"docker","name":"important-data","confirmation_name":"important-data"}}`
	response = serveContainerAPI(t, full, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", remove)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "ADMIN_REQUIRED") {
		t.Fatalf("non-admin high-risk status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveContainerAPI(t, admin, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", remove)
	if response.Code != http.StatusOK {
		t.Fatalf("admin high-risk status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestContainerResourceAPIRejectsUnknownOuterAndInnerFields(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_json"
	server := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}

	outer := `{"method":"volumes.create","request":{"engine":"docker","name":"new-data"},"secret":"reject"}`
	response := serveContainerAPI(t, server, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", outer)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "REQUEST_INVALID") {
		t.Fatalf("unknown outer field status=%d body=%s", response.Code, response.Body.String())
	}
	inner := `{"method":"volumes.create","request":{"engine":"docker","name":"new-data","secret":"reject"}}`
	response = serveContainerAPI(t, server, channelID, http.MethodPost, containerResourcesAPIBase+"/preflights", inner)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "REQUEST_INVALID") {
		t.Fatalf("unknown inner field status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestContainerResourceReadExtensionsEnforceAdminAndDoNotLeakAuditPayloads(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_read_extensions"
	readOnly := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}

	response := serveContainerAPI(t, readOnly, channelID, http.MethodGet, containerResourcesAPIBase+"/containers/container-one/inspect/raw?engine=docker", "")
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-only raw inspect status=%d body=%s", response.Code, response.Body.String())
	}
	response = serveContainerAPI(t, readOnly, channelID, http.MethodGet, containerResourcesAPIBase+"/containers/container-one/files?engine=docker&path=%2Fprivate", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("removed container file route status=%d body=%s", response.Code, response.Body.String())
	}
	auditStore, err := auditlog.New(auditlog.Options{StateDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	admin := &Server{containers: service, audit: auditStore, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanAdmin: true})}
	response = serveContainerAPI(t, admin, channelID, http.MethodGet, containerResourcesAPIBase+"/containers/container-one/inspect/raw?engine=docker", "")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), "raw-secret-value") {
		t.Fatalf("admin raw inspect status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	entries, err := auditStore.List(10)
	if err != nil {
		t.Fatal(err)
	}
	rawAudit, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"raw-secret-value"} {
		if bytes.Contains(rawAudit, []byte(forbidden)) {
			t.Fatalf("audit contains forbidden payload %q: %s", forbidden, rawAudit)
		}
	}
}

func TestContainerResourceCollectionStatsUsesOneEndpointSnapshot(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_collection_stats"
	server := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	response := serveContainerAPI(t, server, channelID, http.MethodGet, containerResourcesAPIBase+"/containers/stats?engine=docker", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"container_id":"container-one"`) || !strings.Contains(response.Body.String(), `"cpu_percent":1.5`) {
		t.Fatalf("collection stats status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestContainerResourceStatsExposeSampleTimestamp(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_stats_timestamp"
	server := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	response := serveContainerAPI(t, server, channelID, http.MethodGet, containerResourcesAPIBase+"/containers/container-one/stats?engine=docker", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"sampled_at_unix_ms":`) {
		t.Fatalf("container stats status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestContainerComposeDefinitionsRequireAdminAndKeepPathsOutOfAudit(t *testing.T) {
	service := newContainerAPITestService(t)
	channelID := "ch_container_compose_definition"
	configPath := filepath.Join(t.TempDir(), "compose.yaml")
	if err := os.WriteFile(configPath, []byte("services:\n  api:\n    image: example/api:latest\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(containerresource.ComposeProjectDefinitionInput{
		Engine: containerengine.EngineDocker, Name: "saved-api", ConfigPaths: []string{configPath}, Profiles: []string{"dev"},
	})
	if err != nil {
		t.Fatal(err)
	}

	nonAdmin := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true})}
	response := serveContainerAPI(t, nonAdmin, channelID, http.MethodPost, containerResourcesAPIBase+"/compose-projects", string(input))
	if response.Code != http.StatusForbidden {
		t.Fatalf("non-admin save status=%d body=%s", response.Code, response.Body.String())
	}

	auditStore, err := auditlog.New(auditlog.Options{StateDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	admin := &Server{containers: service, audit: auditStore, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})}
	response = serveContainerAPI(t, admin, channelID, http.MethodPost, containerResourcesAPIBase+"/compose-projects", string(input))
	if response.Code != http.StatusCreated {
		t.Fatalf("admin save status=%d body=%s", response.Code, response.Body.String())
	}
	var created struct {
		Data containerresource.ComposeProjectDefinition `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Data.ProjectID == "" {
		t.Fatalf("created definition = %+v", created.Data)
	}

	target := containerResourcesAPIBase + "/compose-projects/" + created.Data.ProjectID + "/definition?engine=docker"
	response = serveContainerAPI(t, admin, channelID, http.MethodGet, target, "")
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), "compose.yaml") {
		t.Fatalf("definition status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	entries, err := auditStore.List(10)
	if err != nil {
		t.Fatal(err)
	}
	rawAudit, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(rawAudit, []byte(configPath)) {
		t.Fatalf("audit leaked Compose path: %s", rawAudit)
	}
}

func TestContainerOperationEventSnapshotExposesStructuredProgress(t *testing.T) {
	service := newContainerAPITestService(t)
	request := json.RawMessage(`{"engine":"docker","name":"event-data","driver":"local"}`)
	preflight, err := service.Preflight(context.Background(), containerresource.PreflightRequest{Method: containerengine.MethodVolumesCreate, Request: request})
	if err != nil {
		t.Fatal(err)
	}
	operation, err := service.CreateOperation(context.Background(), containerresource.CreateOperationRequest{
		RequestID: "request-operation-events", Method: containerengine.MethodVolumesCreate, Request: request,
		RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for !operation.State.Terminal() && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
		operation, err = service.Operation(context.Background(), operation.OperationID)
		if err != nil {
			t.Fatal(err)
		}
	}
	channelID := "ch_container_operation_events"
	server := &Server{containers: service, resolveSessionMeta: resolveMetaForTest(channelID, session.Meta{CanRead: true})}
	response := serveContainerAPI(t, server, channelID, http.MethodGet, containerOperationsAPIBase+"/"+operation.OperationID+"/events/snapshot?after_sequence=0", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"progress"`) || !strings.Contains(response.Body.String(), `"phase":"executing"`) {
		t.Fatalf("operation event snapshot status=%d body=%s", response.Code, response.Body.String())
	}
}
