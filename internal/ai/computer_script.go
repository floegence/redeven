package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// A script owns only an ephemeral namespace. Its operations remain inside the
// one admitted tool invocation and the target's existing control gate.
type computerScriptKey struct{ thread, turn, target string }
type computerScriptProcess struct {
	observations computerObservationOutput
	mu           sync.Mutex
	cmd          *exec.Cmd
	stdin        io.WriteCloser
	lines        chan computerScriptMessage
	done         chan struct{}
	stopOnce     sync.Once
	cancelMu     sync.Mutex
	cancel       context.CancelFunc
}
type computerScriptMessage struct {
	Type            string         `json:"type"`
	ID              string         `json:"id"`
	ProtocolVersion int            `json:"protocol_version"`
	Operation       map[string]any `json:"operation"`
	Result          map[string]any `json:"result"`
	Error           string         `json:"error"`
}

var errComputerEffectUnknown = errors.New("computer effect outcome is unknown; inspect the target without replaying the action")

func (r *ComputerUseRuntime) scriptProcess(key computerScriptKey) (*computerScriptProcess, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, errors.New("computer runtime is closed")
	}
	if p := r.scripts[key]; p != nil {
		return p, nil
	}
	if len(r.scripts) >= 8 {
		return nil, errors.New("computer script limit reached")
	}
	var node, helper string
	for _, adapter := range r.executors {
		if browser, ok := adapter.(*PlaywrightTargetExecutor); ok {
			node, helper = browser.NodeBinary, filepath.Join(filepath.Dir(browser.HelperPath), "redevenComputerScript.mjs")
			break
		}
	}
	if !filepath.IsAbs(node) || !filepath.IsAbs(helper) {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "script_resources_missing"}
	}
	arguments := []string{"--max-old-space-size=128", helper}
	target, err := r.registry.ResolveTarget(context.Background(), key.target)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(target.Kind, "browser.") {
		arguments = append(arguments, "--browser-target")
	}
	cmd := exec.Command(node, arguments...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, err
	}
	p := &computerScriptProcess{cmd: cmd, stdin: stdin, lines: make(chan computerScriptMessage, 1), done: make(chan struct{})}
	go func() {
		defer close(p.lines)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			var msg computerScriptMessage
			if json.Unmarshal(scanner.Bytes(), &msg) != nil {
				return
			}
			select {
			case p.lines <- msg:
			case <-p.done:
				return
			}
		}
	}()
	if r.scripts == nil {
		r.scripts = make(map[computerScriptKey]*computerScriptProcess)
	}
	r.scripts[key] = p
	return p, nil
}

func (p *computerScriptProcess) stop() {
	p.stopOnce.Do(func() {
		p.cancelMu.Lock()
		if p.cancel != nil {
			p.cancel()
		}
		p.cancelMu.Unlock()
		close(p.done)
		_ = p.stdin.Close()
		_ = p.cmd.Process.Kill()
		_ = p.cmd.Wait()
	})
}

func (r *ComputerUseRuntime) releaseScripts(match func(computerScriptKey) bool) {
	r.mu.Lock()
	var retired []*computerScriptProcess
	for key, p := range r.scripts {
		if match(key) {
			delete(r.scripts, key)
			retired = append(retired, p)
		}
	}
	r.mu.Unlock()
	for _, p := range retired {
		p.stop()
	}
}

