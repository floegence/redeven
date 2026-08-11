package redevpluginintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redevplugin/pkg/externalsource"
	"github.com/floegence/redevplugin/pkg/host"
	"github.com/floegence/redevplugin/pkg/pluginpkg"
	"github.com/floegence/redevplugin/pkg/registry"
)

type externalPackageCommitHTTPResult struct {
	Status  string                             `json:"status"`
	Receipt *host.ExternalPackageCommitReceipt `json:"receipt"`
	Plugin  *struct {
		PluginInstanceID    string                                  `json:"plugin_instance_id"`
		EnableState         registry.EnableState                    `json:"enable_state"`
		SignatureAssessment host.ExternalPackageSignatureAssessment `json:"signature_assessment"`
		ExecutionApproval   host.ExternalPackageExecutionApproval   `json:"execution_approval"`
		UpdateEligibility   host.ExternalPackageUpdateEligibility   `json:"update_eligibility"`
	} `json:"plugin"`
}

type staticExternalPackageFetcher struct {
	stage       *externalsource.StageStore
	packageURL  string
	packageData []byte
}

func (f staticExternalPackageFetcher) FetchPackage(ctx context.Context, request externalsource.FetchRequest) (externalsource.FetchResult, error) {
	if request.URL != f.packageURL {
		return externalsource.FetchResult{}, fmt.Errorf("package URL = %q, want %q", request.URL, f.packageURL)
	}
	artifact, err := f.stage.StageUpload(ctx, request.QuotaKey, bytes.NewReader(f.packageData), int64(len(f.packageData)))
	if err != nil {
		return externalsource.FetchResult{}, err
	}
	return externalsource.FetchResult{Artifact: artifact, Source: request.URL, Final: request.URL}, nil
}

