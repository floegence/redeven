package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func applicationProtocolFixture(t *testing.T, count int) (*ComputerUseRuntime, TargetToolCall, ComputerCandidate, string) {
	t.Helper()
	host, _, _, _ := computerBindingFixture(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	marker := filepath.Join(directory, "launches")
	windows := []TargetDescriptor{}
	for i := 0; i < count; i++ {
		windows = append(windows, TargetDescriptor{ID: "macos-window-" + strings.Repeat("a", i+1), Kind: "desktop.window", AppBundleID: "dev.fixture", DisplayName: "Fixture", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}})
	}
	encoded, _ := json.Marshal(windows)
	pathJSON, _ := json.Marshal(marker)
	script := `import readline from 'node:readline'; import {appendFileSync} from 'node:fs';
if(process.argv.includes('--capabilities')){console.log(JSON.stringify({protocol_version:4,screen_recording:true,accessibility:true}));process.exit(0);}
const windows=` + string(encoded) + `;
for await(const line of readline.createInterface({input:process.stdin})){const r=JSON.parse(line);let payload={};
 if(r.tool_name==='computer.targets')payload={targets:windows};
 if(r.tool_name==='computer.applications')payload={applications:[{id:'macos-fixture',display_name:'Fixture',app_bundle_id:'dev.fixture',state:'not_running'}]};
 if(r.tool_name==='computer.open_application'){appendFileSync(` + string(pathJSON) + `, 'launch');payload={targets:windows,action_executed:true};}
 console.log(JSON.stringify({type:'result',request_id:r.request_id,target_id:r.target_id,payload}));}
`
	file := filepath.Join(directory, "helper.mjs")
	if err = os.WriteFile(file, []byte("#!"+node+"\n"+script), 0700); err != nil {
		t.Fatal(err)
	}
	native := NewNativeDesktopTargetExecutor(file)
	host.executors["desktop-main"] = native
	candidate, err := host.rememberComputerCandidate("thread-first", ComputerCandidate{ApplicationID: "macos-fixture", Kind: "desktop.application", DisplayName: "Fixture", AppBundleID: "dev.fixture", State: "not_running"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return host, TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", ToolName: "computer.select_target"}, candidate, marker
}

func TestComputerApplicationSelectionUsesExactCandidateAndReportsWindows(t *testing.T) {
	for _, count := range []int{0, 1, 2} {
		t.Run(string(rune('0'+count)), func(t *testing.T) {
			host, call, candidate, marker := applicationProtocolFixture(t, count)
			target, err := host.SelectComputerCandidate(computerPermissionContext(t, "full_access"), call, candidate.CandidateRef, ToolTargetPolicy{})
			if count == 1 {
				if err != nil || target.ID != "macos-window-a" {
					t.Fatalf("selection: %+v %v", target, err)
				}
			} else {
				var choice *computerApplicationSelection
				if !errors.As(err, &choice) || len(choice.candidates) != count {
					t.Fatalf("ambiguous/no window: %+v %v", target, err)
				}
			}
			data, e := os.ReadFile(marker)
			if e != nil || string(data) != "launch" {
				t.Fatal("launch must occur exactly once", e)
			}
			bound, _ := host.targetBindings().GetComputerTarget(t.Context(), call.ThreadID)
			if (count == 1) != (bound != "") {
				t.Fatal("unresolved application changed binding")
			}
		})
	}
}

func TestComputerApplicationLaunchRequiresGrantsAndDoesNotStealTargets(t *testing.T) {
	for _, kind := range []string{"permission", "policy", "other_thread", "same_thread_other_run", "paused", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			host, call, candidate, marker := applicationProtocolFixture(t, 1)
			ctx := computerPermissionContext(t, "full_access")
			policy := ToolTargetPolicy{}
			switch kind {
			case "permission":
				ctx = computerPermissionContext(t, "approval_required")
			case "policy":
				policy.AllowedTargetIDs = []string{"browser-main"}
			case "other_thread", "same_thread_other_run", "paused":
				target := TargetDescriptor{ID: "occupied", Kind: "desktop.window", AppBundleID: "dev.fixture", Ready: true}
				if err := host.registry.Register(target); err != nil {
					t.Fatal(err)
				}
				control := host.controlForTarget(target.ID)
				control.threadID = "thread-second"
				control.runID = "other"
				if kind != "other_thread" {
					control.threadID = call.ThreadID
				}
				if kind == "paused" {
					control.runID = call.RunID
					control.pauseForUser()
				}
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			if _, err := host.SelectComputerCandidate(ctx, call, candidate.CandidateRef, policy); err == nil {
				t.Fatal("unsafe launch admitted")
			}
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatal("rejected launch reached helper")
			}
		})
	}
}

func TestComputerApplicationDiscoveryIsReadOnly(t *testing.T) {
	host, call, _, marker := applicationProtocolFixture(t, 0)
	call.ToolName = "computer.targets"
	call.Arguments = json.RawMessage(`{"application":"Fixture"}`)
	result, err := host.ComputerTargets(computerPermissionContext(t, "full_access"), call, ToolTargetPolicy{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].ApplicationID != "macos-fixture" || result.Candidates[0].TargetID != "" {
		t.Fatalf("invalid discovery %+v", result)
	}
	if _, err = os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("discovery launched application")
	}
}

func TestComputerApplicationSelectionRetainsLaunchAfterLateAuthorizationFailure(t *testing.T) {
	host, call, candidate, marker := applicationProtocolFixture(t, 1)
	denied := errors.New("fixture authorization revoked after launch")
	call.revalidate = func(context.Context) error {
		if _, err := os.Stat(marker); err == nil {
			return denied
		}
		return nil
	}
	_, err := host.SelectComputerCandidate(computerPermissionContext(t, "full_access"), call, candidate.CandidateRef, ToolTargetPolicy{})
	var launched *computerApplicationSelection
	if !errors.As(err, &launched) || !errors.Is(err, denied) || launched.state != "selection_failed" || len(launched.candidates) != 1 {
		t.Fatalf("confirmed launch was lost: %v", err)
	}
	bound, err := host.targetBindings().GetComputerTarget(t.Context(), call.ThreadID)
	if err != nil || bound != "" {
		t.Fatalf("failed selection changed binding: %s %v", bound, err)
	}
	data, err := os.ReadFile(marker)
	if err != nil || string(data) != "launch" {
		t.Fatalf("launch repeated: %s %v", data, err)
	}
}

func TestComputerApplicationPermissionIdentifiesRequiredAppAndForeground(t *testing.T) {
	host, call, candidate, marker := applicationProtocolFixture(t, 1)
	_, err := host.SelectComputerCandidate(computerPermissionContext(t, "approval_required"), call, candidate.CandidateRef, ToolTargetPolicy{})
	var denied *targetToolPolicyError
	if !errors.As(err, &denied) || denied.safety == nil || denied.safety.RequiredApp != "dev.fixture" || len(denied.safety.ReasonCodes) != 1 || denied.safety.ReasonCodes[0] != "foreground_permission" {
		t.Fatalf("permission recovery is not actionable: %v", err)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("denied launch reached helper")
	}
}
