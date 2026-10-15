package ai

import (
	flruntime "github.com/floegence/floret/v7/runtime"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func modelContextSnapshotText(snapshot *flruntime.ModelContextSnapshot) string {
	if snapshot == nil {
		return ""
	}
	var out strings.Builder
	for _, section := range snapshot.Sections {
		out.WriteString(section.Text)
		out.WriteString("\n")
	}
	return out.String()
}
func writeContextTestSkill(t *testing.T, root, description string) {
	t.Helper()
	path := filepath.Join(root, ".redeven", "skills", "complete-context")
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "SKILL.md"), []byte("---\nname: complete-context\ndescription: "+description+"\n---\nSkill body.\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestFlowerRuntimeContextRejectsOverflowWithoutClipping(t *testing.T) {
	root := t.TempDir()
	description := strings.Repeat("完整上下文", 4000) + "END_OF_CATALOG"
	writeContextTestSkill(t, root, description)
	mgr := newSkillManager(root, root)
	mgr.userHome = root
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root, SkillManager: mgr})
	item, err := r.collectModelContextSnapshot(t.Context(), FlowerPermissionApprovalRequired, time.Now)
	if err != nil || !strings.Contains(modelContextSnapshotText(item), description) {
		t.Fatalf("valid context beyond the old limit was clipped: %v", err)
	}
	assertPromptNotContains(t, modelContextSnapshotText(item), "Use use_skill")
	assertPromptNotContains(t, modelContextSnapshotText(item), "Tool approval policy:")
	writeContextTestSkill(t, root, strings.Repeat("界", 65_000))
	item, err = r.collectModelContextSnapshot(t.Context(), FlowerPermissionApprovalRequired, time.Now)
	if err == nil || modelContextSnapshotText(item) != "" || !strings.Contains(err.Error(), "cannot be admitted") {
		t.Fatalf("overflow must reject the whole context: %+v, %v", item, err)
	}
}

func TestFlowerContextRejectionReleasesAdmissionAndAllowsCorrectedRetry(t *testing.T) {
	svc := newRealtimeTestService(t, 10*time.Millisecond)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "context rejection", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	var admitted, released atomic.Int32
	svc.SetWorkloadAdmission(func(workload runtimeservice.ManagedWorkload) (func(), error) {
		admitted.Add(1)
		return func() { released.Add(1) }, nil
	})
	svc.skillManager.userHome = svc.agentHomeDir
	writeContextTestSkill(t, svc.agentHomeDir, strings.Repeat("界", 65_000))
	req := SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "correctable-context", Input: RunInput{Text: "Analyze the supplied prompt without changing files."}}
	_, err = svc.SendUserTurn(t.Context(), meta, req)
	if err == nil || !strings.Contains(err.Error(), "cannot be admitted") {
		t.Fatalf("expected context admission rejection, got %v", err)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(view.Items) != 0 || len(view.Queue) != 0 || len(view.Interactions) != 0 {
		t.Fatalf("rejected context changed canonical conversation: %+v, %v", view, err)
	}
	svc.typedSendMu.Lock()
	pending := len(svc.typedSendOps)
	svc.typedSendMu.Unlock()
	if pending != 0 || admitted.Load() != 1 || released.Load() != 1 {
		t.Fatalf("rejection leaked busy state: pending=%d admitted=%d released=%d", pending, admitted.Load(), released.Load())
	}
	authority, err := svc.snapshotThreadStore().GetExecutionAuthority(t.Context(), req.ClientRequestID)
	if err != nil || authority != nil {
		t.Fatalf("invalid input acquired execution authority: %+v, %v", authority, err)
	}
	writeContextTestSkill(t, svc.agentHomeDir, "Corrected context")
	req.Input.Text = "Analyze the supplied prompt with corrected context."
	response, err := svc.SendUserTurn(t.Context(), meta, req)
	if err != nil || response.Kind != "start" {
		t.Fatalf("same request could not be corrected: %+v, %v", response, err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
}