func TestExternalPackageUploadInspectCommitAndQueryThroughHTTP(t *testing.T) {
	integration, _, unsignedPackage, access := newExternalPackageTestIntegration(t)
	t.Cleanup(func() { _ = integration.Close() })
	uploadRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
	uploadRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	uploadResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("inspect upload status = %d body=%s", uploadResponse.Code, uploadResponse.Body.String())
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(uploadResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode inspection: %v body=%s", err, uploadResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.InspectionID == "" || inspection.ConfirmationDigest == "" ||
		inspection.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		inspection.SourceProvenance.Kind != string(registry.PackageSourcePackageUpload) {
		t.Fatalf("inspection = %#v", inspection)
	}

	commitBody, err := json.Marshal(map[string]string{
		"inspection_id":       inspection.InspectionID,
		"confirmation_digest": inspection.ConfirmationDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	commitRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/commit", bytes.NewReader(commitBody))
	commitRequest.Header.Set("Content-Type", "application/json")
	commitResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(commitResponse, commitRequest)
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("commit upload status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK   bool                            `json:"ok"`
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode commit: %v body=%s", err, commitResponse.Body.String())
	}
	if !commitEnvelope.OK || commitEnvelope.Data.Status != string(registry.ExternalPackageCommitted) || commitEnvelope.Data.Receipt == nil ||
		commitEnvelope.Data.Plugin == nil || commitEnvelope.Data.Plugin.PluginInstanceID == "" ||
		commitEnvelope.Data.Plugin.EnableState != registry.EnableDisabled ||
		commitEnvelope.Data.Plugin.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		commitEnvelope.Data.Plugin.ExecutionApproval.State != string(registry.ExecutionApprovalUserApproved) ||
		commitEnvelope.Data.Plugin.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("commit = %#v", commitEnvelope.Data)
	}

	queryBody, err := json.Marshal(map[string]string{
		"inspection_id": inspection.InspectionID,
		"commit_id":     commitEnvelope.Data.Receipt.CommitID,
	})
	if err != nil {
		t.Fatal(err)
	}
	access.set(sessionPermissions{read: true})
	queryRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/commit/query", bytes.NewReader(queryBody))
	queryRequest.Header.Set("Content-Type", "application/json")
	queryResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(queryResponse, queryRequest)
	if queryResponse.Code != http.StatusOK {
		t.Fatalf("query commit status = %d body=%s", queryResponse.Code, queryResponse.Body.String())
	}

	pluginID := commitEnvelope.Data.Plugin.PluginInstanceID
	permissionsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/query", map[string]any{
			"plugin_instance_id": pluginID,
			"active_only":        true,
		})
	var permissionsEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Permissions []json.RawMessage `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(permissionsResponse.Body.Bytes(), &permissionsEnvelope); err != nil {
		t.Fatalf("decode permissions: %v body=%s", err, permissionsResponse.Body.String())
	}
	if permissionsResponse.Code != http.StatusOK || !permissionsEnvelope.OK || len(permissionsEnvelope.Data.Permissions) != 0 {
		t.Fatalf("unsigned install permissions status=%d response=%#v", permissionsResponse.Code, permissionsEnvelope)
	}

	requirementsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/requirements/query", map[string]any{
			"plugin_instance_id": pluginID,
		})
	var requirementsEnvelope struct {
		OK   bool                              `json:"ok"`
		Data host.PermissionRequirementsResult `json:"data"`
	}
	if err := json.Unmarshal(requirementsResponse.Body.Bytes(), &requirementsEnvelope); err != nil {
		t.Fatalf("decode permission requirements: %v body=%s", err, requirementsResponse.Body.String())
	}
	if requirementsResponse.Code != http.StatusOK || !requirementsEnvelope.OK ||
		requirementsEnvelope.Data.PluginInstanceID != pluginID ||
		len(requirementsEnvelope.Data.RequiredPermissions) == 0 {
		t.Fatalf("permission requirements status=%d response=%#v", requirementsResponse.Code, requirementsEnvelope)
	}
}

func TestContainersCatalogPackageInstallsThroughExternalUploadAtCurrentTime(t *testing.T) {
	integration, _, _, access := newExternalPackageTestIntegrationWithClock(t, time.Now)
	t.Cleanup(func() { _ = integration.Close() })
	packageBytes := unsignedExternalPackageFixture(t)

	uploadRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(packageBytes))
	uploadRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	uploadResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("inspect unsigned catalog upload status = %d body=%s", uploadResponse.Code, uploadResponse.Body.String())
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(uploadResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode unsigned catalog inspection: %v body=%s", err, uploadResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		inspection.ExecutionApproval.State != string(registry.ExecutionApprovalPending) ||
		inspection.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("unsigned catalog inspection = %#v", inspection)
	}

	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", map[string]string{
			"inspection_id":       inspection.InspectionID,
			"confirmation_digest": inspection.ConfirmationDigest,
		})
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("commit unsigned catalog upload status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK   bool                            `json:"ok"`
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode unsigned catalog commit: %v body=%s", err, commitResponse.Body.String())
	}
	if !commitEnvelope.OK || commitEnvelope.Data.Status != string(registry.ExternalPackageCommitted) ||
		commitEnvelope.Data.Plugin == nil || commitEnvelope.Data.Plugin.EnableState != registry.EnableDisabled ||
		commitEnvelope.Data.Plugin.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		commitEnvelope.Data.Plugin.ExecutionApproval.State != string(registry.ExecutionApprovalUserApproved) ||
		commitEnvelope.Data.Plugin.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("unsigned catalog commit = %#v", commitEnvelope.Data)
	}

	access.set(sessionPermissions{read: true})
	permissionsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/query", map[string]any{
			"plugin_instance_id": commitEnvelope.Data.Plugin.PluginInstanceID,
			"active_only":        true,
		})
	var permissionsEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Permissions []json.RawMessage `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(permissionsResponse.Body.Bytes(), &permissionsEnvelope); err != nil {
		t.Fatalf("decode unsigned catalog permissions: %v body=%s", err, permissionsResponse.Body.String())
	}
	if permissionsResponse.Code != http.StatusOK || !permissionsEnvelope.OK || len(permissionsEnvelope.Data.Permissions) != 0 {
		t.Fatalf("unsigned catalog install permissions status=%d response=%#v", permissionsResponse.Code, permissionsEnvelope)
	}
}

