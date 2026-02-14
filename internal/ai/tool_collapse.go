package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/session"
)

func (s *Service) GetActiveRunSnapshot(meta *session.Meta, threadID string) (string, string, error) {
	if s == nil {
		return "", "", errors.New("service not ready")
	}
	if meta == nil || !meta.CanRead {
		return "", "", errors.New("read permission denied")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return "", "", errors.New("invalid request")
	}

	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	s.mu.Unlock()
	if runID == "" || r == nil {
		return "", "", nil
	}

	msgJSON, _, _, err := r.snapshotAssistantMessageJSON()
	if err == nil && strings.TrimSpace(msgJSON) != "" {
		return runID, msgJSON, nil
	}

	// Best-effort: for very early runs, the assistant message isn't initialized yet, so there is
	// no snapshot to return. Callers should wait for stream events or the persisted transcript.
	return "", "", nil
}

func (s *Service) SetToolCollapsed(meta *session.Meta, threadID string, messageID string, toolID string, collapsed bool) error {
	if s == nil {
		return errors.New("service not ready")
	}
	if meta == nil || !meta.CanRead {
		return errors.New("read permission denied")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID = strings.TrimSpace(threadID)
	messageID = strings.TrimSpace(messageID)
	toolID = strings.TrimSpace(toolID)
	if endpointID == "" || threadID == "" || messageID == "" || toolID == "" {
		return errors.New("invalid request")
	}

	// Best-effort: update active run state (not yet persisted).
	runUpdated := false
	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	s.mu.Unlock()
	if r != nil && strings.TrimSpace(r.messageID) == messageID {
		runUpdated = r.setToolCollapsed(toolID, collapsed)
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		if runUpdated {
			return nil
		}
		return errors.New("threads store not ready")
	}

	pctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()

	rowID, rawJSON, err := db.GetTranscriptMessageRowIDAndJSONByMessageID(pctx, endpointID, threadID, messageID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if runUpdated {
				return nil
			}
			return sql.ErrNoRows
		}
		return err
	}

	nextJSON, changed, err := setToolCollapsedInMessageJSON(rawJSON, toolID, collapsed)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}

	now := time.Now().UnixMilli()
	if err := db.UpdateTranscriptMessageJSONByRowID(pctx, endpointID, rowID, nextJSON, now); err != nil {
		return err
	}
	s.broadcastTranscriptMessage(endpointID, threadID, "", rowID, nextJSON, now)
	return nil
}

func setToolCollapsedInMessageJSON(raw string, toolID string, collapsed bool) (string, bool, error) {
	raw = strings.TrimSpace(raw)
	toolID = strings.TrimSpace(toolID)
	if raw == "" || toolID == "" {
		return "", false, errors.New("invalid message")
	}

	var msg map[string]any
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		return "", false, err
	}

	blocksRaw, ok := msg["blocks"]
	if !ok || blocksRaw == nil {
		return raw, false, errors.New("blocks not found")
	}
	blocks, ok := blocksRaw.([]any)
	if !ok {
		return raw, false, errors.New("invalid blocks")
	}

	found := false
	changed := false
	for i := range blocks {
		blk, ok := blocks[i].(map[string]any)
		if !ok || blk == nil {
			continue
		}
		typ, _ := blk["type"].(string)
		if strings.TrimSpace(typ) != "tool-call" {
			continue
		}
		rawToolID, _ := blk["toolId"].(string)
		if rawToolID == "" {
			rawToolID, _ = blk["tool_id"].(string)
		}
		if strings.TrimSpace(rawToolID) != toolID {
			continue
		}
		found = true
		if cur, ok := blk["collapsed"].(bool); ok && cur == collapsed {
			break
		}
		blk["collapsed"] = collapsed
		blocks[i] = blk
		changed = true
		break
	}

	if !found {
		return raw, false, errors.New("tool not found")
	}
	if !changed {
		return raw, false, nil
	}

	msg["blocks"] = blocks
	b, err := json.Marshal(msg)
	if err != nil {
		return "", false, err
	}
	return string(b), true, nil
}
