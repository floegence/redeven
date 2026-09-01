package managedwebservice

import (
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	managedTransferProgressInterval = 500 * time.Millisecond
	managedTransferRateWindow       = 3 * time.Second
)

type managedTransferRateSample struct {
	at    time.Time
	bytes int64
}

type managedTransferProgressReporter struct {
	now           func() time.Time
	lastPhase     string
	lastEmittedAt time.Time
	samples       []managedTransferRateSample
}

func (r *managedTransferProgressReporter) observe(item pfregistry.ManagedOperationTransferProgress) (pfregistry.ManagedOperationTransferProgress, bool) {
	return r.observeWithForce(item, false)
}

func (r *managedTransferProgressReporter) observeFinal(item pfregistry.ManagedOperationTransferProgress) pfregistry.ManagedOperationTransferProgress {
	item, _ = r.observeWithForce(item, true)
	return item
}

func (r *managedTransferProgressReporter) observeWithForce(item pfregistry.ManagedOperationTransferProgress, force bool) (pfregistry.ManagedOperationTransferProgress, bool) {
	now := time.Now()
	if r.now != nil {
		now = r.now()
	}
	if len(r.samples) > 0 && item.DownloadedBytes < r.samples[len(r.samples)-1].bytes {
		r.samples = nil
	}
	if len(r.samples) == 0 || item.DownloadedBytes != r.samples[len(r.samples)-1].bytes {
		r.samples = append(r.samples, managedTransferRateSample{at: now, bytes: item.DownloadedBytes})
	}
	cutoff := now.Add(-managedTransferRateWindow)
	first := 0
	for first+1 < len(r.samples) && r.samples[first].at.Before(cutoff) {
		first++
	}
	r.samples = r.samples[first:]
	item.BytesPerSecond = 0
	if len(r.samples) > 1 {
		oldest, latest := r.samples[0], r.samples[len(r.samples)-1]
		if elapsed := latest.at.Sub(oldest.at); elapsed > 0 && latest.bytes >= oldest.bytes {
			item.BytesPerSecond = int64(float64(latest.bytes-oldest.bytes) / elapsed.Seconds())
		}
	}
	complete := item.TotalBytes > 0 && item.DownloadedBytes >= item.TotalBytes || item.TotalLayers > 0 && item.CompletedLayers >= item.TotalLayers
	emit := force || r.lastEmittedAt.IsZero() || item.Phase != r.lastPhase || complete || now.Sub(r.lastEmittedAt) >= managedTransferProgressInterval
	if emit {
		r.lastPhase, r.lastEmittedAt = item.Phase, now
	}
	return item, emit
}