func TestContainersCatalogPackageInstallsThroughExternalURLAtCurrentTime(t *testing.T) {
	packageURL := catalogContainersPackageURL(t)
	packageBytes := unsignedExternalPackageFixture(t)
	integration, _, _, access := newExternalPackageTestIntegrationWithClockAndOptions(t, time.Now, func(options *Options) {
		options.newExternalFetcher = func(stage *externalsource.StageStore) (host.ExternalPackageFetcher, error) {
			return staticExternalPackageFetcher{stage: stage, packageURL: packageURL, packageData: packageBytes}, nil
		}
	})
	t.Cleanup(func() { _ = integration.Close() })

	inspectResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/inspect", map[string]any{
			"intent": map[string]string{"action": "install"},
			"source": map[string]string{"kind": "package_url", "url": packageURL},
		})
	if inspectResponse.Code != http.StatusOK {
		t.Fatalf("inspect catalog URL status = %d body=%s", inspectResponse.Code, inspectResponse.Body.String())
	}
	var rawInspectionEnvelope struct {
		Data struct {
			SourceProvenance map[string]json.RawMessage `json:"source_provenance"`
		} `json:"data"`
	}
	if err := json.Unmarshal(inspectResponse.Body.Bytes(), &rawInspectionEnvelope); err != nil {
		t.Fatalf("decode raw catalog URL inspection: %v body=%s", err, inspectResponse.Body.String())
	}
	redirectChainJSON, ok := rawInspectionEnvelope.Data.SourceProvenance["redirect_chain"]
	if !ok || !bytes.Equal(bytes.TrimSpace(redirectChainJSON), []byte("[]")) {
		t.Fatalf("catalog URL inspection redirect_chain must be a present empty array: %s", redirectChainJSON)
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(inspectResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode catalog URL inspection: %v body=%s", err, inspectResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.SourceProvenance.Kind != string(registry.PackageSourcePackageURL) ||
		inspection.SourceProvenance.SourceOrigin != "https://github.com" ||
		inspection.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		inspection.ExecutionApproval.State != string(registry.ExecutionApprovalPending) ||
		inspection.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("catalog URL inspection = %#v", inspection)
	}

	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", map[string]string{
			"inspection_id":       inspection.InspectionID,
			"confirmation_digest": inspection.ConfirmationDigest,
		})
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("commit catalog URL status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK   bool                            `json:"ok"`
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode catalog URL commit: %v body=%s", err, commitResponse.Body.String())
	}
	plugin := commitEnvelope.Data.Plugin
	if !commitEnvelope.OK || commitEnvelope.Data.Status != string(registry.ExternalPackageCommitted) ||
		plugin == nil || plugin.EnableState != registry.EnableDisabled ||
		plugin.SignatureAssessment.State != string(registry.SignatureAbsent) ||
		plugin.ExecutionApproval.State != string(registry.ExecutionApprovalUserApproved) ||
		plugin.UpdateEligibility.State != string(registry.UpdateManualOnly) {
		t.Fatalf("catalog URL commit = %#v", commitEnvelope.Data)
	}

	access.set(sessionPermissions{read: true})
	permissionsResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/permissions/query", map[string]any{
			"plugin_instance_id": plugin.PluginInstanceID,
			"active_only":        true,
		})
	var permissionsEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Permissions []json.RawMessage `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(permissionsResponse.Body.Bytes(), &permissionsEnvelope); err != nil {
		t.Fatalf("decode catalog URL permissions: %v body=%s", err, permissionsResponse.Body.String())
	}
	if permissionsResponse.Code != http.StatusOK || !permissionsEnvelope.OK || len(permissionsEnvelope.Data.Permissions) != 0 {
		t.Fatalf("catalog URL install permissions status=%d response=%#v", permissionsResponse.Code, permissionsEnvelope)
	}
}

func TestOfficialReleaseSignatureIsBlockedAsExternalPackage(t *testing.T) {
	integration, _, signedPackage, access := newExternalPackageTestIntegrationWithClock(t, time.Now)
	t.Cleanup(func() { _ = integration.Close() })

	inspectRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(signedPackage))
	inspectRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	inspectResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(inspectResponse, inspectRequest)
	if inspectResponse.Code != http.StatusOK {
		t.Fatalf("inspect official release package status = %d body=%s", inspectResponse.Code, inspectResponse.Body.String())
	}
	var inspectionEnvelope struct {
		OK   bool                           `json:"ok"`
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(inspectResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode official release inspection: %v body=%s", err, inspectResponse.Body.String())
	}
	inspection := inspectionEnvelope.Data
	if !inspectionEnvelope.OK || inspection.SignatureAssessment.State != string(registry.SignatureInvalid) ||
		inspection.ExecutionApproval.State != string(registry.ExecutionApprovalPolicyBlocked) {
		t.Fatalf("official release inspection = %#v", inspection)
	}

	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", map[string]string{
			"inspection_id":       inspection.InspectionID,
			"confirmation_digest": inspection.ConfirmationDigest,
		})
	if commitResponse.Code != http.StatusForbidden {
		t.Fatalf("commit official release package status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		OK    bool `json:"ok"`
		Error struct {
			Code            string `json:"code"`
			MutationOutcome string `json:"mutation_outcome"`
		} `json:"error"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil {
		t.Fatalf("decode blocked official release commit: %v body=%s", err, commitResponse.Body.String())
	}
	if commitEnvelope.OK || commitEnvelope.Error.Code != "PLUGIN_SIGNATURE_INVALID" ||
		commitEnvelope.Error.MutationOutcome != "not_committed" {
		t.Fatalf("blocked official release commit = %#v", commitEnvelope)
	}

	access.set(sessionPermissions{read: true, admin: true})
	catalogResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/catalog/query", map[string]any{})
	var catalogEnvelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Plugins []json.RawMessage `json:"plugins"`
		} `json:"data"`
	}
	if err := json.Unmarshal(catalogResponse.Body.Bytes(), &catalogEnvelope); err != nil {
		t.Fatalf("decode catalog after blocked official release commit: %v body=%s", err, catalogResponse.Body.String())
	}
	if catalogResponse.Code != http.StatusOK || !catalogEnvelope.OK || len(catalogEnvelope.Data.Plugins) != 0 {
		t.Fatalf("catalog after blocked official release commit status=%d response=%#v", catalogResponse.Code, catalogEnvelope)
	}
}

