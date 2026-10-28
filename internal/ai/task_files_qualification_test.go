package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

func TestE2E_FlowerTaskFilesDeepSeek(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_TASK_FILES_E2E") != "1" {
		t.Skip("explicit local DeepSeek qualification")
	}
	sourceRoot := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	sourceHashes := map[string][32]byte{}
	for _, name := range []string{"config.json", "secrets.json"} {
		b, e := os.ReadFile(filepath.Join(sourceRoot, name))
		if e != nil {
			t.Fatal(e)
		}
		sourceHashes[name] = sha256.Sum256(b)
	}
	t.Cleanup(func() {
		for name, want := range sourceHashes {
			b, e := os.ReadFile(filepath.Join(sourceRoot, name))
			if e != nil || sha256.Sum256(b) != want {
				t.Errorf("source profile changed: %s", name)
			}
		}
	})

	source, err := config.Load(filepath.Join(sourceRoot, "config.json"))
	if err != nil || source.AI == nil {
		t.Fatalf("source profile unavailable: %v", err)
	}
	var p config.AIProvider
	var model config.AIProviderModel
	for _, candidate := range source.AI.Providers {
		if candidate.Type == "deepseek" {
			for _, m := range candidate.EffectiveModels() {
				if m.ModelName == "deepseek-flash" {
					if p.ID != "" {
						t.Fatal("ambiguous DeepSeek provider")
					}
					p, model = candidate, m
				}
			}
		}
	}
	if p.ID == "" || model.ContextWindow == 0 || model.EffectiveWireModelName() != "deepseek-flash" || !strings.Contains(model.DisplayName, "4.1") || !strings.Contains(model.DisplayName, "1017") {
		t.Fatal("configured DeepSeek Flash required")
	}
	key, found, err := settings.NewSecretsStore(filepath.Join(sourceRoot, "secrets.json")).GetAIProviderAPIKey(p.ID)
	if err != nil || !found || key == "" {
		t.Fatal("configured credential unavailable")
	}
	root := os.Getenv("REDEVEN_FLOWER_TASK_FILES_REPORT_DIR")
	if root == "" {
		t.Fatal("report directory required")
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(root, "workspace")
	if err = os.Mkdir(work, 0700); err != nil {
		t.Fatal("fresh qualification directory required")
	}
	home := filepath.Join(root, "home")
	if err = os.Mkdir(home, 0700); err != nil {
		t.Fatal(err)
	}
	recorder := &deepSeekContextRecorder{markers: []string{"Task scratch directory:", "helper scripts", "FLOWER_SCRATCH_DIR"}}
	p.BaseURL = newDeepSeekRecordingProxy(t, p.BaseURL, recorder)
	p.ModelSelection = nil
	p.Models = []config.AIProviderModel{model}
	modelID := p.ID + "/" + model.ModelName
	opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(root, "state"), AgentHomeDir: home, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{p}}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == p.ID, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if svc != nil {
			_ = svc.Close()
		}
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Minute)
	defer cancel()
	meta := testSendTurnMeta()
	report := map[string]any{"model": model.ModelName, "wire_model": model.EffectiveWireModelName(), "provider_id": p.ID, "display_model": model.DisplayName}
	defer func() {
		report["passed"] = !t.Failed()
		report["requests"] = recorder.snapshot()
		saveCompactionQualificationJSON(t, filepath.Join(root, "report.json"), report)
	}()
	thread, err := svc.CreateThread(ctx, meta, "Task file qualification", modelID, config.AIPermissionFullAccess, work)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		t.Fatal(err)
	}
	uploadScope, err := svc.CreateUploadStagingScope(ctx, owner, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	const csv = "amount\n4\n8\n15\n"
	const uploadName = "source.csv"
	upload, err := svc.SaveUpload(ctx, SaveUploadRequest{Owner: owner, StagingScopeID: uploadScope.StagingScopeID, StagingCapability: uploadScope.Capability, Reader: strings.NewReader(csv), DisplayName: uploadName, UploadRequestID: "source-csv", ExpectedContentSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(csv))), ExpectedSizeBytes: int64(len(csv)), DisplayNameSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(uploadName)))})
	if err != nil {
		t.Fatal(err)
	}
	send := func(id, threadID, input string) {
		t.Helper()
		request := SendUserTurnRequest{StorageGeneration: svc.storageGeneration, ThreadID: threadID, ClientRequestID: id, Input: RunInput{Text: input}, Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, MaxOutputTokens: 6000, NoUserInteraction: true, ToolAllowlist: []string{"terminal.exec", "terminal.read", "file.write", "file.edit", "file.present", "attachment.read", "attachment.materialize"}}}
		if id == "report" {
			request.StagingScopeID = uploadScope.StagingScopeID
			request.StagingCapability = uploadScope.Capability
			request.Input.Attachments = []RunAttachmentIn{{AttachmentID: upload.AttachmentID}}
		}
		response, e := svc.SendUserTurn(ctx, meta, request)
		if e != nil {
			t.Fatal(e)
		}
		detail := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, threadID, func(d *FlowerThreadDetail) bool {
			return d.Current.TurnID.String() == response.TurnID && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
		})
		if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
			code, hash, classes := safeDeepSeekFailureFingerprint(detail.Current.Failure)
			t.Fatalf("turn %s failed %s %s %v", id, code, hash, classes)
		}
		saveCompactionQualificationJSON(t, filepath.Join(root, "turn-"+id+".json"), detail)
	}
	send("report", thread.ThreadID, "Create a self-contained HTML report named report.html in the selected project directory. Use attachment.materialize to obtain a working copy of the attached source.csv, then use a short helper script to calculate its sum. Include the computed total in the final report. Keep the helper and intermediate data for a follow-up. Present the report and provide its link.")
	files, err := svc.GetTaskFiles(ctx, meta, thread.ThreadID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(files.Files) != 1 || filepath.Base(files.Files[0].FilePath) != "report.html" || files.Files[0].Status != "available" {
		t.Fatalf("deliveries=%+v", files)
	}
	for _, request := range recorder.snapshot() {
		if request.Kind == "main" && (len(request.MarkerPresence) != 3 || !request.MarkerPresence[0] || !request.MarkerPresence[1] || !request.MarkerPresence[2]) {
			t.Fatalf("task paths absent from provider request: %+v", request.MarkerPresence)
		}
	}
	entries, err := os.ReadDir(work)
	if err != nil || len(entries) != 1 || entries[0].Name() != "report.html" {
		t.Fatalf("unexpected project intermediates: %+v %v", entries, err)
	}
	if files.WorkingFiles < 2 {
		t.Fatalf("expected helper and intermediate data: %+v", files)
	}
	for _, file := range files.Files {
		if file.ThreadID != thread.ThreadID || file.RunID == "" || file.TurnID == "" || file.EndpointID != meta.EndpointID {
			t.Fatal("incomplete canonical file identity")
		}
	}
	space, err := prepareTaskFiles(svc.stateDir, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	send("followup", thread.ThreadID, "Reuse your saved helper or intermediate CSV. Create summary.txt in the project directory containing the same total 27. Present it with its link. Keep the HTML report unchanged.")
	files, err = svc.GetTaskFiles(ctx, meta, thread.ThreadID, "")
	if err != nil || len(files.Files) != 2 {
		t.Fatalf("followup deliveries %d %v", len(files.Files), err)
	}
	send("explicit-destination", thread.ThreadID, "Reuse the saved CSV. Run the calculation with the task scratch directory as the command working directory. Save the final details.txt containing 27 in docs/ under the selected project directory, not the command working directory. Present that final file. Keep the earlier report and summary unchanged.")
	if b, e := os.ReadFile(filepath.Join(work, "docs", "details.txt")); e != nil || !strings.Contains(string(b), "27") {
		t.Fatal("explicit destination not honored", e)
	}
	entries, err = os.ReadDir(work)
	if err != nil || len(entries) != 3 {
		t.Fatal("project polluted after changing command cwd", err)
	}
	fork, err := svc.ForkThreadWithOptions(ctx, meta, thread.ThreadID, ForkThreadRequest{ClientRequestID: "files-fork", Title: "Files fork"})
	if err != nil {
		t.Fatal(err)
	}
	forkFiles, err := svc.GetTaskFiles(ctx, meta, fork.ThreadID, "")
	if err != nil || len(forkFiles.Files) != 3 || forkFiles.WorkingPath == space.Root {
		t.Fatalf("fork files %+v %v", forkFiles, err)
	}
	childSpace, err := taskFiles(svc.stateDir, fork.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	beforeParent := map[string][32]byte{}
	if err = filepath.WalkDir(space.Root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		bytes, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		beforeParent[path] = sha256.Sum256(bytes)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	send("fork-followup", fork.ThreadID, "Continue from the saved calculation. Use the existing CSV and helper to create fork-summary.txt in the project containing total 27. Do not recreate the input data or alter the earlier deliverables. Present the new file and its link.")
	if bytes, e := os.ReadFile(filepath.Join(work, "fork-summary.txt")); e != nil || !strings.Contains(string(bytes), "27") {
		t.Fatal("fork failed to continue from copied work", e)
	}
	for path, want := range beforeParent {
		bytes, e := os.ReadFile(path)
		if e != nil || sha256.Sum256(bytes) != want {
			t.Fatal("fork changed source working files", e)
		}
	}
	if _, e := os.Stat(childSpace.Scratch); e != nil {
		t.Fatal("fork scratch absent", e)
	}
	nested, err := svc.ForkThreadWithOptions(ctx, meta, fork.ThreadID, ForkThreadRequest{ClientRequestID: "files-nested-fork", Title: "Nested files fork"})
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = nil
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	files, err = svc.GetTaskFiles(ctx, meta, thread.ThreadID, "")
	if err != nil || len(files.Files) != 3 {
		t.Fatalf("restart %v", err)
	}
	if err = os.WriteFile(filepath.Join(work, "summary.txt"), []byte("changed by user"), 0600); err != nil {
		t.Fatal(err)
	}
	files, err = svc.GetTaskFiles(ctx, meta, thread.ThreadID, "")
	if err != nil {
		t.Fatal(err)
	}
	changed := false
	for _, f := range files.Files {
		if f.Name == "summary.txt" {
			changed = f.Status == "changed"
		}
	}
	if !changed {
		t.Fatal("user modification not visible")
	}
	if err = svc.CleanTaskFiles(ctx, meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"report.html", "summary.txt"} {
		if _, err = os.Stat(filepath.Join(work, name)); err != nil {
			t.Fatal("cleanup deleted final file", err)
		}
	}
	if err = svc.DeleteThread(ctx, meta, thread.ThreadID, false); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(work, "report.html")); err != nil {
		t.Fatal("thread deletion deleted final file", err)
	}
	forkFiles, err = svc.GetTaskFiles(ctx, meta, fork.ThreadID, "")
	if err != nil || len(forkFiles.Files) != 4 {
		t.Fatal("fork lost canonical files", err)
	}
	send("fork-after-delete", fork.ThreadID, "Continue using your saved calculation files after the restart. Create fork-after-restart.txt in the project with the same total 27. Reuse the existing input file, keep other deliverables unchanged, and present the new result.")
	if bytes, e := os.ReadFile(filepath.Join(work, "fork-after-restart.txt")); e != nil || !strings.Contains(string(bytes), "27") {
		t.Fatal("fork failed after parent deletion/restart", e)
	}
	if err = svc.CleanTaskFiles(ctx, meta, fork.ThreadID); err != nil {
		t.Fatal(err)
	}
	send("nested-after-clean", nested.ThreadID, "Reuse the inherited calculation files to create nested-summary.txt in the project containing total 27. Do not recreate the input data. Keep existing final files unchanged and present the new file.")
	if bytes, e := os.ReadFile(filepath.Join(work, "nested-summary.txt")); e != nil || !strings.Contains(string(bytes), "27") {
		t.Fatal("nested fork failed after ancestor cleanup", e)
	}
	nestedFiles, e := svc.GetTaskFiles(ctx, meta, nested.ThreadID, "")
	if e != nil || len(nestedFiles.Files) != 5 {
		t.Fatal("nested delivery history is not pinned to fork", e)
	}
	report["nested_final_files"] = nestedFiles
	send("recover-input", fork.ThreadID, "Your working files have been cleaned. Use attachment.materialize to obtain a fresh working copy of the original uploaded source.csv from the inherited conversation. Calculate its sum from that file and save recovered.txt in the project. Do not recreate the input from remembered numbers. Present the result and keep earlier outputs unchanged.")
	if body, e := os.ReadFile(filepath.Join(work, "recovered.txt")); e != nil || !strings.Contains(string(body), "27") {
		t.Fatal("failed to reprocess retained input", e)
	}
	original, e := svc.openCanonicalLiveAttachment(ctx, owner, fork.ThreadID, upload.AttachmentID)
	if e != nil {
		t.Fatal(e)
	}
	if body, e := os.ReadFile(original.Upload.FilePath); e != nil || string(body) != csv {
		t.Fatal("original input mutated", e)
	}
	materials, e := svc.GetTaskMaterials(ctx, meta, fork.ThreadID, "")
	if e != nil {
		t.Fatal(e)
	}
	report["retained_materials"] = materials
	report["input_preserved_after_parent_deletion_and_child_cleanup"] = true
	toolCalls := map[string]int{}
	for _, id := range []string{"report", "recover-input"} {
		body, e := os.ReadFile(filepath.Join(root, "turn-"+id+".json"))
		if e != nil {
			t.Fatal(e)
		}
		var detail FlowerThreadDetail
		if e := json.Unmarshal(body, &detail); e != nil {
			t.Fatal(e)
		}
		for _, item := range detail.Current.Items {
			if item.TurnID == detail.Current.TurnID && item.Activity != nil && item.Activity.ToolName == "attachment.materialize" {
				toolCalls[id]++
			}
		}
		if toolCalls[id] == 0 {
			t.Fatalf("turn %s did not materialize the original", id)
		}
	}
	report["materialize_calls_by_turn"] = toolCalls

	report["assertions"] = []string{"project contains final files only", "explicit docs destination survives scratch command cwd", "scratch helper retained across turns", "final file.present provenance", "fork isolated scratch and retained history", "restart retained delivery references", "user changes visible", "scratch cleanup preserves deliverables", "thread deletion preserves deliverables", "model continues from inherited files after fork", "fork writes preserve source files", "model continues after restart and parent deletion", "nested fork continues after ancestor cleanup"}
	report["final_files"] = forkFiles
	for _, request := range recorder.snapshot() {
		if request.Model != "" && !strings.Contains(request.Model, "deepseek-flash") {
			t.Fatal(fmt.Sprintf("unexpected model %s", request.Model))
		}
	}
	encoded, _ := json.Marshal(report)
	if len(encoded) == 0 {
		t.Fatal("missing report")
	}
}
