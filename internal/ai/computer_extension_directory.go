package ai

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
)

// The native stream is the only tab inventory authority. Its initial snapshot
// and contiguous revisions are applied before command replies are delivered.
func (client *computerExtensionClient) applyDirectory(raw json.RawMessage) bool {
	var event struct {
		Revision uint64                `json:"revision"`
		Tabs     *[]ComputerBrowserTab `json:"tabs"`
		Upsert   []ComputerBrowserTab  `json:"upsert"`
		Removed  []string              `json:"removed"`
		Order    []string              `json:"order"`
	}
	if json.Unmarshal(raw, &event) != nil {
		return false
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if event.Revision != client.directoryRevision+1 || (event.Tabs != nil) != (client.directoryRevision == 0) {
		return false
	}
	tabs := slices.Clone(client.directoryTabs)
	if event.Tabs != nil {
		tabs = slices.Clone(*event.Tabs)
	} else {
		tabs = slices.DeleteFunc(tabs, func(tab ComputerBrowserTab) bool { return slices.Contains(event.Removed, tab.ID) })
		for _, tab := range event.Upsert {
			index := slices.IndexFunc(tabs, func(candidate ComputerBrowserTab) bool { return candidate.ID == tab.ID })
			if index < 0 {
				tabs = append(tabs, tab)
			} else {
				tabs[index] = tab
			}
		}
		if len(event.Order) != len(tabs) {
			return false
		}
		ordered := make([]ComputerBrowserTab, 0, len(tabs))
		for i, id := range event.Order {
			index := slices.IndexFunc(tabs, func(tab ComputerBrowserTab) bool { return tab.ID == id })
			if index < 0 || slices.Contains(event.Order[:i], id) {
				return false
			}
			ordered = append(ordered, tabs[index])
		}
		tabs = ordered
	}
	if len(tabs) > 128 {
		return false
	}
	identities := make(map[string]bool, len(tabs))
	for i, tab := range tabs {
		if id, err := strconv.ParseUint(tab.ID, 10, 32); err != nil || id == 0 {
			return false
		}
		native, err := hex.DecodeString(tab.NativeTargetID)
		if err != nil || len(native) != 16 || identities[tab.NativeTargetID] || slices.ContainsFunc(tabs[:i], func(previous ComputerBrowserTab) bool { return previous.ID == tab.ID }) || len(tab.URL) > 8192 || len(tab.Title) > 512 || (tab.Availability != "" && tab.Availability != "unsupported") {
			return false
		}
		identities[tab.NativeTargetID] = true
		tabs[i].ProfileID = client.profile.ID
	}
	client.directoryTabs, client.directoryRevision = tabs, event.Revision
	return true
}

func (client *computerExtensionClient) directorySnapshot() ([]ComputerBrowserTab, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.directoryRevision == 0 {
		return nil, errors.New("browser directory unavailable")
	}
	return slices.Clone(client.directoryTabs), nil
}