func TestExternalPackageHTTPPermissionTiers(t *testing.T) {
	integration, _, unsignedPackage, access := newExternalPackageTestIntegration(t)
	t.Cleanup(func() { _ = integration.Close() })

	access.set(sessionPermissions{admin: true})
	inspectRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
	inspectRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	inspectResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(inspectResponse, inspectRequest)
	if inspectResponse.Code != http.StatusOK {
		t.Fatalf("admin inspect status = %d body=%s", inspectResponse.Code, inspectResponse.Body.String())
	}
	var inspectionEnvelope struct {
		Data host.ExternalPackageInspection `json:"data"`
	}
	if err := json.Unmarshal(inspectResponse.Body.Bytes(), &inspectionEnvelope); err != nil {
		t.Fatalf("decode inspection: %v", err)
	}
	commitBody := map[string]string{
		"inspection_id":       inspectionEnvelope.Data.InspectionID,
		"confirmation_digest": inspectionEnvelope.Data.ConfirmationDigest,
	}

	for _, testCase := range []struct {
		name        string
		permissions sessionPermissions
	}{
		{name: "read only", permissions: sessionPermissions{read: true}},
		{name: "no access", permissions: sessionPermissions{}},
	} {
		t.Run(testCase.name+" rejects inspect", func(t *testing.T) {
			access.set(testCase.permissions)
			request := trustedExternalPackageRequest(t, http.MethodPost,
				"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
			request.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
			response := httptest.NewRecorder()
			integration.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("inspect status = %d body=%s", response.Code, response.Body.String())
			}
		})
		t.Run(testCase.name+" rejects commit", func(t *testing.T) {
			access.set(testCase.permissions)
			response := postExternalPackageJSON(t, integration,
				"/_redevplugin/api/plugins/external-packages/commit", commitBody)
			if response.Code != http.StatusForbidden {
				t.Fatalf("commit status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}

	access.set(sessionPermissions{admin: true})
	commitResponse := postExternalPackageJSON(t, integration,
		"/_redevplugin/api/plugins/external-packages/commit", commitBody)
	if commitResponse.Code != http.StatusOK {
		t.Fatalf("admin commit status = %d body=%s", commitResponse.Code, commitResponse.Body.String())
	}
	var commitEnvelope struct {
		Data externalPackageCommitHTTPResult `json:"data"`
	}
	if err := json.Unmarshal(commitResponse.Body.Bytes(), &commitEnvelope); err != nil ||
		commitEnvelope.Data.Receipt == nil || commitEnvelope.Data.Plugin == nil {
		t.Fatalf("decode committed package: err=%v body=%s", err, commitResponse.Body.String())
	}
	queryBody := map[string]string{
		"inspection_id": inspectionEnvelope.Data.InspectionID,
		"commit_id":     commitEnvelope.Data.Receipt.CommitID,
	}
	pluginBody := map[string]string{"plugin_instance_id": commitEnvelope.Data.Plugin.PluginInstanceID}

	access.set(sessionPermissions{read: true})
	for name, request := range map[string]struct {
		path string
		body any
	}{
		"commit query":            {path: "/_redevplugin/api/plugins/external-packages/commit/query", body: queryBody},
		"permission query":        {path: "/_redevplugin/api/plugins/permissions/query", body: pluginBody},
		"permission requirements": {path: "/_redevplugin/api/plugins/permissions/requirements/query", body: pluginBody},
	} {
		t.Run("read only permits "+name, func(t *testing.T) {
			response := postExternalPackageJSON(t, integration, request.path, request.body)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}

	access.set(sessionPermissions{})
	for name, request := range map[string]struct {
		path string
		body any
	}{
		"commit query":            {path: "/_redevplugin/api/plugins/external-packages/commit/query", body: queryBody},
		"permission query":        {path: "/_redevplugin/api/plugins/permissions/query", body: pluginBody},
		"permission requirements": {path: "/_redevplugin/api/plugins/permissions/requirements/query", body: pluginBody},
	} {
		t.Run("no access rejects "+name, func(t *testing.T) {
			response := postExternalPackageJSON(t, integration, request.path, request.body)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestExternalPackageCloseRemovesPendingArtifactBeforeClosingStage(t *testing.T) {
	integration, stateDir, unsignedPackage, _ := newExternalPackageTestIntegration(t)
	closed := false
	t.Cleanup(func() {
		if !closed {
			_ = integration.Close()
		}
	})

	uploadRequest := trustedExternalPackageRequest(t, http.MethodPost,
		"/_redevplugin/api/plugins/external-packages/upload/inspect", bytes.NewReader(unsignedPackage))
	uploadRequest.Header.Set("Content-Type", "application/vnd.redevplugin.package+zip")
	uploadResponse := httptest.NewRecorder()
	integration.Handler().ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusOK {
		t.Fatalf("inspect upload status = %d body=%s", uploadResponse.Code, uploadResponse.Body.String())
	}
	if artifacts := countExternalPackageStageArtifacts(t, stateDir); artifacts != 1 {
		t.Fatalf("pending stage artifacts = %d, want 1", artifacts)
	}
	if err := integration.Close(); err != nil {
		t.Fatalf("close integration with pending inspection: %v", err)
	}
	closed = true
	if artifacts := countExternalPackageStageArtifacts(t, stateDir); artifacts != 0 {
		t.Fatalf("stage artifacts after close = %d, want 0", artifacts)
	}
}

type externalPackageTestAccess struct {
	permissions sessionPermissions
}

func (a *externalPackageTestAccess) set(permissions sessionPermissions) {
	a.permissions = permissions
}

func newExternalPackageTestIntegration(t *testing.T) (*Integration, string, []byte, *externalPackageTestAccess) {
	integration, stateDir, _, access := newExternalPackageTestIntegrationWithClock(t, officialReleaseFixtureTime)
	return integration, stateDir, unsignedExternalPackageFixture(t), access
}

func newExternalPackageTestIntegrationWithClock(t *testing.T, now func() time.Time) (*Integration, string, []byte, *externalPackageTestAccess) {
	return newExternalPackageTestIntegrationWithClockAndOptions(t, now, nil)
}

func newExternalPackageTestIntegrationWithClockAndOptions(
	t *testing.T,
	now func() time.Time,
	configure func(*Options),
) (*Integration, string, []byte, *externalPackageTestAccess) {
	t.Helper()
	stateDir := t.TempDir()
	access := &externalPackageTestAccess{permissions: sessionPermissions{admin: true}}
	options := Options{
		StateDir:         stateDir,
		PermissionPolicy: testPermissionPolicy(t, "execute_read_write"),
		RuntimePath:      testRuntimePath(t, stateDir),
		Containers:       mustContainersAdapter(t, &capabilityEngineClient{}),
		releaseTrustNow:  now,
		ResolveSessionMeta: func(channelID string) (*session.Meta, bool) {
			if channelID != "ch_external" {
				return nil, false
			}
			permissions := access.permissions
			return &session.Meta{
				ChannelID: channelID, EndpointID: "env_external", UserPublicID: "user_external",
				CanRead: permissions.read, CanWrite: permissions.write,
				CanExecute: permissions.execute, CanAdmin: permissions.admin,
			}, true
		},
	}
	if configure != nil {
		configure(&options)
	}
	integration, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	signedPackage, err := os.ReadFile(filepath.Join("testdata", "containers-4.4.2.signed.redevplugin"))
	if err != nil {
		_ = integration.Close()
		t.Fatal(err)
	}
	return integration, stateDir, signedPackage, access
}

func catalogContainersPackageURL(t *testing.T) string {
	t.Helper()
	return "https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.2/containers-4.4.2.redevplugin"
}

func unsignedExternalPackageFixture(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "containers-4.4.2.signed.redevplugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := pluginpkg.Read(context.Background(), bytes.NewReader(raw), int64(len(raw)), pluginpkg.DefaultReadLimits())
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(pkg.Files["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["schema_version"] = "redevplugin.manifest.v8"
	plugin := manifest["plugin"].(map[string]any)
	plugin["ui_protocol_version"] = "plugin-ui-v7"
	manifest["presentation"] = map[string]any{
		"default_locale": "en-US", "summary": "Manage containers.",
		"description": []string{"Manage containers."}, "highlights": []string{"Inspect and operate containers."},
		"keywords": []string{"containers", "docker"}, "localizations": []any{},
	}
	updated, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Files["manifest.json"] = updated
	if err := json.Unmarshal(updated, &pkg.Manifest); err != nil {
		t.Fatal(err)
	}
	pkg.PackageHash, pkg.ManifestHash, pkg.EntriesHash = "", "", ""
	pkg.PackageSignature, pkg.SignatureFiles = nil, nil
	var output bytes.Buffer
	if err := pluginpkg.WritePackage(context.Background(), &output, pkg); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func postExternalPackageJSON(t *testing.T, integration *Integration, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := trustedExternalPackageRequest(t, http.MethodPost, path, bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	integration.Handler().ServeHTTP(response, request)
	return response
}

func countExternalPackageStageArtifacts(t *testing.T, stateDir string) int {
	t.Helper()
	count := 0
	err := filepath.WalkDir(filepath.Join(stateDir, "apps", "redevplugin"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".artifact") &&
			strings.Contains(filepath.ToSlash(path), "/external-package-stage/") {
			count++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func trustedExternalPackageRequest(t *testing.T, method, path string, body *bytes.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	req.Header.Set(sessionhop.HeaderChannelID, "ch_external")
	req.Header.Set("Origin", "https://env.example.test")
	req.Header.Set(csrfHeader, csrfProof)
	req.Host = "env.example.test"
	req = WithRouteRole(req, RouteRoleEnvTrusted)
	var err error
	req, err = WithTrustedOrigin(req, "https://env.example.test")
	if err != nil {
		t.Fatal(err)
	}
	return req
}
