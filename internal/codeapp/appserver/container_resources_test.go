package appserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

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
