package appserver

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/containerresource"
	"github.com/floegence/redeven/internal/session"
)

type appserverContainerEngine struct {
	volumes map[string]containerengine.VolumeRecord
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
	return containerengine.ImageRecord{}, containerengine.ErrImageNotFound
}

func (f *appserverContainerEngine) HistoryImage(context.Context, containerengine.Engine, string) ([]containerengine.ImageHistoryEntry, error) {
	return nil, nil
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