func (r *ComputerUseRuntime) executeComputerScript(ctx context.Context, call TargetToolCall) (output TargetToolResult, outputErr error) {
	var args struct {
		Code        string `json:"code"`
		Description string `json:"description"`
	}
	if json.Unmarshal(call.Arguments, &args) != nil || strings.TrimSpace(args.Code) == "" || len(args.Code) > 65536 || strings.TrimSpace(args.Description) == "" || call.ThreadID == "" || call.TurnID == "" || call.revalidate == nil {
		return TargetToolResult{}, computerTargetFailure(call, "INVALID_REQUEST")
	}
	key := computerScriptKey{call.ThreadID, call.TurnID, call.TargetID}
	r.releaseScripts(func(other computerScriptKey) bool { return other.thread == key.thread && other != key })
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	p, err := r.scriptProcess(key)
	if err != nil {
		return TargetToolResult{}, err
	}
	healthy := false
	defer func() {
		if !healthy {
			r.releaseScripts(func(candidate computerScriptKey) bool { return candidate == key })
		}
	}()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cancelMu.Lock()
	p.cancel = cancel
	p.cancelMu.Unlock()
	defer func() { p.cancelMu.Lock(); p.cancel = nil; p.cancelMu.Unlock() }()
	select {
	case <-p.done:
		return TargetToolResult{}, errors.New("computer script was retired")
	default:
	}
	send := func(value any) error {
		body, err := json.Marshal(value)
		if err != nil {
			return err
		}
		_, err = p.stdin.Write(append(body, '\n'))
		return err
	}
	if err := send(map[string]any{"type": "execute", "id": call.ToolCallID, "code": args.Code}); err != nil {
		return TargetToolResult{}, err
	}
	result := TargetToolResult{TargetID: call.TargetID, ActionSummary: args.Description}
	completed := []string{}
	var stopped error
	var pause *InteractionSafetyDecision
	var targetChange map[string]any
	var lastObservation any
	var observationScope string
	var fullObservation bool
	observationInvalidated := false
	operations := 0
	effectCompleted := false
	// Prefix facts survive interpreter timeout, exhaustion and broken IPC.
	// Never fabricate completion of the operation whose outcome is unknown.
	defer func() {
		if output.Result == nil {
			output = result
			output.Result = map[string]any{"summary": args.Description, "completed_actions": completed, "action_executed": effectCompleted, "operations": operations, "completed": false, "script_error": "SCRIPT_STOPPED"}
		}
		if pause != nil {
			output.Safety = pause
			output.Attachments = nil
		}
	}()
	for {
		var msg computerScriptMessage
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		case msgValue, ok := <-p.lines:
			if !ok {
				return result, errors.New("computer script connection closed")
			}
			msg = msgValue
		}
		switch msg.Type {
		case "ready":
			if msg.ProtocolVersion != 2 {
				return result, errors.New("computer script protocol mismatch")
			}
		case "operation":
			operations++
			if stopped != nil || pause != nil || operations > 50 || msg.ID == "" {
				return result, errors.New("computer script exceeded its operation boundary")
			}
			inner, err := computerScriptOperation(call, msg.Operation)
			var observed TargetToolResult
			if err == nil {
				// Keep the target lease for the whole batch and serialize each
				// operation through its gate. Live viewers can sample between
				// operations without granting another thread control.
				var control *computerTargetControl
				var release func()
				control, release, err = r.acquireComputerControl(ctx, inner)
				if err == nil {
					observed, err = r.executeComputerToolLocked(ctx, inner, control)
					release()
				}
				if errors.Is(err, errComputerEffectUnknown) {
					return result, err
				}
			}
			if err != nil {
				stopped = err
			}
			if takeoverResult(observed, err) {
				pause = observed.Safety
				if pause == nil {
					pause = &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"user_control"}}
				}
				stopped = ErrInteractionTakeoverRequired
			}
			if payload, ok := observed.Result.(map[string]any); ok {
				if payload["target_changed"] == true {
					targetChange = map[string]any{"target_changed": true, "opened_pages": payload["opened_pages"], "opener_tab_id": payload["opener_tab_id"]}
					stopped = errors.New("computer target changed")
					lastObservation = nil
					result.Attachments = nil
					p.observations = computerObservationOutput{}
				}
				if payload["action_executed"] == true {
					effectCompleted = true
					lastObservation = nil
				}
				if observation, ok := payload["observation"]; ok {
					if msg.Operation["emit"] != false {
						lastObservation = observation
						if tree, ok := observation.(map[string]any); ok {
							tree = cloneAnyMap(tree)
							for _, field := range []string{"url", "title"} {
								if value, exists := payload[field]; exists {
									tree[field] = value
								}
							}
							lastObservation = tree
						}
						scope, _ := json.Marshal([]any{msg.Operation["root_ref"], msg.Operation["limit"]})
						observationScope, fullObservation = string(scope), msg.Operation["full"] == true
					}
					observationInvalidated = false
				}
				if payload["observation_invalidated"] == true {
					lastObservation = nil
					result.Attachments = nil
					observationInvalidated = true
					p.observations = computerObservationOutput{}
				}
			}
			if stopped == nil {
				completed = append(completed, anyToString(msg.Operation["action"]))
				result.Attachments = append(result.Attachments, observed.Attachments...)
				result.ExecutionLocation = observed.ExecutionLocation
			}
			if stopped != nil {
				if payload, ok := observed.Result.(map[string]any); ok && payload["action_executed"] == true {
					completed = append(completed, anyToString(msg.Operation["action"]))
				}
			}
			response := map[string]any{"type": "operation_result", "id": msg.ID, "result": observed.Result}
			if stopped != nil {
				response["error"] = "HOST_OPERATION_STOPPED"
			}
			if err := send(response); err != nil {
				return result, err
			}
		case "result", "error":
			if msg.ID != call.ToolCallID {
				return result, errors.New("computer script response identity mismatch")
			}
			result.Result = map[string]any{"summary": args.Description, "completed_actions": completed, "action_executed": effectCompleted, "operations": operations, "logs": msg.Result["logs"], "truncated": msg.Result["truncated"] == true, "observation": lastObservation, "completed": stopped == nil && msg.Type == "result"}
			if observationInvalidated {
				result.Result.(map[string]any)["observation_invalidated"] = true
			}
			if pause != nil {
				result.Safety = pause
				result.Attachments = nil
				// Earlier non-secret observations may precede login. Only closed
				// progress facts cross a sensitive pause.
				delete(result.Result.(map[string]any), "observation")
				delete(result.Result.(map[string]any), "logs")
				return result, nil
			}
			if targetChange != nil {
				for key, value := range targetChange {
					result.Result.(map[string]any)[key] = value
				}
				delete(result.Result.(map[string]any), "observation")
				return result, nil
			}
			if stopped != nil || msg.Type == "error" {
				code := "SCRIPT_STOPPED"
				var failure *targetToolPolicyError
				if errors.As(stopped, &failure) {
					code = strings.ToUpper(failure.code)
				}
				result.Result.(map[string]any)["script_error"] = code
				return result, &computerScriptExecutionError{code: code}
			}
			healthy = true
			if lastObservation != nil {
				result.Result.(map[string]any)["observation"] = p.observations.render(lastObservation, observationScope, fullObservation)
			}
			return result, nil
		default:
			return result, errors.New("invalid computer script protocol")
		}
	}
}

