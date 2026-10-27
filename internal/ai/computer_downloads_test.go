package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestComputerDownloadHandoffUsesTaskScratchAndCleansPartialFiles(t *testing.T) {
	for _, mode := range []string{"complete", "read_failure", "cancelled", "changed_identity", "invalid_bytes", "wrong_offset", "wrong_length", "wrong_next", "wrong_size", "changed_size", "missing_size"} {
		t.Run(mode, func(t *testing.T) {
			r := &run{stateDir: t.TempDir(), threadID: "task"}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			calls := 0
			saved, err := r.saveComputerDownload(ctx, func(_ context.Context, offset int) (map[string]any, error) {
				calls++
				if calls == 2 {
					switch mode {
					case "read_failure":
						return nil, errors.New("source unavailable")
					case "cancelled":
						cancel()
					}
				}
				id := "exact-source-id"
				if mode == "changed_identity" && calls == 2 {
					id = "other"
				}
				content := base64.StdEncoding.EncodeToString([]byte("abc"))
				if mode == "invalid_bytes" {
					content = "%%%"
				}
				chunk := map[string]any{"id": id, "filename": "../../personal.csv", "base64": content, "truncated": calls == 1, "offset": offset, "bytes": 3, "next_offset": offset + 3, "size_bytes": 6}
				switch mode {
				case "wrong_offset":
					chunk["offset"] = offset + 1
				case "wrong_length":
					chunk["bytes"] = 2
				case "wrong_next":
					chunk["next_offset"] = 100
				case "wrong_size":
					chunk["size_bytes"] = 7
				case "changed_size":
					if calls == 2 {
						chunk["size_bytes"] = 5
					}
				case "missing_size":
					if calls == 2 {
						delete(chunk, "size_bytes")
					}
				}
				return chunk, nil
			})
			space, e := prepareTaskFiles(r.stateDir, r.threadID)
			if e != nil {
				t.Fatal(e)
			}
			files, e := os.ReadDir(space.Scratch)
			if e != nil {
				t.Fatal(e)
			}
			if mode == "complete" {
				if err != nil {
					t.Fatal(err)
				}
				path := anyToString(saved["path"])
				if filepath.Dir(path) != space.Scratch || len(files) != 1 {
					t.Fatal("download escaped task scratch")
				}
				data, e := os.ReadFile(path)
				if e != nil || string(data) != "abcabc" {
					t.Fatal("download bytes changed", e)
				}
			} else if err == nil || len(files) != 0 {
				t.Fatalf("partial file escaped cleanup: %v %+v", err, files)
			}
		})
	}
}

func TestComputerDownloadReadAndSaveHaveDistinctEffectContracts(t *testing.T) {
	if !slices.Equal(requiredTargetCapabilities("browser.save_download"), []string{"interaction"}) {
		t.Fatal("saving must require interaction capability")
	}
	if computerCallMutates(TargetToolCall{ToolName: "browser.read_download"}) || !computerCallMutates(TargetToolCall{ToolName: "browser.save_download"}) {
		t.Fatal("download effect classification")
	}
	if _, err := computerScriptOperation(TargetToolCall{}, map[string]any{"action": "save_download", "id": "known", "target": "forged"}); err == nil {
		t.Fatal("guest forged target")
	}
}

func TestComputerDownloadRuntimeFailureKeepsTargetAndCleansPartialFiles(t *testing.T) {
	for _, mode := range []string{"complete", "invalid_content", "source_failure", "cancelled", "revoked", "local_io"} {
		t.Run(mode, func(t *testing.T) {
			host, _, store, _ := computerBindingFixture(t)
			target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", Ready: true, State: "ready"}
			if err := host.registry.Update(target); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(computerPermissionContext(t, "approval_required"))
			defer cancel()
			if err := store.SetComputerAccess(ctx, "thread-first", ComputerAccess{Origins: []string{"https://fixture.test"}}); err != nil {
				t.Fatal(err)
			}
			owner := &run{stateDir: t.TempDir(), threadID: "thread-first"}
			if mode == "local_io" {
				owner.stateDir = filepath.Join(owner.stateDir, "not-a-directory")
				if err := os.WriteFile(owner.stateDir, []byte("fixture"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			reads := 0
			host.executors[target.ID] = scriptTestExecutor{func(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
				reads++
				if call.ToolName != "browser.read_download" {
					t.Fatalf("unexpected dispatch %s", call.ToolName)
				}
				if !slices.Contains(call.allowedOrigins, "https://fixture.test") {
					return TargetToolResult{Safety: &InteractionSafetyDecision{Level: "takeover", RequiredOrigin: "https://fixture.test"}}, nil
				}
				if mode == "source_failure" && reads == 2 {
					return TargetToolResult{}, errors.New("fixture download reader failed")
				}
				var input struct{ Offset int }
				if err := json.Unmarshal(call.Arguments, &input); err != nil {
					t.Fatal(err)
				}
				data := map[string]any{"id": "exact", "filename": "report.csv", "base64": "YWJj", "offset": input.Offset, "bytes": 3, "size_bytes": 6, "truncated": reads == 1, "next_offset": input.Offset + 3}
				if mode == "invalid_content" {
					data["bytes"] = 4
				}
				if mode == "cancelled" {
					cancel()
				}
				if mode == "revoked" && reads == 1 {
					if err := store.SetComputerAccess(ctx, "thread-first", ComputerAccess{}); err != nil {
						t.Fatal(err)
					}
				}
				return TargetToolResult{TargetID: target.ID, Result: data}, nil
			}}
			call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", TargetID: target.ID, ToolName: "browser.save_download", Arguments: json.RawMessage(`{"id":"exact"}`), downloadWriter: owner.saveComputerDownload}
			result, err := host.ExecuteTargetTool(ctx, call)
			if (mode == "complete") != (err == nil) {
				t.Fatalf("result %+v error %v", result, err)
			}
			if mode == "cancelled" && (!errors.Is(err, context.Canceled) || reads != 1) {
				t.Fatalf("cancellation: reads=%d err=%v", reads, err)
			}
			if mode == "revoked" && (!takeoverResult(result, err) || reads != 2) {
				t.Fatalf("revocation was ignored: reads=%d err=%v", reads, err)
			}
			current, _ := host.registry.ResolveTarget(t.Context(), target.ID)
			if !current.Ready || current.State != "ready" {
				t.Fatalf("file transfer failure retired browser: %+v", current)
			}
			if mode != "complete" {
				facts, _ := result.Result.(map[string]any)
				if facts["action_executed"] != false || facts["path"] != nil {
					t.Fatalf("uncommitted file reported: %+v", facts)
				}
			}
			if mode != "local_io" {
				space, e := prepareTaskFiles(owner.stateDir, owner.threadID)
				if e != nil {
					t.Fatal(e)
				}
				files, e := os.ReadDir(space.Scratch)
				if e != nil || (mode == "complete" && len(files) != 1) || (mode != "complete" && len(files) != 0) {
					t.Fatalf("partial files: %+v %v", files, e)
				}
			}
		})
	}
}
