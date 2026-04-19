package accessgate

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const DefaultFailedAttemptRetention = 30 * time.Minute

var ErrInvalidPassword = errors.New("invalid password")

type AttemptPolicyStep struct {
	Failures int
	Cooldown time.Duration
}

type AttemptPolicy struct {
	Steps     []AttemptPolicyStep
	Retention time.Duration
}

type RateLimitError struct {
	RetryAfter time.Duration
}

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("too many incorrect password attempts; retry in %s", formatRetryAfterDuration(e.RetryAfter))
}

func IsRateLimited(err error) bool {
	var rateLimitErr *RateLimitError
	return errors.As(err, &rateLimitErr)
}

func RetryAfter(err error) time.Duration {
	var rateLimitErr *RateLimitError
	if errors.As(err, &rateLimitErr) {
		return rateLimitErr.RetryAfter
	}
	return 0
}

func defaultAttemptPolicy() AttemptPolicy {
	return AttemptPolicy{
		Steps: []AttemptPolicyStep{
			{Failures: 5, Cooldown: 30 * time.Second},
			{Failures: 7, Cooldown: time.Minute},
			{Failures: 9, Cooldown: 2 * time.Minute},
			{Failures: 10, Cooldown: 5 * time.Minute},
			{Failures: 12, Cooldown: 15 * time.Minute},
		},
		Retention: DefaultFailedAttemptRetention,
	}
}

func normalizeAttemptPolicy(policy AttemptPolicy) AttemptPolicy {
	if policy.Retention <= 0 {
		policy.Retention = DefaultFailedAttemptRetention
	}
	if len(policy.Steps) == 0 {
		return defaultAttemptPolicy()
	}

	steps := make([]AttemptPolicyStep, 0, len(policy.Steps))
	for _, step := range policy.Steps {
		if step.Failures <= 0 || step.Cooldown <= 0 {
			continue
		}
		steps = append(steps, AttemptPolicyStep{
			Failures: step.Failures,
			Cooldown: step.Cooldown,
		})
	}
	if len(steps) == 0 {
		return defaultAttemptPolicy()
	}

	sort.Slice(steps, func(i, j int) bool {
		return steps[i].Failures < steps[j].Failures
	})
	return AttemptPolicy{
		Steps:     steps,
		Retention: policy.Retention,
	}
}

func normalizeAttemptSubject(subject string) string {
	normalized := strings.ToLower(strings.TrimSpace(subject))
	if normalized == "" {
		return "global"
	}
	return normalized
}

func formatRetryAfterDuration(d time.Duration) string {
	rounded := d.Round(time.Second)
	if rounded < time.Second {
		rounded = time.Second
	}
	totalSeconds := int(rounded / time.Second)
	minutes := totalSeconds / 60
	seconds := totalSeconds % 60
	if minutes > 0 && seconds > 0 {
		return fmt.Sprintf("%d minute%s %d second%s", minutes, pluralSuffix(minutes), seconds, pluralSuffix(seconds))
	}
	if minutes > 0 {
		return fmt.Sprintf("%d minute%s", minutes, pluralSuffix(minutes))
	}
	return fmt.Sprintf("%d second%s", seconds, pluralSuffix(seconds))
}

func pluralSuffix(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