func computerOperationMutates(op map[string]any) bool {
	switch anyToString(op["action"]) {
	case "observe", "read", "wait", "screenshot", "wait_for_download":
		return false
	default:
		return true
	}
}

func computerScriptOperation(parent TargetToolCall, operation map[string]any) (TargetToolCall, error) {
	call := parent
	call.scriptOperation = true
	call.ToolName = "computer.action"
	args := cloneAnyMap(operation)
	switch anyToString(operation["action"]) {
	case "observe":
		call.ToolName = "computer.observe"
		delete(args, "action")
		for _, option := range []string{"emit", "full"} {
			if value, exists := args[option]; exists {
				if _, ok := value.(bool); !ok {
					return TargetToolCall{}, computerTargetFailure(parent, "INVALID_REQUEST")
				}
				delete(args, option)
			}
		}
	case "screenshot":
		call.ToolName = "computer.screenshot"
		delete(args, "action")
	case "navigate", "back", "reload", "wait_for_download":
		call.ToolName = "browser." + anyToString(operation["action"])
		delete(args, "action")
	case "read", "click", "fill", "key", "scroll", "wait", "pointer_click", "drag":
	default:
		return TargetToolCall{}, computerTargetFailure(parent, "INVALID_REQUEST")
	}
	for _, key := range []string{"target", "target_id", "thread_id", "turn_id", "run_id", "user_control", "return_control", "allow_foreground", "full_access", "allowed_origins", "allowed_apps"} {
		if _, ok := args[key]; ok {
			return TargetToolCall{}, computerTargetFailure(parent, "TARGET_NOT_ALLOWED")
		}
	}
	body, err := json.Marshal(args)
	call.Arguments = body
	return call, err
}

// Execution failures may follow effects. They are never argument-regeneration feedback.
type computerScriptExecutionError struct{ code string }

func (e *computerScriptExecutionError) Error() string {
	return "Computer script stopped before completion (" + e.code + ")"
}
