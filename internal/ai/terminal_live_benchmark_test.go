package ai

import (
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

// Opt-in measured experiment. The same file is compiled against both immutable
// source revisions; ordinary tests never spend provider tokens. Each invocation
// owns a fresh service and fixture, and retains failed trials in its report.
func TestE2E_TerminalControlledBenchmark(t *testing.T) {
	if os.Getenv("FLOWER_TERMINAL_BENCH") != "1" {
		t.Skip("explicit live benchmark only")
	}
	root, name := os.Getenv("FLOWER_TERMINAL_BENCH_REPORT"), os.Getenv("FLOWER_TERMINAL_BENCH_CASE")
	if root == "" || name == "" {
		t.Fatal("fresh report root and case required")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(root, "workspace")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	fixture := `import sys,time,hashlib,json,pathlib,sqlite3,subprocess,concurrent.futures
mode=sys.argv[1]
def record(label):
    with open('executions.jsonl','a') as f: f.write(json.dumps({'label':label,'at':time.time()})+'\n')
def done(label,value):
    pathlib.Path(label+'.done').write_text(str(value))
    print(label+'='+str(value),flush=True)
record(mode)
if mode in ('short','medium','long','a','b','c'):
    time.sleep({'short':0.2,'medium':8,'long':35,'a':8,'b':8,'c':8}[mode])
    done(mode,hashlib.sha256((mode*10000).encode()).hexdigest()[:16])
elif mode=='verbose':
    for i in range(700): print('%04d 中文🪷 %s'%(i,'x'*24))
    done(mode,'PAGINATION_COMPLETE_7319')
elif mode=='prepare':
    time.sleep(2); pathlib.Path('data.json').write_text(json.dumps(list(range(10000)))); done(mode,10000)
elif mode=='aggregate':
    x=json.loads(pathlib.Path('data.json').read_text()); time.sleep(8); done(mode,sum(v*v for v in x))
elif mode=='interactive':
    a=input('first integer: '); b=input('second integer: '); done(mode,int(a)*int(b))
elif mode=='failure':
    print('EXPECTED_EXIT_17',flush=True); sys.exit(17)
elif mode=='cpu':
    value=hashlib.pbkdf2_hmac('sha256',b'controlled',b'flower',2500000).hex()
    time.sleep(4); done(mode,value)
elif mode=='sqlite':
    db=sqlite3.connect('fixture.sqlite'); db.execute('create table records(k integer,v integer)')
    db.executemany('insert into records values(?,?)',((i,i*i%10007) for i in range(120000)))
    db.commit(); time.sleep(12)
    result=db.execute('select sum(v) from records where k%7=0').fetchone()[0]
    db.close();done(mode,result)
elif mode=='pipeline':
    for i in range(80):
        pathlib.Path('part-%03d.txt'%i).write_text(''.join('%d,%d\n'%(j,j*j%997) for j in range(i*1000,(i+1)*1000)))
    total=sum(int(line.split(',')[1]) for p in sorted(pathlib.Path('.').glob('part-*.txt')) for line in p.read_text().splitlines())
    time.sleep(20);done(mode,total)
elif mode=='cancel':
    print('READY_TO_CANCEL',flush=True); time.sleep(90); done(mode,'unexpected')
`
	if err := os.WriteFile(filepath.Join(workspace, "fixture.py"), []byte(fixture), 0600); err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"short":       "Run python3 fixture.py short exactly once and report its result.",
		"medium":      "Run python3 fixture.py medium exactly once and report its result after it completes.",
		"long":        "Run python3 fixture.py long exactly once and report its result after it completes.",
		"verbose":     "Run python3 fixture.py verbose exactly once. Observe all output through terminal pages and report the final marker. Do not redirect, filter, or rerun it.",
		"dependency":  "Run python3 fixture.py prepare once; after success run python3 fixture.py aggregate once. Report the aggregate.",
		"concurrent":  "Run three independent commands, python3 fixture.py a, python3 fixture.py b, python3 fixture.py c, once each. They can run concurrently. Report all three results after completion.",
		"interactive": "Run python3 fixture.py interactive once. Send 13 and 17 when prompted using terminal_write, then report the result.",
		"failure":     "Run python3 fixture.py failure once. It intentionally fails; report its exact exit code. Do not retry.",
		"cpu":         "Run python3 fixture.py cpu once; wait for its CPU derivation to finish and report the exact digest.",
		"sqlite":      "Run python3 fixture.py sqlite once. It creates and queries 120000 database records; report the final aggregate.",
		"pipeline":    "Run python3 fixture.py pipeline once. It creates 80 files and aggregates 80000 records; report the final checksum.",
		"cancel":      "Start python3 fixture.py cancel once with yield_ms=100. When READY_TO_CANCEL appears, terminate it using terminal_terminate and confirm the observed result.",
	}
	task, ok := cases[name]
	if !ok {
		t.Fatal("unknown case")
	}
	provider, model, key := loadTerminalBenchmarkProfile(t)
	if model.ModelName != "deepseek-flash" || model.EffectiveWireModelName() != "deepseek-flash" {
		t.Fatal("requested model mismatch")
	}
	recorder := &deepSeekContextRecorder{traceDir: root}
	sourceURL := provider.BaseURL
	provider.BaseURL = newDeepSeekRecordingProxy(t, sourceURL, recorder)
	provider.ModelSelection = nil
	provider.Models = []config.AIProviderModel{model}
	provider.WebSearch = &config.AIProviderWebSearch{Enabled: false, Source: config.AIWebSearchSourceNative}
	modelID := provider.ID + "/" + model.ModelName
	opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: filepath.Join(root, "state"), AgentHomeDir: filepath.Join(root, "home"), Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{provider}}, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 2 * time.Minute, FirstOutputTimeout: time.Minute, IdleTimeout: time.Minute}, ResolveProviderAPIKey: func(id string) (string, bool, error) { return key, id == provider.ID, nil }}
	if err := os.MkdirAll(opts.AgentHomeDir, 0700); err != nil {
		t.Fatal(err)
	}
	report := map[string]any{"case": name, "variant": os.Getenv("FLOWER_TERMINAL_BENCH_VARIANT"), "model": model.ModelName, "display_name": model.DisplayName, "provider_url": sourceURL, "reasoning": "high", "max_output_tokens": 8192, "task": task, "success": false, "fixture_sha256": sha256Hex([]byte(fixture))}
	defer func() {
		report["test_failed"] = t.Failed()
		report["requests"] = recorder.snapshot()
		saveCompactionQualificationJSON(t, filepath.Join(root, "report.json"), report)
	}()
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Minute)
	defer cancel()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "Controlled terminal benchmark", modelID, config.AIPermissionFullAccess, workspace)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "bench", Input: RunInput{Text: task + " Work only in this fixture directory. Do not inspect or edit fixture.py. Use terminal tools only, no subagent_manage. Reply concisely."}, Options: RunOptions{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}, MaxOutputTokens: 8192, NoUserInteraction: true, ToolAllowlist: []string{"terminal_exec", "terminal_read", "terminal_write", "terminal_terminate"}}})
	if err != nil {
		report["error"] = err.Error()
		t.Fatal(err)
	}

	var view flruntime.ThreadView
	var stable time.Time
	timedOut := false
	for {
		view, err = svc.threadRuntime.View(ctx, identity.ThreadID(thread.ThreadID))
		if err != nil {
			report["error"] = err.Error()
			break
		}
		running := false
		svc.terminalProcesses.mu.Lock()
		processes := make([]*terminalProcess, 0, len(svc.terminalProcesses.processes))
		for _, process := range svc.terminalProcesses.processes {
			processes = append(processes, process)
		}
		svc.terminalProcesses.mu.Unlock()
		for _, process := range processes {
			if process.Snapshot().Status == terminalProcessStatusRunning {
				running = true
			}
		}
		if view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil && !running {
			if stable.IsZero() {
				stable = time.Now()
			}
			if time.Since(stable) >= 700*time.Millisecond {
				break
			}
		} else {
			stable = time.Time{}
		}
		select {
		case <-ctx.Done():
			timedOut = true
		case <-time.After(25 * time.Millisecond):
		}
		if timedOut {
			report["error"] = ctx.Err().Error()
			break
		}
	}
	report["elapsed_ms"] = time.Since(start).Milliseconds()
	report["outcome"], report["failure"] = view.LastOutcome, view.Failure
	var answerBuilder strings.Builder
	var results []flruntime.ThreadToolResult
	reader := svc.threadRuntime.(flruntime.ThreadToolResultReader)
	for _, item := range view.Items {
		if item.Kind == flruntime.ThreadItemAssistant {
			answerBuilder.WriteString(item.Text)
			answerBuilder.WriteByte(10)
		}
		if item.Activity == nil || item.Activity.ToolID == "" {
			continue
		}
		result, found, e := reader.LookupToolResult(t.Context(), flruntime.LookupToolResultInput{ThreadID: view.ThreadID, TurnID: item.TurnID, RunID: item.RunID, ToolCallID: item.Activity.ToolID})
		if e != nil {
			report["lookup_error"] = e.Error()
		} else if found {
			results = append(results, result)
		}
	}
	answer := answerBuilder.String()
	report["answer"], report["tool_results"] = answer, results
	checks := map[string][]string{"short": {"short"}, "medium": {"medium"}, "long": {"long"}, "verbose": {"verbose"}, "dependency": {"prepare", "aggregate"}, "concurrent": {"a", "b", "c"}, "interactive": {"interactive"}, "cpu": {"cpu"}, "sqlite": {"sqlite"}, "pipeline": {"pipeline"}, "failure": {"failure"}, "cancel": {"cancel"}}
	passed := !timedOut && err == nil && view.LastOutcome != nil && *view.LastOutcome == flruntime.TurnOutcomeCompleted
	for _, label := range checks[name] {
		if label == "failure" || label == "cancel" {
			continue
		}
		b, e := os.ReadFile(filepath.Join(workspace, label+".done"))
		if e != nil || label != "prepare" && !strings.Contains(answer, string(b)) {
			passed = false
		}
	}
	// Independent deterministic oracles validate the fixture effects themselves.
	expected := map[string]string{"interactive": "221", "prepare": "10000", "aggregate": "333283335000", "verbose": "PAGINATION_COMPLETE_7319"}
	for _, label := range []string{"short", "medium", "long", "a", "b", "c"} {
		expected[label] = sha256Hex([]byte(strings.Repeat(label, 10000)))[:16]
	}
	var sqliteSum, pipelineSum int64
	for i := int64(0); i < 120000; i++ {
		if i%7 == 0 {
			sqliteSum += i * i % 10007
		}
	}
	for i := int64(0); i < 80000; i++ {
		pipelineSum += i * i % 997
	}
	if name == "cpu" {
		cpuDigest, cpuErr := pbkdf2.Key(sha256.New, "controlled", []byte("flower"), 2500000, 32)
		if cpuErr != nil {
			t.Fatal(cpuErr)
		}
		expected["cpu"] = hex.EncodeToString(cpuDigest)
	}
	expected["sqlite"], expected["pipeline"] = fmt.Sprint(sqliteSum), fmt.Sprint(pipelineSum)
	for _, label := range checks[name] {
		if want, ok := expected[label]; ok {
			got, e := os.ReadFile(filepath.Join(workspace, label+".done"))
			if e != nil || string(got) != want {
				passed = false
			}
		}
	}
	if name == "interactive" {
		b, _ := os.ReadFile(filepath.Join(workspace, "interactive.done"))
		passed = passed && string(b) == "221"
	}
	if name == "failure" {
		passed = passed && strings.Contains(answer, "17")
	}
	if name == "verbose" {
		var output strings.Builder
		for _, result := range results {
			var envelope struct{ Data map[string]any }
			if json.Unmarshal([]byte(result.Content), &envelope) == nil {
				if text, ok := envelope.Data["output"].(string); ok {
					output.WriteString(text)
				}
			}
		}
		missing := []int{}
		for i := 0; i < 700; i++ {
			if !strings.Contains(output.String(), fmt.Sprintf("%04d 中文🪷", i)) {
				missing = append(missing, i)
			}
		}
		report["missing_output_lines"] = missing
		passed = passed && len(missing) == 0
	}
	if name == "cancel" {
		_, e := os.Stat(filepath.Join(workspace, "cancel.done"))
		observed := false
		for _, result := range results {
			if result.ToolName == "terminal_terminate" && result.Status == "success" {
				var envelope struct{ Data map[string]any }
				if json.Unmarshal([]byte(result.Content), &envelope) == nil {
					observed = envelope.Data["status"] == "canceled" || envelope.Data["terminated"] == true
				}
			}
		}
		passed = passed && os.IsNotExist(e) && observed
	}
	var snapshots []terminalProcessSnapshot
	svc.terminalProcesses.mu.Lock()
	for _, process := range svc.terminalProcesses.processes {
		snapshots = append(snapshots, process.Snapshot())
	}
	svc.terminalProcesses.mu.Unlock()
	report["processes"] = snapshots
	if name == "failure" {
		found := false
		for _, s := range snapshots {
			if s.ExitCode == 17 && s.Status == terminalProcessStatusError {
				found = true
			}
		}
		passed = passed && found
	}
	executions, _ := os.ReadFile(filepath.Join(workspace, "executions.jsonl"))
	report["executions"] = string(executions)

	counts := map[string]int{}
	for _, line := range strings.Split(strings.TrimSpace(string(executions)), "\n") {
		var record struct{ Label string }
		if json.Unmarshal([]byte(line), &record) == nil {
			counts[record.Label]++
		}
	}
	if len(counts) != len(checks[name]) {
		passed = false
	}
	for _, label := range checks[name] {
		if counts[label] != 1 {
			passed = false
		}
	}
	report["execution_counts"] = counts
	digest := sha256.Sum256([]byte(fixture))
	report["fixture_sha256"] = hex.EncodeToString(digest[:])
	report["success"] = passed
	if !passed {
		t.Error(fmt.Sprintf("objective checks failed for %s", name))
	}
}

func loadTerminalBenchmarkProfile(t *testing.T) (config.AIProvider, config.AIProviderModel, string) {
	t.Helper()
	root := os.Getenv("REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT")
	raw, err := os.ReadFile(filepath.Join(root, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	// Only the provider profile is needed. Do not load or migrate unrelated live
	// daemon settings through a different source revision's configuration loader.
	var source struct {
		AI config.AIConfig `json:"ai"`
	}
	if err := json.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	id, _, _ := strings.Cut(source.AI.CurrentModelID, "/")
	for _, p := range source.AI.Providers {
		if p.ID != id || p.Type != "deepseek" {
			continue
		}
		for _, m := range p.EffectiveModels() {
			if m.ModelName != "deepseek-flash" {
				continue
			}
			key, found, err := settings.NewSecretsStore(filepath.Join(root, "secrets.json")).GetAIProviderAPIKey(p.ID)
			if err != nil || !found || key == "" {
				t.Fatal("configured DeepSeek credential unavailable")
			}
			return p, m, key
		}
	}
	t.Fatal("configured provider does not expose DeepSeek V4.1 Flash (1017)")
	return config.AIProvider{}, config.AIProviderModel{}, ""
}
