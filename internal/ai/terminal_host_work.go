package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

type terminalSealedChunk struct {
	Seq  int64  `json:"seq"`
	Text string `json:"text"`
}
type terminalSealedOutput struct {
	Version  int                     `json:"version"`
	Snapshot terminalProcessSnapshot `json:"snapshot"`
	Chunks   []terminalSealedChunk   `json:"chunks"`
}

func (r *run) bindTerminalWork(ctx context.Context, req *terminalProcessStartRequest) error {
	work, ok := r.threadRuntime.(flruntime.ThreadHostWorkService)
	if !ok {
		return errors.New("terminal durable execution service unavailable")
	}
	auth, ok := floretToolExecutionAuthorizationFromContext(ctx, req.ToolID, req.ToolName)
	if !ok {
		return errors.New("terminal effect authorization unavailable")
	}
	if err := work.BindHostWork(ctx, flruntime.BindHostWorkInput{ThreadID: identity.ThreadID(req.ThreadID), TurnID: identity.TurnID(req.TurnID), RunID: identity.RunID(req.RunID), ToolCallID: req.ToolID, EffectAttemptID: auth.effectAttemptID, WorkID: req.ProcessID}); err != nil {
		return err
	}
	req.Complete = func(p *terminalProcess) error {
		notify := <-p.initialResult
		if p.manager != nil {
			p.manager.mu.Lock()
			notify = notify && !p.manager.closing
			p.manager.mu.Unlock()
		}
		p.mu.Lock()
		snapshot := p.snapshotLocked(terminalProcessTailCapBytes)
		sealed := terminalSealedOutput{Version: 1, Snapshot: snapshot}
		sealed.Snapshot.Output = ""
		// The original invocation retains command and cwd. Completion facts
		// carry identity/status only, independent of arbitrary command size.
		sealed.Snapshot.Command, sealed.Snapshot.Cwd = "", ""
		if sealed.Snapshot.Error != nil {
			copy := *sealed.Snapshot.Error
			copy.Message = terminalBoundedText(copy.Message, 2048)
			sealed.Snapshot.Error = &copy
		}
		for _, c := range p.outputChunks {
			sealed.Chunks = append(sealed.Chunks, terminalSealedChunk{Seq: c.seq, Text: string(c.data)})
		}
		p.mu.Unlock()
		raw, err := json.Marshal(sealed)
		if err != nil {
			return err
		}
		text := string(raw)
		notice := terminalCompletionNotice(snapshot)
		persist, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		facts, _ := json.Marshal(sealed.Snapshot)
		return work.CompleteHostWork(persist, flruntime.CompleteHostWorkInput{Activity: terminalProcessActivity(snapshot, terminalProcessResultPayload(snapshot)), Result: facts, ThreadID: identity.ThreadID(req.ThreadID), WorkID: req.ProcessID, Notice: notice, Notify: notify, Output: &text})
	}
	return nil
}

func terminalCompletionNotice(s terminalProcessSnapshot) string {
	notice := fmt.Sprintf("Terminal %s finished: status=%s, exit_code=%d. Retained output sequences %d..%d; truncated=%t.", s.ProcessID, s.Status, s.ExitCode, s.FirstSeq, s.LatestSeq, s.Truncated)
	if !s.HasMore && !s.Truncated && len(s.Output) <= 1100 {
		notice += " Output: " + s.Output
	} else {
		notice += " Read retained output with terminal.read using this process_id and after_seq=0."
	}
	if s.outputUTF8Repaired {
		notice += " Invalid source UTF-8 bytes were replaced."
	}
	return notice
}

