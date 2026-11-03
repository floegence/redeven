package terminal

import (
	"errors"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

func (m *Manager) HistoryRetentionAvailable() bool { return m != nil && m.term != nil }

func (m *Manager) SetHistoryRetentionDefaults(limits termgo.HistoryRetentionLimits) error {
	if !m.HistoryRetentionAvailable() {
		return termgo.ErrHistoryRetentionUnavailable
	}
	return m.term.SetHistoryRetentionDefaults(limits)
}
func (m *Manager) SessionHistoryRetention(meta *session.Meta, id string, connection string, generation uint64, limits *termgo.HistoryRetentionLimits) (termgo.HistoryRetentionState, error) {
	if _, err := m.authorizeSessionInteraction(meta, id); err != nil {
		return termgo.HistoryRetentionState{}, err
	}
	sess, ok := m.term.GetSession(id)
	if !ok {
		return termgo.HistoryRetentionState{}, ErrSessionNotFound
	}
	if limits == nil {
		return sess.HistoryRetention()
	}
	state, err := sess.ConfigureHistoryRetention(connection, "local", generation, *limits)
	switch {
	case errors.Is(err, termgo.ErrControllerTransport):
		return state, &sessionrpc.Error{Code: 409, Message: "terminal attachment changed"}
	case errors.Is(err, termgo.ErrControllerPrincipal):
		return state, &sessionrpc.Error{Code: 403, Message: "terminal controller belongs to another principal"}
	default:
		return state, err
	}
}
