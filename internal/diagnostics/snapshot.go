package diagnostics

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

type SummaryItem struct {
	Scope          string `json:"scope"`
	Kind           string `json:"kind,omitempty"`
	Method         string `json:"method,omitempty"`
	Path           string `json:"path,omitempty"`
	Count          int    `json:"count"`
	SlowCount      int    `json:"slow_count"`
	MaxDurationMs  int64  `json:"max_duration_ms"`
	AvgDurationMs  int64  `json:"avg_duration_ms"`
	LastStatusCode int    `json:"last_status_code,omitempty"`
	LastSeenAt     string `json:"last_seen_at,omitempty"`
}

type Stats struct {
	TotalEvents   int `json:"total_events"`
	AgentEvents   int `json:"agent_events"`
	DesktopEvents int `json:"desktop_events"`
	SlowEvents    int `json:"slow_events"`
	TraceCount    int `json:"trace_count"`
}

type Snapshot struct {
	RecentEvents []Event       `json:"recent_events"`
	SlowSummary  []SummaryItem `json:"slow_summary"`
	Stats        Stats         `json:"stats"`
}

func EventKey(event Event) string {
	body, err := json.Marshal(event)
	if err != nil {
		return strings.Join([]string{
			strings.TrimSpace(event.CreatedAt),
			strings.TrimSpace(event.Source),
			strings.TrimSpace(event.Scope),
			strings.TrimSpace(event.Kind),
			strings.TrimSpace(event.TraceID),
			strings.TrimSpace(event.Method),
			strings.TrimSpace(event.Path),
			strconv.Itoa(event.StatusCode),
			strconv.FormatInt(event.DurationMs, 10),
			strings.TrimSpace(event.Message),
		}, "\x00")
	}
	return string(body)
}

func BuildSnapshot(recentLimit int, summaryLimit int, sources ...[]Event) Snapshot {
	merged := MergeEvents(recentLimit, sources...)
	all := MergeEvents(10000, sources...)
	return Snapshot{
		RecentEvents: merged,
		SlowSummary:  BuildSlowSummary(all, summaryLimit),
		Stats:        BuildStats(all),
	}
}

func MergeEvents(limit int, sources ...[]Event) []Event {
	if limit <= 0 {
		limit = 200
	}
	merged := make([]Event, 0, limit)
	for _, source := range sources {
		merged = append(merged, source...)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		if merged[i].CreatedAt == merged[j].CreatedAt {
			return merged[i].Source < merged[j].Source
		}
		return merged[i].CreatedAt > merged[j].CreatedAt
	})
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged
}

func BuildStats(events []Event) Stats {
	stats := Stats{TotalEvents: len(events)}
	traceSet := map[string]struct{}{}
	for _, event := range events {
		switch strings.TrimSpace(event.Source) {
		case SourceAgent:
			stats.AgentEvents++
		case SourceDesktop:
			stats.DesktopEvents++
		}
		if event.Slow {
			stats.SlowEvents++
		}
		if traceID := strings.TrimSpace(event.TraceID); traceID != "" {
			traceSet[traceID] = struct{}{}
		}
	}
	stats.TraceCount = len(traceSet)
	return stats
}

func BuildSlowSummary(events []Event, limit int) []SummaryItem {
	if limit <= 0 {
		limit = 8
	}
	type aggregate struct {
		item          SummaryItem
		totalDuration int64
	}
	groups := map[string]*aggregate{}
	for _, event := range events {
		if event.DurationMs <= 0 {
			continue
		}
		key := strings.Join([]string{
			strings.TrimSpace(event.Scope),
			strings.TrimSpace(event.Kind),
			strings.TrimSpace(event.Method),
			strings.TrimSpace(event.Path),
		}, "\x00")
		agg := groups[key]
		if agg == nil {
			agg = &aggregate{item: SummaryItem{
				Scope:  strings.TrimSpace(event.Scope),
				Kind:   strings.TrimSpace(event.Kind),
				Method: strings.TrimSpace(event.Method),
				Path:   strings.TrimSpace(event.Path),
			}}
			groups[key] = agg
		}
		agg.item.Count++
		if event.Slow {
			agg.item.SlowCount++
		}
		if event.DurationMs > agg.item.MaxDurationMs {
			agg.item.MaxDurationMs = event.DurationMs
		}
		agg.totalDuration += event.DurationMs
		agg.item.LastStatusCode = event.StatusCode
		if strings.TrimSpace(event.CreatedAt) > strings.TrimSpace(agg.item.LastSeenAt) {
			agg.item.LastSeenAt = strings.TrimSpace(event.CreatedAt)
		}
	}
	out := make([]SummaryItem, 0, len(groups))
	for _, agg := range groups {
		if agg.item.Count > 0 {
			agg.item.AvgDurationMs = agg.totalDuration / int64(agg.item.Count)
		}
		out = append(out, agg.item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].SlowCount != out[j].SlowCount {
			return out[i].SlowCount > out[j].SlowCount
		}
		if out[i].MaxDurationMs != out[j].MaxDurationMs {
			return out[i].MaxDurationMs > out[j].MaxDurationMs
		}
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].LastSeenAt > out[j].LastSeenAt
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