func (r *run) settleTerminalStartFailure(req terminalProcessStartRequest, startErr error) error {
	work, ok := r.threadRuntime.(flruntime.ThreadHostWorkService)
	if !ok {
		return errors.New("terminal durable execution service unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	snapshot := terminalProcessSnapshot{ProcessID: req.ProcessID, EndpointID: req.EndpointID, ThreadID: req.ThreadID, TurnID: req.TurnID, RunID: req.RunID, ToolID: req.ToolID, ToolName: req.ToolName, Status: "not_started", Observation: "unavailable", OutputAvailability: "unavailable", ExecutionLocation: ToolTargetModeLocalRuntime}
	facts, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	return work.CompleteHostWork(ctx, flruntime.CompleteHostWorkInput{Result: facts, ThreadID: identity.ThreadID(req.ThreadID), WorkID: req.ProcessID, Notice: "Terminal " + req.ProcessID + " could not be started; no process handle was acquired.", Notify: false})
}

func readSealedTerminal(ctx context.Context, service flruntime.ThreadService, thread identity.ThreadID, id string, after, maxBytes int64) (terminalProcessSnapshot, error) {
	if after < 0 || maxBytes < terminalProcessOutputChunkBytes {
		return terminalProcessSnapshot{}, errors.New("invalid terminal output page")
	}
	work, ok := service.(flruntime.ThreadHostWorkService)
	if !ok {
		return terminalProcessSnapshot{}, errors.New("terminal durable execution service unavailable")
	}
	works, err := work.ListHostWork(ctx, thread)
	if err != nil {
		return terminalProcessSnapshot{}, err
	}
	for _, w := range works {
		if w.WorkID != id {
			continue
		}
		snapshot := terminalProcessSnapshot{ProcessID: id, ThreadID: thread.String(), TurnID: w.TurnID.String(), RunID: w.RunID.String(), ToolID: w.ToolCallID, ToolName: "terminal.exec", Status: "unknown", ExecutionLocation: ToolTargetModeLocalRuntime, Observation: "unavailable", OutputAvailability: "unavailable"}
		if len(w.Result) > 0 {
			if json.Unmarshal(w.Result, &snapshot) != nil || snapshot.ProcessID != id || snapshot.TurnID != w.TurnID.String() || snapshot.RunID != w.RunID.String() || snapshot.ToolID != w.ToolCallID || snapshot.Status == terminalProcessStatusRunning {
				return snapshot, errors.New("terminal result facts are invalid")
			}
			snapshot.Observation = "unavailable"
			snapshot.OutputAvailability = "unavailable"
			snapshot.ThreadID = thread.String()
		}
		if w.Inherited {
			snapshot.Observation = "source_thread"
		}
		if !w.OutputAvailable {
			return snapshot, nil
		}
		output, err := work.ReadHostWorkOutput(ctx, thread, id)
		if err != nil {
			return snapshot, err
		}
		var sealed terminalSealedOutput
		var facts terminalProcessSnapshot
		if json.Unmarshal([]byte(output), &sealed) != nil || json.Unmarshal(w.Result, &facts) != nil || validateSealedTerminal(sealed, facts) != nil {
			return snapshot, errors.New("sealed terminal output is invalid")
		}
		s := sealed.Snapshot
		if after < 0 || after > s.LatestSeq {
			return snapshot, errors.New("invalid after_seq")
		}
		var b strings.Builder
		first, last := int64(0), after
		for _, c := range sealed.Chunks {
			if c.Seq <= after {
				continue
			}
			if b.Len() > 0 && int64(b.Len()+len(c.Text)) > maxBytes {
				break
			}
			if first == 0 {
				first = c.Seq
			}
			last = c.Seq
			b.WriteString(c.Text)
		}
		s.Output = b.String()
		s.FirstSeq = first
		s.LastSeq = last
		s.HasMore = last < s.LatestSeq
		s.Truncated = len(sealed.Chunks) > 0 && after+1 < sealed.Chunks[0].Seq
		s.Observation = "unavailable"
		s.OutputAvailability = "retained"
		s.ThreadID = thread.String()
		if w.Inherited {
			s.Observation = "source_thread"
		}
		return s, nil
	}
	return terminalProcessSnapshot{}, errors.New("terminal process not found")
}

func validateSealedTerminal(sealed terminalSealedOutput, facts terminalProcessSnapshot) error {
	if sealed.Version != 1 || !reflect.DeepEqual(sealed.Snapshot, facts) || facts.Output != "" || facts.LatestSeq < 0 || facts.TotalBytes < 0 {
		return errors.New("invalid terminal output identity")
	}
	var previous, bytes int64
	for i, chunk := range sealed.Chunks {
		if chunk.Seq <= 0 || i > 0 && chunk.Seq != previous+1 || len(chunk.Text) == 0 || len(chunk.Text) > terminalProcessOutputChunkBytes || !utf8.ValidString(chunk.Text) {
			return errors.New("invalid terminal output sequence")
		}
		previous = chunk.Seq
		bytes += int64(len(chunk.Text))
	}
	if previous != facts.LatestSeq || !facts.InvalidUTF8Replaced && bytes > facts.TotalBytes || bytes > terminalProcessTailCapBytes {
		return errors.New("invalid terminal output range")
	}
	return nil
}

func terminalBoundedText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	end := limit
	for end > 0 && !utf8.RuneStart(text[end]) {
		end--
	}
	return text[:end]
}
